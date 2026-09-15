# Faza 1 — Audyt technologiczny i strategia portowania na Androida

Repozytorium: `borysttk/anySCP` (fork `macnev2013/anySCP`), commit bazowy `5641faa`.
Data audytu: 2026-09-15.

---

## 0. Streszczenie wykonawcze (TL;DR)

**anySCP nie jest grą ani aplikacją natywną C/C++.** To klient SSH/SFTP/S3 zbudowany
w **Tauri v2** (Rust backend + React/TypeScript frontend w WebView). Oznacza to, że
cały scenariusz z założeń zadania — Android NDK + `ANativeActivity`, wrapper JNI,
OpenGL ES/Vulkan, wirtualny d-pad, Asset Manager w APK — **nie ma zastosowania
w formie dosłownej**. Tauri v2 ma natywne wsparcie dla Androida i sam generuje
projekt Gradle, `AndroidManifest.xml`, `WryActivity` (pochodna `AppCompatActivity`,
nie `ANativeActivity`) oraz kompiluje rdzeń Rust do `.so` przez NDK.

Poniżej mapowanie oryginalnych założeń na realia tego stacku:

| Założenie z briefu | Realia anySCP | Co robimy zamiast |
|---|---|---|
| Silnik gry / SDL2 / GLFW | Tauri 2.10.3 + wry 0.54 (WebView) | `tauri android init` generuje projekt |
| `ANativeActivity` / wrapper JNI | `WryActivity` (Kotlin, AppCompat) | Gotowe w scaffoldingu Tauri |
| OpenGL ES / Vulkan | Renderowanie robi Android System WebView | Wyłączyć xterm WebGL addon → Canvas |
| Wirtualny d-pad / analog | Aplikacja produktywnościowa, nie gra | Pasek klawiszy terminala (Ctrl/Tab/strzałki/Esc), gesty |
| Asset Manager z `assets/` | Frontend serwowany z `asset://` przez Tauri | Zero zmian, działa out-of-the-box |
| Kompilacja C/C++ pod ARM | Cross-compile Rust (`cargo-ndk` przez Tauri CLI) | 4 triple: arm64/armv7/x86/x86_64 |

**Kluczowy wniosek:** port jest wykonalny i zasadniczo sensowny (SSH/SFTP na telefonie
to realny use-case, konkurencja: Termius, JuiceSSH), ale **nie jest to rekompilacja —
to refaktor warstwy platformowej**. Główna praca to nie NDK, tylko:

1. **Odcięcie 5 zależności desktop-only** od buildu Android (`keyring`, `drag`,
   `ssh2-config`→`git2`→`openssl-sys`, `tauri-plugin-updater`, `tauri-plugin-process`).
2. **Napisanie mobilnego zamiennika Keychaina** (Android Keystore/EncryptedSharedPreferences).
3. **Przeprojektowanie UI** — obecny layout to desktopowy IDE-shell (sidebar + taby +
   splity + menu kontekstowe na PPM) z **4 klasami responsywnymi w całym kodzie**.
4. **Adaptacja wejścia** — terminal bez klawiatury fizycznej, brak PPM, brak hovera.

Szacunek: **~6–9 tygodni** dla jednego inżyniera do wersji „usable beta" (SSH + SFTP),
z czego ~60% to frontend/UX, ~30% Rust/platforma, ~10% build/CI.

---

## 1. Tech Stack Audit

### 1.1 Warstwa aplikacji

| Warstwa | Technologia | Wersja | Uwagi |
|---|---|---|---|
| Framework | Tauri | 2.10.3 | v2 = wsparcie mobile |
| Runtime okna | tao / wry | 0.34.8 / 0.54.8 | na Androidzie: WryActivity + Android WebView |
| Backend | Rust | edition 2021 | ~20 450 LOC, 129 komend IPC |
| Frontend | React | 19.1 | ~23 600 LOC TS/TSX |
| Bundler | Vite | 7.0 | + `@tailwindcss/vite` 4.2 |
| Stan | Zustand | 5.0 | |
| Terminal | @xterm/xterm | 6.0 | + addony: fit, search, web-links, **webgl** |
| Style | Tailwind CSS 4 | | 44× `oklch()` w `theme.css` |
| DnD | @dnd-kit | 6.3 | reorder hostów |
| Testy | Vitest + WebdriverIO | | e2e przez `tauri-driver` (desktop-only) |

### 1.2 Kluczowe zależności Rust i ich status na Androidzie

Analiza `Cargo.lock` (drzewo odwrotnych zależności) — **to jest sedno audytu**:

#### ✅ Działa bez zmian (pure Rust, cross-compiluje się)

| Crate | Wersja | Rola | Dlaczego OK |
|---|---|---|---|
| `russh` / `russh-keys` | 0.46 | SSH (klient, PTY, auth) | Pure Rust, brak libssh/OpenSSL |
| `russh-sftp` | 2.1.1 | SFTP | Pure Rust |
| `tokio` | 1.x (full) | Runtime async | Pełne wsparcie Androida |
| `rusqlite` | 0.31 (`bundled`) | Baza hostów/ustawień | `bundled` kompiluje SQLite przez `cc` → NDK clang, działa |
| `rust-s3` | 0.37.1 | S3 (`tokio-rustls-tls`) | rustls, bez OpenSSL |
| `reqwest` | 0.12 (`rustls-tls`) | HTTP (S3, telemetria) | rustls, bez OpenSSL |
| `argon2`/`aes-gcm`/`flate2`/`getrandom` | | Backup szyfrowany | Pure Rust |
| `notify` | 7 | Watcher plików (edit-and-upload) | Linux/Android = inotify — **kompiluje się**, ale patrz §1.3 |
| `dashmap`, `uuid`, `thiserror`, `tokio-util`, `tracing` | | | |

> ⚠️ **Uwaga do `notify`:** w `Cargo.toml` jest `features = ["macos_kqueue"]` z
> `default-features = false`. Na Androidzie backend inotify jest wybierany
> automatycznie i się zbuduje, ale **sama funkcja „edytuj w VS Code" nie ma sensu
> mobilnie** — patrz §1.3.

#### ❌ Blokery — nie zbudują się lub nie zadziałają na Androidzie

| Crate | Problem | Waga | Rozwiązanie |
|---|---|---|---|
| **`keyring` 3.6.3** | Wspiera Linux/FreeBSD/OpenBSD/Windows/macOS/**iOS — nie Androida**. Features w repo: `apple-native`, `linux-native` (keyutils), `windows-native`. Na Androidzie brak keyutils → brak backendu. | 🔴 Krytyczny | Nowy moduł `vault` per-platforma: Android Keystore przez JNI, lub crate `android-keyring` / `android-native-keyring-store` (oba działają z `ndk-context`, które Tauri już inicjalizuje przez `tao`) |
| **`ssh2-config` 0.7.0** | `[build-dependencies] git2 = "0.20"` → `libgit2-sys` → **`openssl-sys` + `libssh2-sys`**. To C, wymaga cross-compile OpenSSL pod 4 ABI. Użycie: wyłącznie import `~/.ssh/config`. | 🔴 Krytyczny | Wyłączyć cały moduł `import` pod `cfg(mobile)` — na Androidzie nie ma `~/.ssh/config`. Zero utraty funkcjonalności. |
| **`drag` 2.1.1** | Deps: `gtk`, `gdk`, `gdkx11`, `objc2-app-kit`, `windows`. Drag-out plików do Findera/Explorera. | 🔴 Krytyczny (build) | `cfg(not(mobile))`. Na Androidzie nie istnieje pojęcie „przeciągnij na pulpit". |
| **`tauri-plugin-updater`** | Oficjalna tabela: Android ✗, iOS ✗. Google Play zabrania self-install. | 🟠 Wysoki | `[target.'cfg(not(any(target_os="android",target_os="ios")))'.dependencies]`. Opcjonalnie `tauri-plugin-android-update` (sprawdza wersję, kieruje do Play). |
| **`tauri-plugin-process`** | Android ✗ (brak `relaunch`/`exit`). Używany 4× we frontendzie po zmianie ustawień. | 🟠 Wysoki | Wyłączyć; zamiast `relaunch()` → miękki reload stanu / komunikat „zrestartuj aplikację". |
| **`dirs::home_dir()` / `std::env::var("HOME")`** | Na Androidzie `HOME` zwykle nie istnieje / wskazuje `/data`. Użycia: `editors`, `import`, `telemetry` (`dirs::data_dir()`). | 🟡 Średni | Przejść na `app.path().app_data_dir()` / `app_cache_dir()`. |
| **`std::process::Command`** (`open`, `which puttygen`, uruchamianie edytora) | Android: brak shella użytkownika, brak PATH, SELinux. | 🟡 Średni | Cały moduł `editors` pod `cfg(not(mobile))`. |

#### ⚠️ Działa, ale semantyka się zmienia

| Element | Uwaga |
|---|---|
| `tauri-plugin-dialog` | Android ✓, **ale bez pickera katalogów**. Downloady SFTP „zapisz do folderu" wymagają przeprojektowania (SAF / stały katalog `Downloads`). |
| `tauri-plugin-clipboard-manager` | Android ✓ dla `readText`/`writeText` (to jedyne czego używa Terminal.tsx). `clear()` tylko SDK 28+. OK. |
| `tauri-plugin-opener` | Android ✓ (Intent). OK dla otwierania URL-i. |
| `PortForwardManager` | `TcpListener` bind na `127.0.0.1:port` — **działa** na Androidzie (porty <1024 zabronione, ale reguły użytkownika i tak używają wysokich). Tunel jest jednak dostępny tylko dla aplikacji na tym samym urządzeniu. |
| `telemetry` (PostHog) | Działa (reqwest+rustls), ale ścieżka `dirs::data_dir()` do `.device_id` wymaga zmiany. Dodatkowo Play wymaga deklaracji Data Safety. |
| `backup` (export/import szyfrowany) | Logika pure-Rust OK; zapis pliku wymaga SAF zamiast ścieżki. |
| `std::env::temp_dir()` | Na Androidzie zwraca `/tmp`, **który nie istnieje / nie jest zapisywalny**. Użycia w `db/mod.rs` (export/restore), `backup`, `editors`. 🔴 Wymaga zmiany na `app_cache_dir()`. |

### 1.3 Funkcje desktopowe do wycięcia lub przeprojektowania

| Funkcja | Pliki | Decyzja mobilna |
|---|---|---|
| Drag-out plików do OS | `sftp/commands.rs:1015-1060` (`start_native_drag`), `ExplorerFileTable.tsx` | **Usuń** (`cfg`) |
| Edycja w zewnętrznym edytorze (VS Code) + watcher | `editors/mod.rs` (796 LOC), `sftp_edit_external`, `scp_edit_external`, `s3_edit_external` | **Usuń** lub zastąp wbudowanym edytorem tekstu w WebView |
| Import `~/.ssh/config` | `import/` (527 LOC), `ImportSshConfigModal.tsx` | **Usuń** na v1; ewentualnie później „wklej treść configu" |
| `puttygen` do konwersji kluczy | `ssh/keys.rs:164-179` | **Usuń** (`cfg`) |
| Auto-updater | `updater-store.ts`, `UpdateDialog.tsx` | **Usuń**, Play Store zarządza |
| `relaunch()` | `SettingsPage.tsx` ×2, `updater-store.ts` ×2 | Zastąp komunikatem |
| Drag & drop plików z OS do okna (`onDragDropEvent`) | `ExplorerView.tsx:130-149`, `S3Browser.tsx:55-74` | **Usuń**, zastąp przyciskiem „Wgraj" + SAF picker |
| Skróty Cmd/Ctrl (`use-keyboard-shortcuts.ts`, `navigator.platform`) | | Zachowaj (klawiatura BT), dodaj ekwiwalenty dotykowe |
| Wielopanelowe splity terminala | `AppShell.tsx`, `TerminalArea` | Na telefonie: 1 panel; splity tylko na tablecie |

### 1.4 Architektura UI — ocena gotowości mobilnej

Liczby mówią same za siebie:

```
Klasy responsywne (sm:/md:/lg:/xl:) w całym src/  →     4
Handlery onContextMenu (prawy przycisk myszy)     →    19
Klasy hover:                                      →   224
Handlery onKeyDown                                →    22
Największe komponenty: SettingsPage 1740 LOC, ExplorerFileTable 1489 LOC
```

To jest UI zaprojektowane **wyłącznie** pod desktop: minimalna szerokość okna jest
zahardkodowana na `800×500` (`lib.rs:136`), a tabela plików w Explorerze ma kolumny
(nazwa, rozmiar, uprawnienia, data, właściciel) niemieszczące się na 360dp.

**Wniosek:** frontend wymaga nie „dostosowania skalowania", lecz **równoległego
zestawu layoutów mobilnych** dla 4 głównych widoków (Hosts, Terminal, Explorer, Settings).

### 1.5 Środowisko budowania (stan sandboxa)

```
node    v22.22.3   ✓
cargo   —          ✗ brak
java    —          ✗ brak
ANDROID_HOME —     ✗ brak (brak SDK/NDK)
```

Sandbox nie ma toolchaina Rust/JDK/Android SDK, więc **realna kompilacja APK w tym
środowisku nie jest możliwa**. Instrukcje z Fazy 5 będą przeznaczone do uruchomienia
lokalnie/w CI (GitHub Actions `ubuntu-latest` + `setup-java@v4` JDK 17 +
`android-actions/setup-android@v3` + `nttld/setup-ndk@v1`).

---

## 2. Rekomendowana strategia portowania

### 2.1 Wybór podejścia

Rozważone opcje:

| Opcja | Ocena |
|---|---|
| **A. Tauri v2 Android (jeden codebase)** | ✅ **REKOMENDOWANA** — `tauri android init` daje Gradle+NDK+WryActivity za darmo; cały Rust (russh/sftp/s3) reużyty 1:1; jeden zespół, jedna baza kodu |
| B. Natywny Kotlin + Rust przez JNI | Odrzucona — wymaga przepisania całego UI (23 600 LOC) i ręcznego mostka do 129 komend |
| C. Capacitor/React Native + osobny backend | Odrzucona — brak SSH w JS, i tak potrzebny Rust |
| D. Kompilacja NDK „jak gra" z `ANativeActivity` | Bezcelowa — nie ma pętli renderującej ani grafiki do przeniesienia |

### 2.2 Zasada architektoniczna: `cfg(mobile)` zamiast forka

Tauri definiuje `mobile` i `desktop` jako cfg-aliasy. Cały port budujemy na
**warunkowej kompilacji w istniejącym drzewie**, bez forka:

```
src-tauri/src/
  lib.rs              → .setup() rozgałęziony: desktop tworzy okno, mobile nie
  platform/
    mod.rs            → re-eksport wg cfg
    desktop.rs        → keychain (keyring), drag, editors, import, updater
    mobile.rs         → Keystore przez JNI, SAF, stuby dla reszty
  vault/
    mod.rs            → trait CredentialStore
    keyring_store.rs  → cfg(desktop)
    android_store.rs  → cfg(target_os="android")
```

Reguła: **żadna komenda IPC nie znika z rejestru** — na mobile zwraca
`Err(Unsupported)`. Dzięki temu frontend nie wybucha na brakującej komendzie,
tylko dostaje czytelny błąd, a testy jednostkowe zostają zielone.

### 2.3 Podział `Cargo.toml` na target-specific dependencies

```toml
[dependencies]
# ... wspólne: tauri, russh, tokio, rusqlite, rust-s3, reqwest, argon2 ...
tauri-plugin-dialog = "2.6.0"
tauri-plugin-clipboard-manager = "2.3.2"
tauri-plugin-opener = "2"

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
keyring = { version = "3", features = ["apple-native","linux-native","windows-native"] }
drag = "2"
ssh2-config = "0.7.0"          # ciągnie git2/openssl-sys — desktop only
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
notify = { version = "7", default-features = false, features = ["macos_kqueue"] }

[target.'cfg(target_os = "android")'.dependencies]
jni = "0.21"                   # już w drzewie (tao/wry)
ndk-context = "0.1"            # już w drzewie
android_logger = "0.14"        # tracing → logcat
```

To jedno posunięcie usuwa **wszystkie** blokery kompilacji C/C++ (OpenSSL, libssh2,
GTK, objc) z buildu Android. Zostaje tylko `libsqlite3-sys` (bundled), który
kompiluje się czysto pod NDK.

### 2.4 Strategia dla sekretów (najtrudniejszy element)

`keyring` jest używany w 6 modułach (`ssh/commands`, `db/commands`, `s3/commands`,
`portforward/commands`, `backup`, `lib`). Refaktor:

1. Wprowadzić trait `CredentialStore { save/get/delete/has }` w `vault/mod.rs`.
2. Desktop: implementacja przez `keyring::Entry` (obecny kod, przeniesiony 1:1).
3. Android: `EncryptedSharedPreferences` (AndroidX Security) sterowane z Kotlina,
   wystawione do Rusta przez JNI — **albo** crate `android-keyring`, który robi
   dokładnie to i integruje się z `ndk-context` inicjalizowanym przez Tauri.
   Rekomendacja: zacząć od `android-keyring` (mniej kodu), z fallbackiem na własny
   JNI, jeśli crate okaże się niestabilny.
4. Klucz master w Android Keystore (`setUserAuthenticationRequired` opcjonalnie →
   odblokowanie biometrią przed użyciem hasła hosta).

### 2.5 Strategia dla systemu plików / „Asset Managera"

Tu brief mówi o `assets/` w APK — w Tauri to jest już rozwiązane:

- **Frontend (HTML/JS/CSS/fonty)** — Vite buduje do `dist/`, Tauri pakuje do
  `assets/` w APK i serwuje przez protokół `asset://`/`http://tauri.localhost`.
  **Zero zmian w kodzie.**
- **Dane aplikacji (SQLite)** — `app.path().app_data_dir()` →
  `/data/data/com.macnev2013.anyscp/files`. Już tak działa, bo `HostDb::new()`
  dostaje `app_data_dir`. **Zero zmian.**
- **Pliki tymczasowe** — 🔴 `std::env::temp_dir()` trzeba zamienić na
  `app.path().app_cache_dir()` w `db/mod.rs`, `backup/mod.rs`, `editors/mod.rs`.
- **Pobrane pliki (SFTP/S3 download)** — Scoped Storage: zapis przez SAF
  (`ACTION_CREATE_DOCUMENT`) albo do `Downloads` przez MediaStore. Wymaga
  `tauri-plugin-android-fs` lub własnego mostka Kotlin.
- **Klucze SSH** — brak `~/.ssh`. Import klucza przez SAF picker → kopia do
  prywatnego `app_data_dir/keys/` z uprawnieniami 600.

### 2.6 Strategia UI/UX (Touch & Mobile)

Zamiast „wirtualnego d-pada" (to nie gra) projektujemy:

**a) Nawigacja** — zamiana desktopowego shella (sidebar + pasek tabów) na:
- telefon: dolny `BottomNav` (Hosts / Terminal / Files / More) + sidebar jako
  wysuwany `Drawer`;
- tablet/foldable ≥600dp: zachowany obecny layout dwukolumnowy.
- Implementacja: hook `useBreakpoint()` + `<MobileShell>` / `<DesktopShell>`.

**b) Terminal (xterm.js)** — najbardziej krytyczny komponent:
- **Wyłączyć `@xterm/addon-webgl`** na Androidzie (znane problemy z utratą kontekstu
  WebGL po `onPause` w WebView) → renderer DOM/Canvas.
- Dodać **pasek klawiszy pomocniczych** nad klawiaturą: `Esc Tab Ctrl Alt ↑↓←→ | / - ~ PgUp PgDn`
  — to jest mobilny odpowiednik „ekranowych przycisków akcji" z briefu.
- Gesty: swipe-poziomo = przełącz sesję, pinch = rozmiar czcionki, long-press = zaznacz/kopiuj.
- `visualViewport` API do przeliczenia `FitAddon` gdy wysuwa się klawiatura ekranowa
  (inaczej prompt chowa się pod klawiaturą).
- `windowSoftInputMode="adjustResize"` w manifeście.

**c) Explorer plików** — tabela 5-kolumnowa → lista jednowierszowa (ikona, nazwa,
metadane w drugiej linii), akcje przez long-press → bottom sheet (zamiennik 19
handlerów `onContextMenu`), swipe-to-delete.

**d) Safe Area** — `viewport-fit=cover` + `env(safe-area-inset-*)` w `theme.css`
dla notcha i paska gestów. Cele dotykowe ≥48dp.

**e) Hover** — 224 klas `hover:` nie działa dotykiem; wprowadzić `@media (hover: hover)`
w warstwie Tailwind, żeby stany hover nie „zostawały przyklejone" po tapnięciu.

### 2.7 Cykl życia i sieć

- `onPause`/`onResume`: WebView jest zamrażany, Rust żyje dalej. Sesje SSH przerwie
  jednak Doze/kill sieci — potrzebny **keep-alive** (`russh` `keepalive_interval`)
  + reconnect po `onResume`, oraz **Foreground Service** z notyfikacją dla
  długich transferów SFTP/S3 (inaczej Android ubije transfer w tle).
- Utrata kontekstu GPU: dotyczy tylko WebGL-owego xterma → rozwiązane przez §2.6b.
- Uprawnienia w manifeście: `INTERNET`, `ACCESS_NETWORK_STATE`,
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS` (API 33+),
  `WAKE_LOCK`. **Bez** `MANAGE_EXTERNAL_STORAGE` (Play by odrzucił).
- `usesCleartextTraffic=false` — SSH to nie HTTP, więc nie przeszkadza.

### 2.8 Macierz ABI i rozmiar artefaktu

| ABI | Priorytet | Uzasadnienie |
|---|---|---|
| `arm64-v8a` | P0 | ~95% aktywnych urządzeń, wymagane przez Play od 2019 |
| `armeabi-v7a` | P1 | Starsze/tanie urządzenia |
| `x86_64` | P1 | Emulator (niezbędny do CI i dev) |
| `x86` | P3 | Praktycznie martwy, pomijamy |

Budowa `--aab` z podziałem per-ABI (Play Store dostarcza tylko właściwy split).
Szacowany rozmiar: ~12–18 MB na ABI (Rust `.so` z SQLite + rustls, bez Chromium —
WebView jest systemowy). `strip` + `lto = true` + `opt-level = "z"` w profilu release.

### 2.9 Plan wdrożenia (fazy 2–5)

| Faza | Zakres | Efekt |
|---|---|---|
| **2. Build green** | `tauri android init`, target-specific deps, `cfg(mobile)` stuby, Keystore vault, logcat | APK się buduje i startuje na emulatorze; lista hostów działa |
| **3. Core flows** | SSH connect + terminal mobilny (pasek klawiszy, viewport, keep-alive), SFTP list/download przez SAF | Da się połączyć i pracować |
| **4. UI polish** | MobileShell, BottomNav, bottom-sheety zamiast PPM, safe-area, tablet layout | Wygląda jak aplikacja mobilna |
| **5. Release** | Foreground Service, podpisywanie, CI matrix, ProGuard, instrukcja build | Podpisany AAB/APK + dokumentacja |

### 2.10 Ryzyka

| Ryzyko | Prawd. | Wpływ | Mitygacja |
|---|---|---|---|
| Rozjazd Android System WebView (Tailwind 4 `oklch`, `color-mix`, `@property`) na starszych WebView | Średnie | Wysoki | Podnieść `minSdkVersion` do 26+, fallbacki `@supports`, testy na WebView 90/120 |
| `android-keyring` niedojrzały | Średnie | Wysoki | Fallback: własny JNI do `EncryptedSharedPreferences` |
| Android ubija sesje SSH w tle | Wysokie | Wysoki | Foreground Service + auto-reconnect + wyraźny UX „rozłączono" |
| Niewidoczna regresja desktopu przez `cfg` | Średnie | Średni | CI buduje desktop + android w jednej matrycy, e2e zostaje na desktopie |
| Play Store odrzuci (uprawnienia/Data Safety/telemetria) | Niskie | Średni | Brak `MANAGE_EXTERNAL_STORAGE`, opt-in telemetrii, wypełniony Data Safety |
| Fork rozjedzie się z upstreamem | Średnie | Niski | Zmiany addytywne + `cfg`, brak forka |

---

## 3. Odpowiedź wprost na pytania z briefu

**Język/silnik/biblioteki graficzne:** Rust (edition 2021) + TypeScript/React 19.
Silnik: Tauri 2.10.3 / wry 0.54 / tao 0.34. Brak SDL2/SFML/OpenGL/Raylib/GLFW.
Jedyny akcelerowany element to `@xterm/addon-webgl` w warstwie WebView.

**Zależności wymagające zastąpienia lub osobnej kompilacji pod ARM:**
`keyring` (brak Androida → Keystore), `ssh2-config` (ciąga `git2`→`openssl-sys`→C →
wyciąć), `drag` (GTK/AppKit/Win32 → wyciąć), `tauri-plugin-updater` i
`tauri-plugin-process` (oficjalnie Android ✗). Kompilacji pod ARM wymaga wyłącznie
`libsqlite3-sys` (bundled) — i to Tauri/NDK załatwia automatycznie.
`russh`, `rustls`, `rust-s3`, `reqwest` są pure-Rust i cross-compilują się bez pracy.

**`ANativeActivity` czy JNI?** Ani jedno, ani drugie ręcznie — Tauri generuje
`WryActivity` (Kotlin/AppCompat) + `MainActivity`, a Rust wchodzi przez
`#[tauri::mobile_entry_point]`, który **już jest** w `lib.rs:41`. Własny JNI piszemy
tylko dla Keystore i SAF.

---

## 4. Co dalej

Czekam na akceptację strategii. Po niej Faza 2 wygeneruje:
`src-tauri/gen/android/**` (Gradle, manifest), zmodyfikowany `Cargo.toml`,
`tauri.conf.json` z sekcją `bundle.android`, moduł `platform/`, nowy `vault`,
`capabilities/mobile.json` oraz `docs/android-port/BUILD.md` z instrukcją krok po kroku.
