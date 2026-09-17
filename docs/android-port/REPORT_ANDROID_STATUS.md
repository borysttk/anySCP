# anySCP Android Port — Status Report

## Podsumowanie

anySCP zostaje przeniesiony na Androida przez Tauri + ADB. Aktualnie branch `arena/01a0a75b-anyscp` ma 102 commity, port Androida jest kompletny, build APK działa.

## Fazy portowania

| Faza | Status | Opis |
|---|---|---|
| Faza 1 — Audyt | ✅ | `01-tech-stack-audit.md` — analiza tech stacku |
| Faza 2 — Rust core | ✅ | Kompilacja krzyżowa aarch64-linux-android |
| Faza 3 — Platform layer | ✅ | SAF, file picker, platform detection |
| Faza 4 — Reconnect | ✅ | Reconnect po wznowieniu, eksport przez SAF |
| Faza 5 — UI | ✅ | Mobile UI: AppShell, Dashboard, ExplorerView |
| Faza 6 — i18n | ✅ | i18next localization |
| Faza 7 — A2A | ✅ | A2A collaboration support |
| Faza 8 — known_hosts | ✅ | SSH known_hosts verification |
| Build APK | ✅ | `pnpm tauri android build` — sukces |
| ADB deploy | ✅ | ADB device 38a77f50 połączony |

## Architektura

- **Frontend**: React + TypeScript (Tauri)
- **Backend Rust**: `anyscp_lib` — SSH, SFTP, transfer management
- **Platform**: Android via Tauri Android
- **NDK**: r26b (26.1.10909125)
- **Target**: aarch64-linux-android

## Kluczowe komponenty

### SSH Handler (`src/ssh/handler.rs`)
- `SshClientHandler` z known_hosts verification
- `check_known_hosts()` z `russh_keys::known_hosts`
- Error mapping: russh_keys → russh::Error::UnknownKey

### SSH Manager (`src/ssh/manager.rs`)
- `SshClientHandler::new(host, port)` w 2 miejscach
- Session management

### Platform Layer (`src/platform/saf.rs`)
- SAF (Storage Access Framework) integration
- Document creation, file picking, URI exports
- Activity lifecycle handling

### Mobile UI
- `HostsDashboard` — strumień jednokolumnowy, przyklejone wyszukiwanie, FAB
- `ExplorerView` — breadcrumb, pasek transferów, zaznaczanie dotykiem
- `AppShell` — dolna nawigacja, pasek sesji, drążenie ustawień

## Budowanie

```bash
export ANDROID_HOME="/home/ttk/android-sdk"
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
export NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
export JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
export PATH="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin:$PATH"

# Build library
cargo build --package anyscp --target aarch64-linux-android --lib

# Build APK
pnpm tauri android build

# Install via ADB
pnpm tauri android dev
```

## Pliki konfiguracyjne

- `.cargo/config.toml` — linker NDK, ścieżki Android SDK
- `src-tauri/Cargo.toml` — zależności Rust
- `src-tauri/gen/android/app/src/main/AndroidManifest.xml` — TransferService, windowSoftInputMode
- `src-tauri/gen/android/app/build.gradle.kts` — androidx.security:security-crypto

## Zależności Rust kluczowe

- `russh` — SSH klient
- `russh_keys` — known_hosts
- `russh_sftp` — SFTP
- `ndk-context`, `ndk` — Android NDK bindings
- `jni` — JNI 0.21
- `tauri` — Tauri framework

## Ograniczenia

- Build wymaga NDK r26b (r26d nie dostępny)
- ADB przez USB — nie przez WiFi
- VNC/Selkies na xiaomi-11t-pro przez Tailscale DERP
- Mariusz (A2A) offline — wymaga ręcznego wystartowania

## Następne kroki

1. ✅ Znane hosty SSH — zaimplementowane
2. 🔄 Deploy APK na urządzenie — w toku
3. ⏳ Testy funkcjonalne na Androidzie
4. ⏳ A2A z Mariuszem (czeka na online)
