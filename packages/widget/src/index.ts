export type Theme = "light" | "dark" | "system";
export type Metadata = Record<string, string | number | boolean>;
export interface CaptureConsent { screenshot?: boolean; consoleLogs?: boolean; }
export interface CapturePolicy { retentionMs?: number; maxConsoleEntries?: number; maxConsoleChars?: number; screenshotMasks?: readonly { x: number; y: number; width: number; height: number }[]; }
export interface ScreenshotCaptureInput { masks: readonly { x: number; y: number; width: number; height: number }[]; element?: { selector: string }; }
export interface WidgetConfig {
  boardId: string; submit: (input: WidgetSubmission) => Promise<void>; theme?: Theme;
  metadata?: Metadata; metadataAllowlist?: readonly string[]; consent?: CaptureConsent; capturePolicy?: CapturePolicy;
  /** Optional host capture implementation. It receives masks before it returns a blob. */
  captureScreenshot?: (input: ScreenshotCaptureInput) => Promise<Blob | undefined>;
  /** Categories are host/server controlled. Unknown categories fail closed. */
  allowedCategories?: readonly WidgetSubmission["category"][];
}
export interface WidgetSubmission { title: string; body: string; category: "bug" | "feature" | "question"; metadata: Metadata; url: string; screenshot?: Blob; consoleLogs?: string[]; }
export interface FlowField { id: string; label: string; required?: boolean; when?: (values: Record<string, unknown>) => boolean; }
export interface FeedbackFlow { id: string; fields: readonly FlowField[]; }
export interface FlowValidation { activeFields: readonly FlowField[]; missing: readonly string[]; }
export interface FeedbackWidget { open(): void; close(): void; hide(): void; show(): void; setTheme(theme: Theme): void; registerFlow(flow: FeedbackFlow): void; submit(input: Omit<WidgetSubmission,"metadata"|"url">): Promise<void>; destroy(): void; }

const SENSITIVE_KEY = /(?:token|key|secret|password|code|session|credential|auth)/i;
export function redactUrl(url: string): string { try { const parsed = new URL(url); for (const [key] of parsed.searchParams) if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, "[REDACTED]"); if (parsed.hash) parsed.hash = parsed.hash.replace(/([#&](?:[^=&]*?(?:token|key|secret|password|code|session|credential|auth)[^=&]*)=)[^&]*/gi, "$1[REDACTED]"); parsed.username = ""; parsed.password = ""; return parsed.toString(); } catch { return ""; } }
export function allowMetadata(input: Metadata | undefined, keys: readonly string[] = []): Metadata { return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => keys.includes(key))); }
export function sanitizeConsoleLogs(entries: readonly string[], consent: boolean, policy: Pick<CapturePolicy, "maxConsoleEntries" | "maxConsoleChars"> = {}): string[] { if (!consent) return []; const count = Math.min(Math.max(policy.maxConsoleEntries ?? 50, 0), 50); const chars = Math.min(Math.max(policy.maxConsoleChars ?? 1000, 0), 1000); return entries.slice(-count).map((entry) => entry.slice(0, chars)); }
/** Capture must have a positive host-enforced retention duration. */
export function validateCapturePolicy(consent: CaptureConsent | undefined, policy: CapturePolicy | undefined): void { if (!(consent?.screenshot || consent?.consoleLogs)) return; const retentionMs = policy?.retentionMs; if (!Number.isSafeInteger(retentionMs) || !retentionMs || retentionMs <= 0) throw new Error("Capture requires a positive, host-enforced retentionMs policy."); }
export async function captureScreenshot(config: Pick<WidgetConfig, "consent" | "capturePolicy" | "captureScreenshot">, element?: { selector: string }): Promise<Blob | undefined> { if (!config.consent?.screenshot || !config.captureScreenshot) return undefined; return config.captureScreenshot({ masks: config.capturePolicy?.screenshotMasks ?? [], element }); }
/** Resolves conditional fields and required values without evaluating host input as code. */
export function validateFlow(flow: FeedbackFlow, values: Record<string, unknown>): FlowValidation { const ids = new Set<string>(); for (const field of flow.fields) { if (!field.id || ids.has(field.id)) throw new Error("Flow field ids must be unique and non-empty."); ids.add(field.id); } const activeFields = flow.fields.filter((field) => field.when?.(values) ?? true); const missing = activeFields.filter((field) => field.required && (values[field.id] === undefined || values[field.id] === null || values[field.id] === "")).map((field) => field.id); return { activeFields, missing }; }
export function elementContext(element: Element | null): { selector: string } | undefined {
  if (!element) return undefined;
  const id = element.getAttribute("id"); if (id) return { selector: `#${CSS.escape(id)}` };
  const context = element.getAttribute("data-feedback-context");
  if (context) return { selector: `[data-feedback-context="${CSS.escape(context)}"]` };
  const testId = element.getAttribute("data-testid");
  if (testId) return { selector: `[data-testid="${CSS.escape(testId)}"]` };
  return { selector: element.tagName.toLowerCase() };
}

export function init(config: WidgetConfig): FeedbackWidget {
  if (!config.boardId) throw new Error("Userr widget requires boardId.");
  validateCapturePolicy(config.consent, config.capturePolicy);
  const host = document.createElement("div"); host.setAttribute("data-userr-widget", "");
  const root = host.attachShadow({ mode: "closed" }); const button = document.createElement("button");
  button.type = "button"; button.textContent = "Feedback"; button.setAttribute("aria-label", "Open feedback");
  button.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;border:0;border-radius:999px;padding:12px 16px;background:#111;color:#fff;cursor:pointer";
  root.append(button); document.body.append(host); let open = false; const flows = new Map<string, FeedbackFlow>();
  const sync = () => { button.textContent = open ? "Close feedback" : "Feedback"; button.setAttribute("aria-expanded", String(open)); };
  button.onclick = () => { open = !open; sync(); }; sync();
  window.dispatchEvent(new CustomEvent("feedback:ready", { detail: { boardId: config.boardId } }));
  return { open: () => { open = true; sync(); }, close: () => { open = false; sync(); }, hide: () => { host.hidden = true; }, show: () => { host.hidden = false; }, setTheme: (theme) => host.dataset.theme = theme, registerFlow: (flow) => { if (!flow.id || flows.has(flow.id)) throw new Error("Flow id must be unique."); flows.set(flow.id, flow); }, async submit(input) { const allowed = config.allowedCategories ?? []; if (!allowed.includes(input.category)) throw new Error("Feedback category is not allowed."); await config.submit({ ...input, metadata: allowMetadata(config.metadata, config.metadataAllowlist), url: redactUrl(location.href), consoleLogs: sanitizeConsoleLogs(input.consoleLogs ?? [], Boolean(config.consent?.consoleLogs), config.capturePolicy), screenshot: config.consent?.screenshot ? (input.screenshot ?? await captureScreenshot(config)) : undefined }); }, destroy: () => host.remove() };
}
