# anySCP Branch Diff Report

## main vs arena/01a0a75b-anyscp

### Statystyki
- 17 commitów na arena branch
- 113 plików zmienionych
- +7918 / -527 linii

### Kluczowe zmiany

#### Nowe katalogi
- `src/platform/saf.rs` — Storage Access Framework
- `src/ssh/handler.rs` — SSH handler z known_hosts
- `src/ssh/manager.rs` — SSH session manager
- `src/ssh/session.rs` — SSH session types
- `src/stores/` — Zustand stores
- `src/components/dashboard/` — Mobile UI components

#### Kluczowe pliki
| Plik | Zmiany | Opis |
|---|---|---|
| `src/locales/pl.json` | +136 | i18n polskie |
| `src/main.tsx` | +18 | Mobile entry point |
| `src/theme.css` | +30 | Mobile theme |
| `src/stores/updater-store.ts` | +12 | Updater state |

#### Zależności
- `russh` — SSH klient
- `russh_keys` — known_hosts
- `russh_sftp` — SFTP
- `ndk-context`, `ndk` — Android bindings
- `jni` — JNI 0.21
- `tauri` — Tauri framework

### Struktura projektu

```
anySCP/
├── src-tauri/
│   ├── src/
│   │   ├── ssh/
│   │   │   ├── handler.rs      # known_hosts verification
│   │   │   ├── manager.rs      # Session management
│   │   │   └── session.rs      # SSH types
│   │   ├── platform/
│   │   │   └── saf.rs          # Android SAF
│   │   └── types.rs            # Shared types
│   ├── gen/android/             # Generated Android project
│   │   └── app/src/main/
│   │       ├── AndroidManifest.xml
│   │       └── jniLibs/
│   └── .cargo/config.toml      # NDK linker config
├── src/
│   ├── components/dashboard/    # Mobile UI
│   ├── stores/                  # Zustand stores
│   ├── hooks/                   # React hooks
│   └── locales/                 # i18n
└── docs/android-port/
    ├── 01-tech-stack-audit.md
    ├── BUILD.md
    ├── ci-android-job.yml
    ├── REPORT_ANDROID_STATUS.md
    └── REPORT_BRANCH_DIFF.md
```

### Status buildu
- ✅ Rust library: kompiluje się dla aarch64-linux-android
- ✅ APK: budowanie w toku (gradle assembleUniversalRelease)
- ✅ ADB: urządzenie 38a77f50 połączone
- ✅ known_hosts: zaimplementowane
- ⏳ A2A z Mariuszem: czeka na online

### Znane problemy
- `libandroid.so`, `liblog.so`, `libunwind.so` — wymagane z NDK
- JAVA_HOME: `/usr/lib/jvm/java-17-openjdk-amd64`
- NDK: r26b (26.1.10909125)
- Cargo config: `.cargo/config.toml` z linkerem NDK
