import { init, type WidgetConfig } from "./index.js";

declare global { interface Window { Feedback?: ReturnType<typeof init>; } }

/** Script-tag bootstrap. The host supplies a submit callback after load; this
 * bootstrap only reads public presentation data and never discovers secrets. */
export function bootstrap(config: WidgetConfig): ReturnType<typeof init> {
  const widget = init(config); window.Feedback = widget; return widget;
}

const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.board && !window.Feedback) {
  // A script tag needs a host-owned submit bridge. Fail closed until one is
  // installed instead of silently sending capture data to a vendor endpoint.
  window.dispatchEvent(new CustomEvent("feedback:bootstrap", { detail: { boardId: script.dataset.board } }));
}
