# 🔥 Złoto — Repozytoria do anySCP Android Port

## Must-Have References

### 1. VoltiusApp/voltius ⭐503 (TOP)
- **Co ma**: Rust/Tauri SSH/SFTP/Serial client, Android support, E2EE sync, plugins
- **Dlaczego ważne**: Najlepszy wzór dla anySCP Android
- **Kluczowe pliki**:
  - `Dockerfile.android` — cross-compile dla Android
  - `Dockerfile.android-emulator` — emulator build
  - `Dockerfile.cross-compile` — multi-platform Docker build
  - `.claude/skills/` — Q-skills dla klastra
- **Lekcje**: Tauri Android build workflow, plugin system, E2EE vault
- **URL**: https://github.com/VoltiusApp/voltius

### 2. alexandrosnt/Reach ⭐49
- **Co ma**: Rust/Tauri v2 SSH client, Android support, SFTP, Ansible, OpenTofu
- **Dlaczego ważne**: Najnowszy Tauri v2 pattern, clean architecture
- **Kluczowe pliki**:
  - `src-tauri/Cargo.toml` — zależności Rust
  - `src/` — Svelte 5 frontend
  - Tauri v2 Android setup
- **Lekcje**: Tauri v2 Android config, multi-platform SSH stack
- **URL**: https://github.com/alexandrosnt/Reach

### 3. Termiaxial (dev.to article)
- **Co ma**: Rust/Tauri v2 SSH/SFTP, 85% ready for open source
- **Dlaczego ważne**: Prosty wzór, 50MB RAM vs 200MB Electron
- **Lekcje**: Performance benchmarks, Tauri v2 setup
- **URL**: https://dev.to/angga_prabuwisesa_0d016cd/built-a-ssh-client-that-uses-110th-ram-of-electron-apps-rust-tauri-v2-5b17

### 4. wilsonglasser/oryxis
- **Co ma**: Rust SSH client + vault, SFTP, port forwarding, cloud discovery
- **Dlaczego ważne**: Encrypted vault pattern, P2P sync
- **URL**: https://github.com/wilsonglasser/oryxis

### 5. zouwei/termex
- **Co ma**: AI-driven SSH client, Rust/Tauri, mobile support (termex-mobile)
- **Dlaczego ważne**: Mobile-first design, AI assistant
- **URL**: https://github.com/zouwei/termex

### 6. C-SSH (suiyuebaobao)
- **Co ma**: Rust/Tauri SSH DevOps, Android native, tmux persistence
- **Dlaczego ważne**: Native Android support, DevOps features
- **URL**: https://github.com/suiyuebaobao/c-ssh

## Key Patterns to Steal

### Tauri Android Build (z Voltius)
```dockerfile
# Dockerfile.cross-compile
FROM rust:1.85-android
ENV ANDROID_NDK_HOME=/opt/android-ndk
# Cross-compile Rust → aarch64-linux-android
```

### Credential Vault (z Voltius + Reach)
- OS keychain (macOS Keychain, Windows DPAPI, Linux libsecret)
- Encrypted SQLite backup (Argon2id + AES-256-GCM)
- Master password optional

### SSH Core (anySCP już ma)
- russh 0.46 + russh-keys 0.46
- russh-sftp 2.1
- Async Tokio runtime

## Android-Specific Fixes Needed for anySCP

| Crate | Fix | Status |
|-------|-----|--------|
| `drag` | `cfg(not(target_os = "android"))` | ✅ Fixed |
| `getrandom` | `cfg(target_os = "android")` + features=["std"] | ✅ Fixed |
| `dirs` | `cfg(not(target_os = "android"))` | ⏳ Pending |
| `ring` | NDK toolchain + `aarch64-linux-android-clang` | ⏳ Pending |
| `ssh2-config` | May need Android-specific cfg | ⏳ Pending |
| `rust-s3` | HTTPS on Android needs OpenSSL/boringtls | ⏳ Pending |
| `reqwest` | rustls-tls should work on Android | ⏳ Pending |

## Build Commands (work in progress)
```bash
# 1. Android SDK/NDK setup (zainstalowane)
export ANDROID_HOME=/home/ttk/android-sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin

# 2. Rust Android target
rustup target add aarch64-linux-android

# 3. Tauri Android init
pnpm tauri android init --ci

# 4. Build APK
cargo apk build
# Lub: pnpm tauri android build
```

## Next Steps (A2A Collab Compiler Workflow)
1. ✅ Design — DONE
2. ⏳ Code — apply fixes from table above
3. ⏳ Build — Docker cross-compile or native
4. ⏳ Test — APK on emulator/device
5. ⏳ Deploy — GitHub Releases
