import { init, type WidgetConfig } from "./index.js";
import { editScreenshot } from "./screenshot.js";
export { editScreenshot } from "./screenshot.js";

export type BrowserFeedback = ReturnType<typeof init> & { editScreenshot: typeof editScreenshot };
declare global { interface Window { Feedback?: BrowserFeedback; } }

/** Script-tag bootstrap. The host supplies a submit callback after load; this
 * bootstrap only reads public presentation data and never discovers secrets. */
export function bootstrap(config: WidgetConfig): BrowserFeedback {
  const widget = Object.assign(init(config), { editScreenshot }); window.Feedback = widget; return widget;
}

const script = document.currentScript as HTMLScriptElement | null;
if (script?.dataset.board && !window.Feedback) {
  // A script tag needs a host-owned submit bridge. Fail closed until one is
  // installed instead of silently sending capture data to a vendor endpoint.
  window.dispatchEvent(new CustomEvent("feedback:bootstrap", { detail: {
    boardId: script.dataset.board,
    theme: script.dataset.theme,
    color: script.dataset.color,
    position: script.dataset.position,
    locale: script.dataset.locale,
  } }));
}
