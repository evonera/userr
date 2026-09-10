import { useEffect, useRef } from "react";

export type HotkeyHandler = (event: KeyboardEvent) => void;

/**
 * Minimal keyboard shortcuts for triage. Single-character bindings fire only
 * when the user is not typing (text inputs, textareas, selects,
 * contentEditable). Checkboxes, radios, and buttons keep shortcuts alive —
 * the select-then-actuate triage flow depends on it.
 *
 * Handlers always see latest state via a ref: bindings are re-read on every
 * keypress, never frozen at mount. No dependency; hosts needing sequences or
 * chords can swap this out.
 */
export function useHotkeys(bindings: Record<string, HotkeyHandler>): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
        if (tag === "INPUT") {
          const type = (target as HTMLInputElement).type;
          if (
            type !== "checkbox" &&
            type !== "radio" &&
            type !== "button" &&
            type !== "submit" &&
            type !== "reset"
          ) {
            return;
          }
        }
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const handler = ref.current[event.key];
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
