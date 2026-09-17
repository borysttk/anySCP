//! Desktop credential store — OS keychain via the `keyring` crate.
//!
//! macOS Keychain (apple-native), Windows Credential Manager (windows-native),
//! Linux kernel keyutils (linux-native). This is the original anySCP vault
//! implementation, moved verbatim out of `vault/mod.rs` so the Android build
//! can swap in a different backend without `cfg` noise inside every function.
//!
//! `keyring` 3.x supports Linux, FreeBSD, OpenBSD, Windows, macOS and iOS —
//! but **not Android**, which is why this module is desktop-gated.

use super::{StoredCredential, VaultError, SERVICE_NAME};
use tracing::instrument;

/// Persist `credential` in the OS keychain under `host_id`.
///
/// # Security
/// The plaintext value is only held in Rust memory long enough to pass it to
/// the keychain C-API. It is never written to disk or emitted to logs.
#[instrument(skip(credential), fields(host_id = %host_id))]
pub fn save_credential(host_id: &str, credential: &StoredCredential) -> Result<(), VaultError> {
    let entry = keyring::Entry::new(SERVICE_NAME, host_id)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;

    let json =
        serde_json::to_string(credential).map_err(|e| VaultError::InvalidData(e.to_string()))?;

    entry
        .set_password(&json)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;

    tracing::debug!(host_id = %host_id, "credential saved to keychain");
    Ok(())
}

/// Retrieve the `StoredCredential` for `host_id` from the OS keychain.
#[instrument(fields(host_id = %host_id))]
pub fn get_credential(host_id: &str) -> Result<StoredCredential, VaultError> {
    let entry = keyring::Entry::new(SERVICE_NAME, host_id)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;

    let json = entry.get_password().map_err(|e| match e {
        keyring::Error::NoEntry => VaultError::NotFound(host_id.to_string()),
        other => VaultError::Keychain(other.to_string()),
    })?;

    serde_json::from_str(&json).map_err(|e| VaultError::InvalidData(e.to_string()))
}

/// Remove the credential for `host_id` from the OS keychain.
///
/// Treating a missing entry as success avoids spurious errors when
/// `delete_host` and `vault_delete_credential` are called together.
#[instrument(fields(host_id = %host_id))]
pub fn delete_credential(host_id: &str) -> Result<(), VaultError> {
    let entry = keyring::Entry::new(SERVICE_NAME, host_id)
        .map_err(|e| VaultError::Keychain(e.to_string()))?;

    match entry.delete_credential() {
        Ok(()) => {
            tracing::debug!(host_id = %host_id, "credential deleted from keychain");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()), // already absent — that is fine
        Err(e) => Err(VaultError::Keychain(e.to_string())),
    }
}

/// Return `true` when a credential exists for `host_id`.
pub fn has_credential(host_id: &str) -> bool {
    keyring::Entry::new(SERVICE_NAME, host_id)
        .and_then(|e| e.get_password())
        .is_ok()
}
