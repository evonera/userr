export type Theme = "light" | "dark" | "system";
export type Metadata = Record<string, string | number | boolean>;
export interface CaptureConsent { screenshot?: boolean; consoleLogs?: boolean; }
export interface WidgetConfig {
  boardId: string; submit: (input: WidgetSubmission) => Promise<void>; theme?: Theme;
  metadata?: Metadata; metadataAllowlist?: readonly string[]; consent?: CaptureConsent;
  /** Categories are host/server controlled. Unknown categories fail closed. */
  allowedCategories?: readonly WidgetSubmission["category"][];
}
export interface WidgetSubmission { title: string; body: string; category: "bug" | "feature" | "question"; metadata: Metadata; url: string; screenshot?: Blob; consoleLogs?: string[]; }
export interface FlowField { id: string; label: string; required?: boolean; when?: (values: Record<string, unknown>) => boolean; }
export interface FeedbackFlow { id: string; fields: readonly FlowField[]; }
export interface FeedbackWidget { open(): void; close(): void; hide(): void; show(): void; setTheme(theme: Theme): void; registerFlow(flow: FeedbackFlow): void; submit(input: Omit<WidgetSubmission,"metadata"|"url">): Promise<void>; destroy(): void; }

const REDACT = /([?&](?:token|key|secret|password|code|session)=)[^&]*/gi;
export function redactUrl(url: string): string { try { const parsed = new URL(url); return parsed.toString().replace(REDACT, "$1[REDACTED]"); } catch { return ""; } }
export function allowMetadata(input: Metadata | undefined, keys: readonly string[] = []): Metadata { return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => keys.includes(key))); }
export function sanitizeConsoleLogs(entries: readonly string[], consent: boolean): string[] { return consent ? entries.slice(-50).map((entry) => entry.slice(0, 1000)).filter((entry) => entry.length <= 1000).slice(-50) : []; }
export function elementContext(element: Element | null): { selector: string } | undefined {
  if (!element) return undefined;
  const id = element.getAttribute("id"); if (id) return { selector: `#${CSS.escape(id)}` };
  const named = element.getAttribute("data-feedback-context") ?? element.getAttribute("data-testid");
  if (named) return { selector: `[data-feedback-context="${CSS.escape(named)}"]` };
  return { selector: element.tagName.toLowerCase() };
}

export function init(config: WidgetConfig): FeedbackWidget {
  if (!config.boardId) throw new Error("Userr widget requires boardId.");
  const host = document.createElement("div"); host.setAttribute("data-userr-widget", "");
  const root = host.attachShadow({ mode: "closed" }); const button = document.createElement("button");
  button.type = "button"; button.textContent = "Feedback"; button.setAttribute("aria-label", "Open feedback");
  button.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;border-radius:999px;padding:12px 16px;background:#111;color:#fff;cursor:pointer";
  root.append(button); document.body.append(host); let open = false; const flows = new Map<string, FeedbackFlow>();
  const sync = () => { button.textContent = open ? "Close feedback" : "Feedback"; button.setAttribute("aria-expanded", String(open)); };
  button.onclick = () => { open = !open; sync(); }; sync();
  window.dispatchEvent(new CustomEvent("feedback:ready", { detail: { boardId: config.boardId } }));
  return { open: () => { open = true; sync(); }, close: () => { open = false; sync(); }, hide: () => { host.hidden = true; }, show: () => { host.hidden = false; }, setTheme: (theme) => host.dataset.theme = theme, registerFlow: (flow) => { if (!flow.id || flows.has(flow.id)) throw new Error("Flow id must be unique."); flows.set(flow.id, flow); }, async submit(input) { if (config.allowedCategories && !config.allowedCategories.includes(input.category)) throw new Error("Feedback category is not allowed."); await config.submit({ ...input, metadata: allowMetadata(config.metadata, config.metadataAllowlist), url: redactUrl(location.href), consoleLogs: sanitizeConsoleLogs(input.consoleLogs ?? [], Boolean(config.consent?.consoleLogs)), screenshot: config.consent?.screenshot ? input.screenshot : undefined }); }, destroy: () => host.remove() };
}
