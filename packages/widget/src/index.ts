export type Theme = "light" | "dark" | "system";
export * from "./screenshot.js";
export type Metadata = Record<string, string | number | boolean>;
export interface CaptureConsent { screenshot?: boolean; consoleLogs?: boolean; }
export interface CapturePolicy { retentionMs?: number; maxConsoleEntries?: number; maxConsoleChars?: number; screenshotMasks?: readonly { x: number; y: number; width: number; height: number }[]; }
export interface ScreenshotCaptureInput { masks: readonly { x: number; y: number; width: number; height: number }[]; element?: { selector: string }; }
export interface WidgetConfig {
  boardId: string; submit: (input: WidgetSubmission) => Promise<void>; theme?: Theme;
  /** A small first-visit prompt. It is shown once per board and origin unless
   * welcomeOnce is false. */
  welcomeMessage?: string; welcomeOnce?: boolean; dismissible?: boolean;
  /** Short-lived token minted and verified by the host. The signing secret never enters the browser. */
  hostToken?: string; getHostToken?: () => string | undefined | Promise<string | undefined>;
  metadata?: Metadata; metadataAllowlist?: readonly string[]; consent?: CaptureConsent; capturePolicy?: CapturePolicy;
  /** Optional host capture implementation. It receives masks before it returns a blob. */
  captureScreenshot?: (input: ScreenshotCaptureInput) => Promise<Blob | undefined>;
  /** Categories are host/server controlled. Unknown categories fail closed. */
  allowedCategories?: readonly WidgetSubmission["category"][];
}
export interface WidgetSubmission { title: string; body: string; category: "bug" | "feature" | "question"; metadata: Metadata; url: string; hostToken?: string; screenshot?: Blob; consoleLogs?: string[]; }
export interface FlowField { id: string; label: string; required?: boolean; multiline?: boolean; placeholder?: string; when?: (values: Record<string, unknown>) => boolean; }
export interface FeedbackFlow { id: string; title?: string; fields: readonly FlowField[]; }
export interface FlowValidation { activeFields: readonly FlowField[]; missing: readonly string[]; }
export interface RenderFlowOptions { initialValues?: Readonly<Record<string, string>>; submitLabel?: string; submissionErrorMessage?: string; onSubmit: (values: Readonly<Record<string, string>>) => void | Promise<void>; onSubmitError?: (error: unknown) => void; }
export interface RenderedFlow { getValues(): Readonly<Record<string, string>>; destroy(): void; }
export interface FeedbackWidget { open(): void; close(): void; hide(): void; show(): void; dismiss(): void; setTheme(theme: Theme): void; setHostToken(token: string | undefined): void; registerFlow(flow: FeedbackFlow): void; submit(input: Omit<WidgetSubmission,"metadata"|"url"|"hostToken">): Promise<void>; destroy(): void; }

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
  const welcome = document.createElement("aside"); const welcomeText = document.createElement("p"); const dismissButton = document.createElement("button");
  welcomeText.textContent = config.welcomeMessage ?? "Share feedback with us."; dismissButton.type = "button"; dismissButton.textContent = "×"; dismissButton.setAttribute("aria-label", "Dismiss feedback launcher");
  welcome.style.cssText = "position:fixed;right:16px;bottom:68px;z-index:2147483647;display:flex;gap:8px;align-items:start;max-width:240px;border-radius:10px;padding:10px 12px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px #0003";
  welcomeText.style.cssText = "margin:0"; dismissButton.style.cssText = "border:0;background:transparent;color:inherit;cursor:pointer;font-size:18px;line-height:1"; welcome.append(welcomeText, dismissButton);
  const welcomeKey = `userr:widget:welcome:${config.boardId}`; let welcomeVisible = true;
  if (config.welcomeOnce !== false) { try { welcomeVisible = localStorage.getItem(welcomeKey) !== "seen"; if (welcomeVisible) localStorage.setItem(welcomeKey, "seen"); } catch { welcomeVisible = true; } }
  const syncWelcome = () => { welcome.hidden = !welcomeVisible; host.dataset.welcomeVisible = String(welcomeVisible); };
  root.append(button, welcome); document.body.append(host); let open = false; let hostToken = config.hostToken; const flows = new Map<string, FeedbackFlow>();
  const clearWelcome = () => { welcomeVisible = false; syncWelcome(); };
  const sync = () => { button.textContent = open ? "Close feedback" : "Feedback"; button.setAttribute("aria-expanded", String(open)); };
  const dismiss = () => { clearWelcome(); host.hidden = true; window.dispatchEvent(new CustomEvent("feedback:dismissed", { detail: { boardId: config.boardId } })); };
  button.onclick = () => { open = !open; clearWelcome(); sync(); }; dismissButton.onclick = () => config.dismissible === false ? clearWelcome() : dismiss(); sync(); syncWelcome(); if (config.theme) host.dataset.theme = config.theme;
  window.dispatchEvent(new CustomEvent("feedback:ready", { detail: { boardId: config.boardId } }));
  return { open: () => { open = true; clearWelcome(); sync(); }, close: () => { open = false; sync(); }, hide: () => { host.hidden = true; }, show: () => { host.hidden = false; }, dismiss, setTheme: (theme) => host.dataset.theme = theme, setHostToken: (token) => { hostToken = token; }, registerFlow: (flow) => { if (!flow.id || flows.has(flow.id)) throw new Error("Flow id must be unique."); flows.set(flow.id, flow); }, async submit(input) { const allowed = config.allowedCategories ?? []; if (!allowed.includes(input.category)) throw new Error("Feedback category is not allowed."); const submissionToken = config.getHostToken ? await config.getHostToken() : hostToken; await config.submit({ ...input, metadata: allowMetadata(config.metadata, config.metadataAllowlist), url: redactUrl(location.href), hostToken: submissionToken, consoleLogs: sanitizeConsoleLogs(input.consoleLogs ?? [], Boolean(config.consent?.consoleLogs), config.capturePolicy), screenshot: config.consent?.screenshot ? (input.screenshot ?? await captureScreenshot(config)) : undefined }); }, destroy: () => host.remove() };
}
