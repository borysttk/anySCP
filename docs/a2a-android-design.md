# anySCP Android — A2A Collab Compiler Design Doc

## Design (Q prowadzi, Mariusz waliduje)

### Architektura
- Bazowy projekt: anySCP (Rust + Tauri v2) ✅
- Cel: APK/AAB dla Android (API 21+, ARM64)
- Wzorzec: VoltiusApp/voltius (Rust/Tauri, Android, SSH/SFTP)

### Kluczowe wyzwania i rozwiązania

| Problem | Rozwiązanie | Źródło |
|---------|-------------|--------|
| `drag` crate nie kompiluje na Android | `#[cfg(not(target_os = "android"))]` | anySCP Cargo.toml |
| `ring` crate brak `aarch64-linux-android-clang` | NDK toolchain w PATH | Voltius Dockerfile.android |
| `getrandom` brak na Android | `features = ["std"]` | Rust docs |
| `dirs` nie działa na Android | `android-system` cfg | Reach pattern |
| `async fn` edition error | Rust 2021 edition w Cargo.toml | anySCP już ma |

### Krok po kroku

#### 1. Konfiguracja środowiska
```bash
# Android SDK + NDK (zainstalowane)
export ANDROID_HOME=/home/ttk/android-sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/26.1.10909125
export PATH=$PATH:$ANDROID_HOME/platform-tools:$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
```

#### 2. Tauri Android init
```bash
cd anySCP && pnpm tauri android init --ci
```

#### 3. Poprawki Cargo.toml
- `drag` → `cfg(not(target_os = "android"))`
- `getrandom` → `cfg(target_os = "android")` z features=["std"]
- `dirs` → `cfg(not(target_os = "android"))`

#### 4. Poprawki kodu
- `sftp_drag_out` → `#[cfg(not(target_os = "android"))]`
- `title()` → usunięty (Tauri 2.x API change)

#### 5. Docker cross-compile (wzorzec Voltius)
```dockerfile
FROM rust:1.85-android
ENV ANDROID_NDK_HOME=/opt/android-ndk
# Build script
```

#### 6. Build APK
```bash
cd src-tauri/gen/android && ./gradlew assembleDebug
# Lub: pnpm tauri android build
```

### Co kopiujemy z Voltius/Reach
- Tauri Android init workflow ✅
- Docker cross-compilation ✅
- Credential vault pattern ✅
- SSH + SFTP core ✅ (already in anySCP)
- Plugin system (opcjonalny)

### Następne kroki
1. ✅ Design — DONE
2. Code — poprawki Cargo.toml + lib.rs
3. Build — Docker cross-compile lub native
4. Test — APK na emulatorze/device
5. Deploy — GitHub Releases
