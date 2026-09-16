# Budowanie anySCP na Androida — instrukcja krok po kroku

Dokument opisuje pełną ścieżkę od czystego klonu repozytorium do zainstalowanego
pliku APK na urządzeniu. Dotyczy zmian z Fazy 2 (warstwa platformowa i build).

> **Status:** Faza 2 dostarcza budujący się rdzeń (Rust + warstwa natywna).
> Interfejs jest nadal desktopowy — mobilny layout to Faza 4. Na telefonie
> aplikacja uruchomi się i połączy przez SSH, ale UI będzie wymagał
> przewijania i powiększania.

---

## 1. Wymagania wstępne

| Narzędzie | Wersja | Uwagi |
|---|---|---|
| Rust | stable ≥ 1.77 | przez `rustup` |
| Node.js | ≥ 20 LTS | |
| pnpm | 9.x | `corepack enable` |
| JDK | **17** (Temurin) | JDK 21 bywa niekompatybilny z wtyczką AGP |
| Android SDK | Platform 34+, Build-Tools 34+ | Android Studio albo `cmdline-tools` |
| Android NDK | **r26d** | ta sama wersja co w CI |
| cargo-ndk | najnowsza | `cargo install cargo-ndk --locked` |

### Zmienne środowiskowe

```bash
export ANDROID_HOME="$HOME/Android/Sdk"          # macOS: ~/Library/Android/sdk
export NDK_HOME="$ANDROID_HOME/ndk/26.3.11579264" # r26d
export ANDROID_NDK_HOME="$NDK_HOME"
export JAVA_HOME="/usr/lib/jvm/temurin-17-jdk"    # albo JBR z Android Studio
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

### Cele kompilacji Rust

```bash
rustup target add \
  aarch64-linux-android \
  armv7-linux-androideabi \
  x86_64-linux-android
```

`aarch64` to praktycznie wszystkie współczesne telefony, `armv7` to starsze
32-bitowe urządzenia, `x86_64` jest potrzebny do emulatora.

---

## 2. Przygotowanie projektu

```bash
git clone https://github.com/borysttk/anySCP.git
cd anySCP
pnpm install --frozen-lockfile
```

### Weryfikacja (bez Androida, szybka)

```bash
pnpm build          # tsc + vite  → tworzy dist/, wymagane przez tauri-build
pnpm test           # 133 testy Vitest
cd src-tauri && cargo test && cd ..
```

---

## 3. Inicjalizacja projektu Android

```bash
pnpm tauri android init
```

Generuje `src-tauri/gen/android/` — pełny projekt Gradle z `WryActivity`,
`MainActivity`, `build.gradle.kts` i `AndroidManifest.xml`. Katalog jest
w `.gitignore`, bo to wygenerowany artefakt.

### 3a. Skopiowanie źródeł Kotlin

```bash
make android-sync
```

Kopiuje wersjonowane pliki z `src-tauri/android/` do wygenerowanego drzewa:

| Plik | Rola |
|---|---|
| `SecureStore.kt` | `EncryptedSharedPreferences` + Android Keystore — backend dla modułu `vault` |
| `TransferService.kt` | Foreground Service podtrzymujący transfery w tle |
| `SafBridge.kt` | Storage Access Framework — picker i zapis przez `content://` |
| `MainActivity.kt` | **nadpisuje** wygenerowaną aktywność; dodaje hooki `onResume`/`onPause` i przekazywanie wyników pickera |

> `MainActivity.kt` zastępuje plik wygenerowany przez `tauri android init`.
> Jeśli przyszła wersja Tauri zmieni klasę bazową aktywności, trzeba pogodzić
> nasz plik z nowym wygenerowanym, a nie odwrotnie.

**Polecenie trzeba powtórzyć po każdym ponownym `android init`** — regeneracja
czyści katalog.

### 3b. Scalenie manifestu (ręcznie, jednorazowo)

Otwórz `src-tauri/gen/android/app/src/main/AndroidManifest.xml` i nanieś
zawartość `src-tauri/android/AndroidManifest.additions.xml`:

1. **Uprawnienia** (przed `<application>`):
   `INTERNET`, `ACCESS_NETWORK_STATE`, `FOREGROUND_SERVICE`,
   `FOREGROUND_SERVICE_DATA_SYNC`, `POST_NOTIFICATIONS`.
2. **Element `<service>`** dla `.TransferService` wewnątrz `<application>`.
3. **Atrybuty `MainActivity`**:
   ```xml
   android:windowSoftInputMode="adjustResize"
   android:configChanges="orientation|screenSize|screenLayout|keyboardHidden|uiMode"
   ```
   Pierwszy sprawia, że webview kurczy się przy wysuniętej klawiaturze (inaczej
   prompt chowa się pod IME). Drugi zapobiega rekreacji aktywności przy obrocie
   ekranu — bez niego **każdy obrót zrywa wszystkie sesje SSH**.

### 3c. Zależność AndroidX Security

W `src-tauri/gen/android/app/build.gradle.kts`, w bloku `dependencies`:

```kotlin
implementation("androidx.security:security-crypto:1.1.0-alpha06")
```

Wymagane przez `SecureStore.kt`. Bez tego build Gradle zakończy się błędem
`Unresolved reference: EncryptedSharedPreferences`.

---

## 4. Szybka weryfikacja kompilacji krzyżowej

Zanim uruchomisz pełny build Gradle (wolny), sprawdź samą warstwę Rust:

```bash
make android-check
```

Równoważne `cargo ndk -t arm64-v8a -t armeabi-v7a -t x86_64 check --lib`.
Wyłapuje najczęstszy błąd portu — desktopową zależność (`keyring`, `drag`,
`ssh2-config`, `updater`, `process`), która wróciła do domyślnego zestawu.

> **CI:** gotowy job znajduje się w `docs/android-port/ci-android-job.yml`
> i trzeba go **wkleić ręcznie** do `.github/workflows/ci.yml` (po jobie
> `rust`). Nie został dodany automatycznie, bo token agenta nie ma
> uprawnienia `workflows` — GitHub odrzuca push zmieniający pliki workflow.

---

## 5. Uruchomienie na urządzeniu / emulatorze

```bash
adb devices                 # urządzenie musi być widoczne
pnpm tauri android dev
```

Buduje debug APK, instaluje i podłącza hot-reload frontendu.

Logi (Rust trafia do logcat przez `tracing-logcat`):

```bash
adb logcat -s anySCP:V RustStdoutStderr:V
```

---

## 6. Build release

### 6a. Keystore (jednorazowo)

```bash
keytool -genkey -v \
  -keystore ~/anyscp-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias anyscp
```

`src-tauri/gen/android/keystore.properties`:

```properties
storeFile=/absolute/path/to/anyscp-release.jks
storePassword=...
keyAlias=anyscp
keyPassword=...
```

> ⚠️ Plik jest w `.gitignore`. **Nigdy go nie commituj.** Utrata keystore
> oznacza brak możliwości wydania aktualizacji w Google Play.

W `app/build.gradle.kts` podłącz `signingConfigs` do `buildTypes.release`
zgodnie z https://tauri.app/distribute/sign/android/.

### 6b. Artefakty

```bash
# APK — instalacja bezpośrednia / dystrybucja poza Play
pnpm tauri android build --apk

# AAB — wymagany przez Google Play
pnpm tauri android build --aab
```

Wynik:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

### 6c. Instalacja

```bash
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

---

## 7. Rozwiązywanie problemów

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| `failed to run linker cc` | Brak NDK lub złe `NDK_HOME` | Sprawdź `ls $NDK_HOME/toolchains/llvm/prebuilt` |
| `could not find native static library` przy `openssl` | Wróciła zależność ciągnąca `openssl-sys` | `cargo tree -i openssl-sys --target aarch64-linux-android` |
| `Unresolved reference: EncryptedSharedPreferences` | Brak kroku 3c | Dodaj `androidx.security:security-crypto` |
| `ClassNotFoundException: SecureStore` | Nie wykonano `make android-sync` | Uruchom i przebuduj |
| Sesje SSH giną po obrocie ekranu | Brak `configChanges` | Krok 3b.3 |
| Prompt chowa się pod klawiaturą | Brak `adjustResize` | Krok 3b.3 |
| Transfer zatrzymuje się w tle | Foreground Service nie wystartował | Sprawdź logcat pod `TransferService`; zweryfikuj uprawnienia |
| Brak logów w logcat | Filtrujesz zły tag | `adb logcat -s anySCP:V` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Zmiana podpisu (debug ↔ release) | `adb uninstall com.macnev2013.anyscp` |

---

## 8. Reconnect i SAF — jak to działa

### Reconnect po powrocie z tła

Android zamraża proces w tle i po cichu zabija gniazda TCP. Po powrocie mapa
sesji w Rust nadal wygląda zdrowo, a naciśnięte klawisze znikają w martwym
gnieździe.

Przepływ:

1. `MainActivity.onResume()` → JNI → `platform::lifecycle::on_resume()`
2. `ssh::reconnect::resume_sweep()` sonduje **równolegle** każdą sesję
   (`probe`, timeout 2,5 s) — otwarcie testowego kanału wymusza round-trip,
   bo samo `Handle::is_closed()` nie wykrywa zamrożonego gniazda
3. martwe sesje przechodzą przez `reconnect_in_place()` — **ten sam
   `session_id`**, więc zakładka, układ paneli i bufor `xterm.js` zostają
4. 3 próby, backoff 750 ms → 1,5 s → 3 s; błąd uwierzytelnienia przerywa
   natychmiast (kolejne próby tylko zbliżają do blokady konta na serwerze)

**Czego reconnect NIE odtwarza:** zdalna powłoka dostała SIGHUP razem
z zerwaniem transportu. Katalog roboczy, zmienne środowiskowe, historia
i uruchomione procesy przepadają — to nowa powłoka. Użytkownik dostaje o tym
jawny komunikat w terminalu (żółty baner przy zerwaniu, zielony z ostrzeżeniem
po wznowieniu). Bufor przewijania jest zachowany, więc można skopiować logi
sprzed zerwania.

Przetrwanie sesji wymagałoby multipleksera (`tmux`/`screen`) po stronie
serwera, czego nie można założyć — routery z BusyBox i minimalne kontenery
często go nie mają. Planowane jako opcjonalna flaga per-host, nie domyślnie.

Ta sama ścieżka obsługuje przycisk „Reconnect” w `DisconnectOverlay`, więc
ręczny i automatyczny reconnect zachowują się identycznie.

### Zapis plików (SAF)

Scoped Storage (API 29+) blokuje zapis do `/sdcard/Download`. Pobieranie
jest dwuetapowe:

1. `sftp_saf_begin_export` → picker systemowy → zwraca prywatną ścieżkę
   roboczą **oraz** URI `content://`
2. transfer zapisuje do ścieżki roboczej
3. `sftp_saf_finish_export` kopiuje do wybranej lokalizacji i sprząta cache

Etap pośredni jest celowy: zapis strumieniowy prosto do URI zostawiłby
obcięty plik w folderze Pobrane, gdyby połączenie padło w trakcie. Tak wynik
jest atomowy z punktu widzenia użytkownika.

Frontend nie widzi tego podziału — `pickDownloadTarget()`
(`src/lib/download-target.ts`) zwraca ścieżkę i `finalize()`/`discard()`,
a na desktopie po prostu deleguje do `save()` z plugin-dialog.

## 9. Czego jeszcze nie ma

Świadome ograniczenia obecnego stanu:

- **UI jest desktopowy** — brak layoutu mobilnego, bottom-nav i bottom-sheetów
  zamiast menu kontekstowych (Faza 5).
- **Pobieranie katalogów** nadal używa `enqueue_download` z lokalnym
  katalogiem; SAF obsługuje na razie pojedyncze pliki
  (`ACTION_OPEN_DOCUMENT_TREE` jest gotowe w `SafBridge.kt`, ale niepodpięte).
- **Import kluczy SSH** wymaga pickera SAF — obecnie `~/.ssh` nie istnieje,
  więc lista kluczy jest pusta (celowo, nie jest to błąd).
- **Upload** nie ma jeszcze pickera źródłowego (`ACTION_OPEN_DOCUMENT`).
- **S3 i port-forwarding** kompilują się, ale ich UI nie był adaptowany —
  poza zakresem v1 zgodnie z ustaleniami.

Funkcje trwale niedostępne na Androidzie (zwracają czytelny błąd):
auto-updater, `relaunch()`, drag-out plików, edycja w zewnętrznym edytorze,
import `~/.ssh/config`, konwersja kluczy PuTTY PPK.
