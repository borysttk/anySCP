import { useCallback, useState } from "react";
import { getTerminal } from "../../stores/terminal-instances";

/**
 * On-screen key bar for the mobile terminal.
 *
 * Android soft keyboards have no Esc, Tab, Ctrl, Alt or arrow keys, which makes
 * a shell effectively unusable: no tab-completion, no Ctrl-C, no history. This
 * bar sits directly above the IME and sends the missing sequences.
 *
 * Input is written straight to the PTY rather than synthesised as DOM key
 * events. xterm's `onData` is the single path to the backend (see
 * `terminal-instances.ts`), so emitting the bytes keeps this consistent with
 * ordinary typing and avoids depending on the webview's key-event behaviour,
 * which varies across Android keyboards.
 */

/** Control-key sequence for a letter: Ctrl-A is 0x01, Ctrl-C is 0x03, etc. */
function ctrlSeq(letter: string): string {
  const code = letter.toUpperCase().charCodeAt(0) - 64;
  return String.fromCharCode(code);
}

interface KeyDef {
  label: string;
  /** Literal bytes to send. Omitted for the sticky modifiers. */
  data?: string;
  /** Wider cell for labels that would otherwise be cramped. */
  wide?: boolean;
}

/**
 * Arrow keys emit the xterm "normal" (cursor) sequences rather than the
 * application-mode ones; xterm.js rewrites them when the program requests
 * application cursor keys, so full-screen apps such as vim still work.
 */
const KEYS: KeyDef[] = [
  { label: "Esc", data: "\x1b", wide: true },
  { label: "Tab", data: "\t", wide: true },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "↑", data: "\x1b[A" },
  { label: "↓", data: "\x1b[B" },
  { label: "←", data: "\x1b[D" },
  { label: "→", data: "\x1b[C" },
  { label: "PgUp", data: "\x1b[5~", wide: true },
  { label: "PgDn", data: "\x1b[6~", wide: true },
];

interface TerminalKeyBarProps {
  sessionId: string;
}

export function TerminalKeyBar({ sessionId }: TerminalKeyBarProps) {
  // Sticky modifiers: tapping Ctrl arms it, the next key consumes it. This
  // mirrors how hardware-keyboard-less terminals on iOS/Android behave and
  // avoids requiring a two-finger chord on a touchscreen.
  const [ctrlArmed, setCtrlArmed] = useState(false);
  const [altArmed, setAltArmed] = useState(false);

  const send = useCallback(
    (data: string) => {
      const term = getTerminal(sessionId)?.term;
      if (!term) return;

      let out = data;

      // Ctrl only has meaning for letters and a handful of symbols; for
      // anything else (arrows, PgUp) the modifier is dropped rather than
      // emitting a bogus sequence.
      if (ctrlArmed && /^[a-zA-Z]$/.test(data)) {
        out = ctrlSeq(data);
        setCtrlArmed(false);
      } else if (ctrlArmed) {
        setCtrlArmed(false);
      }

      // Alt/Meta is ESC-prefixed, which is what readline and vim expect.
      if (altArmed) {
        out = `\x1b${out}`;
        setAltArmed(false);
      }

      // Route through the same handler ordinary keystrokes use.
      term.input(out);
    },
    [sessionId, ctrlArmed, altArmed],
  );

  const cellBase =
    "flex items-center justify-center h-9 rounded-md border border-border " +
    "bg-bg-elevated text-text-primary text-sm font-mono select-none " +
    "active:bg-accent-muted transition-colors";

  return (
    <div
      className="flex gap-1 overflow-x-auto px-2 py-1.5 border-t border-border bg-bg-base"
      // The bar must not steal focus: blurring the terminal would dismiss the
      // soft keyboard on every tap.
      onPointerDown={(e) => e.preventDefault()}
      role="toolbar"
      aria-label="Terminal keys"
    >
      <button
        type="button"
        aria-pressed={ctrlArmed}
        onClick={() => setCtrlArmed((v) => !v)}
        className={`${cellBase} min-w-12 px-2 ${ctrlArmed ? "bg-accent text-white border-accent" : ""}`}
      >
        Ctrl
      </button>
      <button
        type="button"
        aria-pressed={altArmed}
        onClick={() => setAltArmed((v) => !v)}
        className={`${cellBase} min-w-12 px-2 ${altArmed ? "bg-accent text-white border-accent" : ""}`}
      >
        Alt
      </button>

      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          onClick={() => send(k.data ?? "")}
          className={`${cellBase} ${k.wide ? "min-w-12 px-2" : "min-w-9"}`}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}
