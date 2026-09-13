export type Theme = "light" | "dark" | "system";
export * from "./screenshot.js";
export type Metadata = Record<string, string | number | boolean>;
export interface CaptureConsent { screenshot?: boolean; consoleLogs?: boolean; }
export interface CapturePolicy { retentionMs?: number; maxConsoleEntries?: number; maxConsoleChars?: number; maxConsoleTotalChars?: number; screenshotMasks?: readonly PrivacyMask[]; autoPrivacyMasks?: boolean; }
export interface PrivacyMask { x: number; y: number; width: number; height: number; }
export interface ElementContext { selector: string; componentStack?: readonly string[]; source?: { file: string; line?: number }; }
export interface ScreenshotCaptureInput { masks: readonly PrivacyMask[]; element?: ElementContext; }
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
export interface FlowScreen { id: string; title?: string; fields: readonly FlowField[]; when?: (values: Record<string, unknown>) => boolean; }
export interface FeedbackFlow { id: string; title?: string; fields?: readonly FlowField[]; screens?: readonly FlowScreen[]; }
export interface FlowValidation { activeFields: readonly FlowField[]; missing: readonly string[]; }
export interface RenderFlowOptions { initialValues?: Readonly<Record<string, string>>; submitLabel?: string; submissionErrorMessage?: string; onSubmit: (values: Readonly<Record<string, string>>) => void | Promise<void>; onSubmitError?: (error: unknown) => void; }
export interface RenderedFlow { getValues(): Readonly<Record<string, string>>; destroy(): void; }
export interface FeedbackVariant { submit(input: Omit<WidgetSubmission,"metadata"|"url"|"hostToken">): Promise<void>; }
export interface FeedbackWidget { open(): void; close(): void; hide(): void; show(): void; dismiss(): void; setTheme(theme: Theme): void; setHostToken(token: string | undefined): void; registerFlow(flow: FeedbackFlow): void; registerVariant(id: string): FeedbackVariant; submit(input: Omit<WidgetSubmission,"metadata"|"url"|"hostToken">): Promise<void>; destroy(): void; }

const SENSITIVE_KEY = /(?:token|key|secret|password|code|session|credential|auth)/i;
let renderedFlowSequence = 0;
export function redactUrl(url: string): string { try { const parsed = new URL(url); for (const [key] of parsed.searchParams) if (SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, "[REDACTED]"); if (parsed.hash) parsed.hash = parsed.hash.replace(/([#&](?:[^=&]*?(?:token|key|secret|password|code|session|credential|auth)[^=&]*)=)[^&]*/gi, "$1[REDACTED]"); parsed.username = ""; parsed.password = ""; return parsed.toString(); } catch { return ""; } }
export function allowMetadata(input: Metadata | undefined, keys: readonly string[] = []): Metadata { return Object.fromEntries(Object.entries(input ?? {}).filter(([key]) => keys.includes(key))); }
export function sanitizeConsoleLogs(entries: readonly string[], consent: boolean, policy: Pick<CapturePolicy, "maxConsoleEntries" | "maxConsoleChars" | "maxConsoleTotalChars"> = {}): string[] { if (!consent) return []; const count = Math.min(Math.max(policy.maxConsoleEntries ?? 50, 0), 50); const chars = Math.min(Math.max(policy.maxConsoleChars ?? 1000, 0), 1000); let remaining = Math.min(Math.max(policy.maxConsoleTotalChars ?? 12_000, 0), 12_000); const kept: string[] = []; for (const entry of entries.slice(-count).reverse()) { if (remaining <= 0) break; const value = entry.slice(0, Math.min(chars, remaining)); kept.push(value); remaining -= value.length; } return kept.reverse(); }
/** Capture must have a positive host-enforced retention duration. */
export function validateCapturePolicy(consent: CaptureConsent | undefined, policy: CapturePolicy | undefined): void { if (!(consent?.screenshot || consent?.consoleLogs)) return; const retentionMs = policy?.retentionMs; if (!Number.isSafeInteger(retentionMs) || !retentionMs || retentionMs <= 0) throw new Error("Capture requires a positive, host-enforced retentionMs policy."); }
export function collectPrivacyMasks(root?: ParentNode): PrivacyMask[] { const scope = root ?? (typeof document === "undefined" ? undefined : document); if (!scope) return []; const sensitive: Element[] = []; const visit = (node: ParentNode) => { for (const element of node.querySelectorAll("*")) { const tokens = (element.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).filter(Boolean); const inputType = element.tagName.toLowerCase() === "input" ? (element.getAttribute("type") ?? "text").toLowerCase() : undefined; if (element.hasAttribute("data-feedback-mask") || (inputType !== undefined && (inputType === "password" || tokens.some((token) => token === "current-password" || token === "new-password" || token === "one-time-code" || token.startsWith("cc-"))))) sensitive.push(element); if (element.shadowRoot) visit(element.shadowRoot); } }; visit(scope); return sensitive.flatMap((element) => { const rect = element.getBoundingClientRect(); return Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.width > 0 && rect.height > 0 ? [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }] : []; }); }
export async function captureScreenshot(config: Pick<WidgetConfig, "consent" | "capturePolicy" | "captureScreenshot">, element?: ElementContext): Promise<Blob | undefined> { if (!config.consent?.screenshot || !config.captureScreenshot) return undefined; const masks = [...(config.capturePolicy?.screenshotMasks ?? []), ...(config.capturePolicy?.autoPrivacyMasks === false ? [] : collectPrivacyMasks())]; return config.captureScreenshot({ masks, element }); }
/** Resolves conditional fields and required values without evaluating host input as code. */
function flowScreens(flow: FeedbackFlow): readonly FlowScreen[] { const hasFields = flow.fields !== undefined; const hasScreens = flow.screens !== undefined; if (hasFields === hasScreens) throw new Error("A flow must provide exactly one of fields or screens."); if (hasScreens) { if (!flow.screens!.length) throw new Error("A flow requires at least one screen."); return flow.screens!; } if (!flow.fields!.length) throw new Error("A flow requires at least one field."); return [{ id: `${flow.id}-form`, fields: flow.fields! }]; }
function activeFlowScreens(screens: readonly FlowScreen[], values: Record<string, unknown>): readonly FlowScreen[] { const active = screens.filter((screen) => screen.when?.(values) ?? true); return active.length ? active : [screens[0]]; }
export function validateFlow(flow: FeedbackFlow, values: Record<string, unknown>): FlowValidation { const ids = new Set<string>(); const screenIds = new Set<string>(); const screens = flowScreens(flow); for (const screen of screens) { if (!screen.id.trim() || screen.id.trim() !== screen.id || screenIds.has(screen.id)) throw new Error("Flow screen ids must be unique, non-empty, and contain no surrounding whitespace."); screenIds.add(screen.id); for (const field of screen.fields) { if (!field.id.trim() || field.id.trim() !== field.id || ids.has(field.id)) throw new Error("Flow field ids must be unique, non-empty, and contain no surrounding whitespace."); ids.add(field.id); } } const activeFields = activeFlowScreens(screens, values).flatMap((screen) => screen.fields.filter((field) => field.when?.(values) ?? true)); const missing = activeFields.filter((field) => field.required && (!Object.hasOwn(values, field.id) || values[field.id] === undefined || values[field.id] === null || values[field.id] === "")).map((field) => field.id); return { activeFields, missing }; }
/** Renders a flow without HTML injection or a framework dependency. Submission remains host-owned. */
export function renderFlow(container: HTMLElement | ShadowRoot, flow: FeedbackFlow, options: RenderFlowOptions): RenderedFlow {
  const document = container.ownerDocument; const instanceId = ++renderedFlowSequence; const screens = flowScreens(flow); const allFields = screens.flatMap((screen) => screen.fields); const values = Object.fromEntries(allFields.flatMap((field) => Object.hasOwn(options.initialValues ?? {}, field.id) ? [[field.id, options.initialValues?.[field.id] ?? ""]] : []));
  validateFlow(flow, values);
  const form = document.createElement("form"); form.dataset.userrFlow = flow.id; form.noValidate = true;
  if (flow.title) { const heading = document.createElement("h2"); heading.textContent = flow.title; form.append(heading); }
  const screenElements = new Map<string, HTMLElement>(); const controls = new Map<string, { screenId: string; wrapper: HTMLDivElement; input: HTMLInputElement | HTMLTextAreaElement; error: HTMLSpanElement }>();
  for (const screen of screens) { const section = document.createElement("section"); section.dataset.userrScreen = screen.id; if (screen.title) { const heading = document.createElement("h3"); heading.textContent = screen.title; section.append(heading); } screenElements.set(screen.id, section); form.append(section);
  for (const field of screen.fields) {
    const wrapper = document.createElement("div"); const label = document.createElement("label"); const input = document.createElement(field.multiline ? "textarea" : "input"); const error = document.createElement("span");
    input.id = `userr-flow-${instanceId}-${controls.size}`; input.name = field.id; input.required = Boolean(field.required); input.placeholder = field.placeholder ?? ""; input.value = values[field.id] ?? "";
    label.htmlFor = input.id; label.textContent = field.label; error.id = `${input.id}-error`; error.setAttribute("role", "alert"); error.hidden = true; input.setAttribute("aria-describedby", error.id);
    input.addEventListener("input", () => { values[field.id] = input.value; sync(); });
    wrapper.append(label, input, error); section.append(wrapper); controls.set(field.id, { screenId: screen.id, wrapper, input, error });
  }}
  const navigation = document.createElement("div"); const back = document.createElement("button"); const next = document.createElement("button"); const submit = document.createElement("button"); back.type = "button"; back.textContent = "Back"; next.type = "button"; next.textContent = "Next"; submit.type = "submit"; submit.textContent = options.submitLabel ?? "Submit feedback"; navigation.append(back, next, submit); const submitError = document.createElement("p"); submitError.setAttribute("role", "alert"); submitError.hidden = true; form.append(navigation, submitError); let submitting = false; let currentScreenId = activeFlowScreens(screens, values)[0].id;
  const activeScreens = () => activeFlowScreens(screens, values);
  const sync = (showErrors = false, onlyScreen?: string) => { const validation = validateFlow(flow, values); const active = new Set(validation.activeFields.map((field) => field.id)); const missing = new Set(validation.missing); const visibleScreens = activeScreens(); let currentScreen = visibleScreens.findIndex((screen) => screen.id === currentScreenId); if (currentScreen < 0) { const previousPosition = screens.findIndex((screen) => screen.id === currentScreenId); currentScreen = visibleScreens.findIndex((screen) => screens.indexOf(screen) >= previousPosition); if (currentScreen < 0) currentScreen = visibleScreens.length - 1; currentScreenId = visibleScreens[currentScreen].id; } for (const screen of screens) screenElements.get(screen.id)!.hidden = screen.id !== currentScreenId; for (const [id, control] of controls) { const isActive = active.has(id); control.wrapper.hidden = !isActive; control.input.disabled = !isActive; const invalid = showErrors && missing.has(id) && (!onlyScreen || control.screenId === onlyScreen); control.input.setAttribute("aria-invalid", String(invalid)); control.error.hidden = !invalid; control.error.textContent = invalid ? `${allFields.find((field) => field.id === id)?.label ?? id} is required.` : ""; } back.hidden = visibleScreens.length <= 1 || currentScreen === 0; next.hidden = visibleScreens.length <= 1 || currentScreen === visibleScreens.length - 1; submit.hidden = visibleScreens.length > 1 && currentScreen !== visibleScreens.length - 1; return validation; };
  back.onclick = () => { const visible = activeScreens(); const index = visible.findIndex((screen) => screen.id === currentScreenId); currentScreenId = visible[Math.max(0, index - 1)].id; sync(); };
  const advance = () => { const visible = activeScreens(); const index = visible.findIndex((screen) => screen.id === currentScreenId); const screen = visible[index]; const validation = sync(true, screen.id); const missing = validation.missing.find((id) => controls.get(id)?.screenId === screen.id); if (missing) { controls.get(missing)?.input.focus(); return false; } if (index < visible.length - 1) { currentScreenId = visible[index + 1].id; sync(); } return true; };
  next.onclick = () => { advance(); };
  form.addEventListener("submit", async (event) => { event.preventDefault(); if (submitting) return; const visibleBeforeSubmit = activeScreens(); if (visibleBeforeSubmit.findIndex((screen) => screen.id === currentScreenId) < visibleBeforeSubmit.length - 1) { advance(); return; } const validation = sync(true); if (validation.missing.length) { const control = controls.get(validation.missing[0]); const visible = activeScreens(); currentScreenId = visible.find((screen) => screen.id === control?.screenId)?.id ?? visible[0].id; sync(true); control?.input.focus(); return; } const activeValues = Object.fromEntries(validation.activeFields.flatMap((field) => Object.hasOwn(values, field.id) ? [[field.id, values[field.id]]] : [])); submitting = true; submit.disabled = true; form.setAttribute("aria-busy", "true"); submitError.hidden = true; try { await options.onSubmit(Object.freeze(activeValues)); } catch (error) { submitError.textContent = options.submissionErrorMessage ?? "Feedback could not be submitted. Try again."; submitError.hidden = false; options.onSubmitError?.(error); } finally { submitting = false; submit.disabled = false; form.removeAttribute("aria-busy"); } });
  sync(); container.append(form);
  return { getValues: () => Object.freeze({ ...values }), destroy: () => form.remove() };
}
export function elementContext(element: Element | null): ElementContext | undefined {
  if (!element) return undefined;
  const css = element.ownerDocument.defaultView?.CSS;
  const escape = (value: string) => { if (css?.escape) return css.escape(value); let output = ""; for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); const character = value[index]; if (code === 0) output += "�"; else if ((code >= 1 && code <= 31) || code === 127 || (index === 0 && code >= 48 && code <= 57) || (index === 1 && code >= 48 && code <= 57 && value.charCodeAt(0) === 45)) output += `\\${code.toString(16)} `; else if (index === 0 && code === 45 && value.length === 1) output += "\\-"; else if (code >= 128 || code === 45 || code === 95 || (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)) output += character; else output += `\\${character}`; } return output; };
  const id = element.getAttribute("id"); let selector: string;
  if (id) selector = `#${escape(id)}`;
  else {
  const context = element.getAttribute("data-feedback-context");
  if (context) selector = `[data-feedback-context="${escape(context)}"]`;
  else {
  const testId = element.getAttribute("data-testid");
  selector = testId ? `[data-testid="${escape(testId)}"]` : element.tagName.toLowerCase();
  }}
  const componentStack: string[] = []; let cursor: Element | null = element;
  while (cursor && componentStack.length < 20) { const name = cursor.getAttribute("data-feedback-component"); if (name?.trim()) componentStack.push(name.trim().slice(0, 100)); cursor = cursor.parentElement; }
  const sourceValue = element.closest("[data-feedback-source]")?.getAttribute("data-feedback-source")?.trim(); let source: ElementContext["source"];
  if (sourceValue) { const match = sourceValue.match(/^(.*?):(\d+)$/); source = match ? { file: match[1].slice(0, 500), line: Number(match[2]) } : { file: sourceValue.slice(0, 500) }; }
  return { selector, ...(componentStack.length ? { componentStack } : {}), ...(source ? { source } : {}) };
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
  root.append(button, welcome); document.body.append(host); let open = false; let hostToken = config.hostToken; const flows = new Map<string, FeedbackFlow>(); const variants = new Set<string>();
  const clearWelcome = () => { welcomeVisible = false; syncWelcome(); };
  const sync = () => { button.textContent = open ? "Close feedback" : "Feedback"; button.setAttribute("aria-expanded", String(open)); };
  const dismiss = () => { clearWelcome(); host.hidden = true; window.dispatchEvent(new CustomEvent("feedback:dismissed", { detail: { boardId: config.boardId } })); };
  button.onclick = () => { open = !open; clearWelcome(); sync(); }; dismissButton.onclick = () => config.dismissible === false ? clearWelcome() : dismiss(); sync(); syncWelcome(); if (config.theme) host.dataset.theme = config.theme;
  window.dispatchEvent(new CustomEvent("feedback:ready", { detail: { boardId: config.boardId } }));
  const submitFeedback = async (input: Omit<WidgetSubmission,"metadata"|"url"|"hostToken">) => { const allowed = config.allowedCategories ?? []; if (!allowed.includes(input.category)) throw new Error("Feedback category is not allowed."); const submissionToken = config.getHostToken ? await config.getHostToken() : hostToken; await config.submit({ ...input, metadata: allowMetadata(config.metadata, config.metadataAllowlist), url: redactUrl(location.href), hostToken: submissionToken, consoleLogs: sanitizeConsoleLogs(input.consoleLogs ?? [], Boolean(config.consent?.consoleLogs), config.capturePolicy), screenshot: config.consent?.screenshot ? (input.screenshot ?? await captureScreenshot(config)) : undefined }); };
  return { open: () => { open = true; clearWelcome(); sync(); }, close: () => { open = false; sync(); }, hide: () => { host.hidden = true; }, show: () => { host.hidden = false; }, dismiss, setTheme: (theme) => host.dataset.theme = theme, setHostToken: (token) => { hostToken = token; }, registerFlow: (flow) => { if (!flow.id || flows.has(flow.id)) throw new Error("Flow id must be unique."); validateFlow(flow, {}); flows.set(flow.id, flow); }, registerVariant: (id) => { if (!id.trim() || id.trim() !== id || variants.has(id)) throw new Error("Variant id must be unique, non-empty, and contain no surrounding whitespace."); variants.add(id); return Object.freeze({ submit: submitFeedback }); }, submit: submitFeedback, destroy: () => host.remove() };
}
