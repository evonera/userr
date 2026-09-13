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
export interface FlowField { id: string; label: string; required?: boolean; multiline?: boolean; placeholder?: string; when?: (values: Record<string, unknown>) => boolean; }
export interface FeedbackFlow { id: string; title?: string; fields: readonly FlowField[]; }
export interface FlowValidation { activeFields: readonly FlowField[]; missing: readonly string[]; }
export interface RenderFlowOptions { initialValues?: Readonly<Record<string, string>>; submitLabel?: string; submissionErrorMessage?: string; onSubmit: (values: Readonly<Record<string, string>>) => void | Promise<void>; onSubmitError?: (error: unknown) => void; }
export interface RenderedFlow { getValues(): Readonly<Record<string, string>>; destroy(): void; }
export interface FeedbackWidget { open(): void; close(): void; hide(): void; show(): void; setTheme(theme: Theme): void; registerFlow(flow: FeedbackFlow): void; submit(input: Omit<WidgetSubmission,"metadata"|"url">): Promise<void>; destroy(): void; }

const SENSITIVE_KEY = /(?:token|key|secret|password|code|session|credential|auth)/i;
let renderedFlowSequence = 0;
export function redactUrl(url: string): string { try { const parsed = new URL(url); for (const [key] of parsed.searchParams) if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, "[REDACTED]"); if (parsed.hash) parsed.hash = parsed.hash.replace(/([#&](?:[^=&]*?(?:token|key|secret|password|code|session|credential|auth)[^=&]*)=)[^&]*/gi, "$1[REDACTED]"); parsed.username = ""; parsed.password = ""; return parsed.toString(); } catch { return ""; } }
export function allowMetadata(input: Metadata | undefined, keys: readonly string[] = []): Metadata { return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => keys.includes(key))); }
export function sanitizeConsoleLogs(entries: readonly string[], consent: boolean, policy: Pick<CapturePolicy, "maxConsoleEntries" | "maxConsoleChars"> = {}): string[] { if (!consent) return []; const count = Math.min(Math.max(policy.maxConsoleEntries ?? 50, 0), 50); const chars = Math.min(Math.max(policy.maxConsoleChars ?? 1000, 0), 1000); return entries.slice(-count).map((entry) => entry.slice(0, chars)); }
/** Capture must have a positive host-enforced retention duration. */
export function validateCapturePolicy(consent: CaptureConsent | undefined, policy: CapturePolicy | undefined): void { if (!(consent?.screenshot || consent?.consoleLogs)) return; const retentionMs = policy?.retentionMs; if (!Number.isSafeInteger(retentionMs) || !retentionMs || retentionMs <= 0) throw new Error("Capture requires a positive, host-enforced retentionMs policy."); }
export async function captureScreenshot(config: Pick<WidgetConfig, "consent" | "capturePolicy" | "captureScreenshot">, element?: { selector: string }): Promise<Blob | undefined> { if (!config.consent?.screenshot || !config.captureScreenshot) return undefined; return config.captureScreenshot({ masks: config.capturePolicy?.screenshotMasks ?? [], element }); }
/** Resolves conditional fields and required values without evaluating host input as code. */
export function validateFlow(flow: FeedbackFlow, values: Record<string, unknown>): FlowValidation { const ids = new Set<string>(); for (const field of flow.fields) { if (!field.id.trim() || field.id.trim() !== field.id || ids.has(field.id)) throw new Error("Flow field ids must be unique, non-empty, and contain no surrounding whitespace."); ids.add(field.id); } const activeFields = flow.fields.filter((field) => field.when?.(values) ?? true); const missing = activeFields.filter((field) => field.required && (!Object.hasOwn(values, field.id) || values[field.id] === undefined || values[field.id] === null || values[field.id] === "")).map((field) => field.id); return { activeFields, missing }; }
/** Renders a flow without HTML injection or a framework dependency. Submission remains host-owned. */
export function renderFlow(container: HTMLElement | ShadowRoot, flow: FeedbackFlow, options: RenderFlowOptions): RenderedFlow {
  const document = container.ownerDocument; const instanceId = ++renderedFlowSequence; const values = Object.fromEntries(flow.fields.flatMap((field) => Object.hasOwn(options.initialValues ?? {}, field.id) ? [[field.id, options.initialValues?.[field.id] ?? ""]] : []));
  validateFlow(flow, values);
  const form = document.createElement("form"); form.dataset.userrFlow = flow.id; form.noValidate = true;
  if (flow.title) { const heading = document.createElement("h2"); heading.textContent = flow.title; form.append(heading); }
  const controls = new Map<string, { wrapper: HTMLDivElement; input: HTMLInputElement | HTMLTextAreaElement; error: HTMLSpanElement }>();
  for (const field of flow.fields) {
    const wrapper = document.createElement("div"); const label = document.createElement("label"); const input = document.createElement(field.multiline ? "textarea" : "input"); const error = document.createElement("span");
    input.id = `userr-flow-${instanceId}-${controls.size}`; input.name = field.id; input.required = Boolean(field.required); input.placeholder = field.placeholder ?? ""; input.value = values[field.id] ?? "";
    label.htmlFor = input.id; label.textContent = field.label; error.id = `${input.id}-error`; error.setAttribute("role", "alert"); error.hidden = true; input.setAttribute("aria-describedby", error.id);
    input.addEventListener("input", () => { values[field.id] = input.value; sync(); });
    wrapper.append(label, input, error); form.append(wrapper); controls.set(field.id, { wrapper, input, error });
  }
  const submit = document.createElement("button"); submit.type = "submit"; submit.textContent = options.submitLabel ?? "Submit feedback"; const submitError = document.createElement("p"); submitError.setAttribute("role", "alert"); submitError.hidden = true; form.append(submit, submitError); let submitting = false;
  const sync = (showErrors = false) => { const validation = validateFlow(flow, values); const active = new Set(validation.activeFields.map((field) => field.id)); const missing = new Set(validation.missing); for (const [id, control] of controls) { const isActive = active.has(id); control.wrapper.hidden = !isActive; control.input.disabled = !isActive; const invalid = showErrors && missing.has(id); control.input.setAttribute("aria-invalid", String(invalid)); control.error.hidden = !invalid; control.error.textContent = invalid ? `${flow.fields.find((field) => field.id === id)?.label ?? id} is required.` : ""; } return validation; };
  form.addEventListener("submit", async (event) => { event.preventDefault(); if (submitting) return; const validation = sync(true); if (validation.missing.length) { controls.get(validation.missing[0])?.input.focus(); return; } const activeValues = Object.fromEntries(validation.activeFields.flatMap((field) => Object.hasOwn(values, field.id) ? [[field.id, values[field.id]]] : [])); submitting = true; submit.disabled = true; form.setAttribute("aria-busy", "true"); submitError.hidden = true; try { await options.onSubmit(Object.freeze(activeValues)); } catch (error) { submitError.textContent = options.submissionErrorMessage ?? "Feedback could not be submitted. Try again."; submitError.hidden = false; options.onSubmitError?.(error); } finally { submitting = false; submit.disabled = false; form.removeAttribute("aria-busy"); } });
  sync(); container.append(form);
  return { getValues: () => Object.freeze({ ...values }), destroy: () => form.remove() };
}
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
