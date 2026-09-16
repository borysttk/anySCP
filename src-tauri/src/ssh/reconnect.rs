//! Session health checks and automatic recovery after the process is thawed.
//!
//! # Why this exists
//!
//! Android freezes a backgrounded process and reaps its TCP sockets. Nothing
//! informs the peer, so when the activity resumes our session map still looks
//! healthy while the transport underneath is dead: keystrokes are written into
//! a socket that goes nowhere, and the user sees a terminal that has silently
//! stopped responding.
//!
//! [`resume_sweep`] is triggered from the native `onResume` callback (see
//! `platform::lifecycle`) and probes every session before the user can type
//! into a dead one.
//!
//! # What is and is not recovered
//!
//! The transport is rebuilt; **the remote shell is not**. When the TCP
//! connection died the server sent SIGHUP to the login shell, destroying its
//! working directory, environment, history and any foreground process. A
//! reconnect therefore yields a *new* shell — so the user is told explicitly
//! via a banner written into the scrollback, rather than being left to discover
//! it by finding themselves unexpectedly in `$HOME`.
//!
//! The scrollback itself is preserved, because [`SshManager::reconnect_in_place`]
//! reuses the session ID and the frontend keys its xterm.js instances by it.
//!
//! Surviving the disconnect entirely would require a remote multiplexer
//! (`tmux`/`screen`), which cannot be assumed to exist — BusyBox routers and
//! minimal containers often have neither, and installing one may be impossible.
//! That is planned as an opt-in per-host setting, not a default.

use crate::types::{ConnectionStatus, HostConfig, SshError, SshOutputPayload, SshStatusPayload};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tracing::{info, warn};

use super::manager::{Liveness, SshManager};

/// How long a liveness probe may take before the session is declared dead.
///
/// Generous enough for a slow mobile uplink, short enough that the sweep does
/// not visibly stall the UI on resume.
const PROBE_TIMEOUT: Duration = Duration::from_millis(2_500);

/// Reconnect attempts before giving up and handing over to the user.
const MAX_ATTEMPTS: u32 = 3;

/// First backoff delay; doubles per attempt (750ms, 1.5s, 3s).
const BASE_BACKOFF: Duration = Duration::from_millis(750);

/// ANSI-formatted notice written into the terminal when the link drops.
///
/// Emitted as ordinary session output so it lands in the scrollback exactly
/// where the connection broke, giving the user a timestamped-in-place marker
/// rather than a transient toast they may miss.
fn banner_lost() -> Vec<u8> {
    "\r\n\x1b[33m[anySCP] Połączenie utracone. Próba ponownego połączenia…\x1b[0m\r\n"
        .as_bytes()
        .to_vec()
}

fn banner_restored() -> Vec<u8> {
    "\x1b[32m[anySCP] Połączono ponownie. Uwaga: to nowa powłoka — poprzedni stan sesji \
     (katalog, zmienne, uruchomione procesy) został utracony.\x1b[0m\r\n"
        .as_bytes()
        .to_vec()
}

fn banner_failed(err: &str) -> Vec<u8> {
    format!("\x1b[31m[anySCP] Ponowne połączenie nieudane: {err}\x1b[0m\r\n")
        .as_bytes()
        .to_vec()
}

/// Write bytes into a session's terminal as if the remote had sent them.
fn write_to_terminal(app: &AppHandle, session_id: &str, data: Vec<u8>) {
    let _ = app.emit(
        "ssh:output",
        &SshOutputPayload {
            session_id: session_id.to_string(),
            data,
        },
    );
}

fn emit_status(app: &AppHandle, session_id: &str, status: ConnectionStatus) {
    let _ = app.emit(
        "ssh:status",
        &SshStatusPayload {
            session_id: session_id.to_string(),
            status,
        },
    );
}

/// Probe every live session and rebuild the ones whose transport has died.
///
/// Sessions are swept concurrently: probing serially would make resume latency
/// scale with the number of open tabs, and each probe can take up to
/// [`PROBE_TIMEOUT`].
pub async fn resume_sweep(app: AppHandle) {
    // The state guard borrows from `app`, so it is scoped tightly and only the
    // owned ID list escapes — the per-session tasks re-fetch the manager.
    let ids = match app.try_state::<SshManager>() {
        Some(m) => m.session_ids(),
        None => return,
    };

    if ids.is_empty() {
        return;
    }
    info!(count = ids.len(), "probing sessions after resume");

    let mut tasks = Vec::with_capacity(ids.len());
    for session_id in ids {
        let app = app.clone();
        tasks.push(tauri::async_runtime::spawn(async move {
            check_and_recover(app, session_id).await;
        }));
    }
    for t in tasks {
        let _ = t.await;
    }
}

/// Probe one session; if it is dead and reconnectable, rebuild it.
async fn check_and_recover(app: AppHandle, session_id: String) {
    let liveness = {
        let Some(manager) = app.try_state::<SshManager>() else {
            return;
        };
        manager.probe(&session_id, PROBE_TIMEOUT).await
    };

    match liveness {
        Liveness::Alive | Liveness::Unknown => {}
        Liveness::Dead => {
            warn!(session_id = %session_id, "session transport is dead — recovering");
            reconnect_session(app, session_id).await;
        }
    }
}

/// Drive a dead session through the reconnect state machine.
///
/// `Disconnected` is emitted only after every attempt has failed, so a
/// recovery that succeeds on the second try never flashes a disconnect overlay
/// at the user.
pub async fn reconnect_session(app: AppHandle, session_id: String) {
    let Some(origin) = app
        .try_state::<SshManager>()
        .and_then(|m| m.origin(&session_id))
    else {
        // No origin: a split pane, or a session already torn down. Nothing we
        // can safely rebuild — report it and let the user decide.
        emit_status(&app, &session_id, ConnectionStatus::Disconnected);
        return;
    };

    write_to_terminal(&app, &session_id, banner_lost());
    emit_status(&app, &session_id, ConnectionStatus::Connecting);

    let mut last_error = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        // Re-resolve credentials on every attempt for saved hosts: the vault is
        // the source of truth, and a password changed while the app slept must
        // not be replayed from a stale snapshot.
        let config = match resolve_config(&app, &origin.host_id, &origin.config).await {
            Ok(c) => c,
            Err(e) => {
                last_error = e.to_string();
                break;
            }
        };

        let result = {
            let Some(manager) = app.try_state::<SshManager>() else {
                return;
            };
            manager
                .reconnect_in_place(&session_id, config, app.clone())
                .await
        };

        match result {
            Ok(()) => {
                write_to_terminal(&app, &session_id, banner_restored());
                // open_pty already emitted Connected.
                info!(session_id = %session_id, attempt, "reconnect succeeded");
                return;
            }
            // Bad credentials will not fix themselves by retrying, and each
            // retry risks tripping the server's failed-login lockout.
            Err(SshError::AuthenticationFailed(msg)) => {
                last_error = msg;
                break;
            }
            Err(e) => {
                last_error = e.to_string();
                warn!(session_id = %session_id, attempt, error = %last_error, "reconnect attempt failed");
                if attempt < MAX_ATTEMPTS {
                    tokio::time::sleep(BASE_BACKOFF * 2_u32.pow(attempt - 1)).await;
                }
            }
        }
    }

    write_to_terminal(&app, &session_id, banner_failed(&last_error));
    emit_status(&app, &session_id, ConnectionStatus::Error(last_error));
}

/// Produce a fresh `HostConfig`, preferring the database + keychain.
///
/// Falls back to the snapshot taken at connect time for ad-hoc sessions that
/// were never saved.
async fn resolve_config(
    app: &AppHandle,
    host_id: &Option<String>,
    fallback: &HostConfig,
) -> Result<HostConfig, SshError> {
    let Some(host_id) = host_id.clone() else {
        return Ok(fallback.clone());
    };
    let Some(db) = app.try_state::<Arc<crate::db::HostDb>>() else {
        return Ok(fallback.clone());
    };
    let db = Arc::clone(&db);

    // DB and keychain access are blocking.
    tokio::task::spawn_blocking(move || {
        super::commands::build_host_config_blocking(&host_id, &db, &mut Vec::new())
    })
    .await
    .map_err(|e| SshError::IoError(format!("task panicked: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The banners must be valid UTF-8 and carry a reset so the user's shell
    /// output is not left tinted by the notice colour.
    #[test]
    fn banners_are_terminated_and_reset() {
        for b in [banner_lost(), banner_restored(), banner_failed("boom")] {
            let s = String::from_utf8(b).expect("banner must be valid UTF-8");
            assert!(s.contains("\x1b[0m"), "banner must reset SGR state: {s:?}");
            assert!(s.ends_with("\r\n"), "banner must end the line: {s:?}");
        }
    }

    /// A terminal expects CRLF, not a bare LF: without the CR the next line
    /// starts at the current column, producing a staircase.
    #[test]
    fn banners_use_crlf() {
        let s = String::from_utf8(banner_lost()).unwrap();
        assert!(!s.contains("\n\r"), "line ends must be CRLF, not LFCR");
        for (i, _) in s.match_indices('\n') {
            assert!(i > 0 && s.as_bytes()[i - 1] == b'\r', "bare LF at {i} in {s:?}");
        }
    }

    /// The failure banner surfaces the underlying error, which is the only
    /// diagnostic the user gets when recovery gives up.
    #[test]
    fn failure_banner_includes_reason() {
        let s = String::from_utf8(banner_failed("connection refused")).unwrap();
        assert!(s.contains("connection refused"));
    }

    /// Exponential backoff: 750ms, 1.5s, 3s. Encoded as a test so a change to
    /// the schedule is a deliberate act rather than an accident.
    #[test]
    fn backoff_doubles_per_attempt() {
        let delays: Vec<Duration> = (1..=MAX_ATTEMPTS)
            .map(|a| BASE_BACKOFF * 2_u32.pow(a - 1))
            .collect();
        assert_eq!(
            delays,
            vec![
                Duration::from_millis(750),
                Duration::from_millis(1_500),
                Duration::from_millis(3_000),
            ]
        );
    }

    /// Total time spent sleeping between attempts must stay well under the
    /// point where a user assumes the app has hung.
    #[test]
    fn total_backoff_is_bounded() {
        let total: Duration = (1..MAX_ATTEMPTS)
            .map(|a| BASE_BACKOFF * 2_u32.pow(a - 1))
            .sum();
        assert!(total < Duration::from_secs(5), "backoff too slow: {total:?}");
    }
}
