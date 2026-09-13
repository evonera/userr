import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { allowMetadata, captureScreenshot, collectPrivacyMasks, elementContext, redactUrl, renderFlow, sanitizeConsoleLogs, validateCapturePolicy, validateFlow } from "./index.js";

test("capture requires explicit consent and bounded host retention", () => {
  assert.deepEqual(sanitizeConsoleLogs(["one"], false), []);
  assert.throws(() => validateCapturePolicy({ screenshot: true }, undefined), /retentionMs/);
  assert.throws(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 0 }), /retentionMs/);
  assert.doesNotThrow(() => validateCapturePolicy({ consoleLogs: true }, { retentionMs: 86_400_000 }));
});
test("screenshot hooks receive approved masks and cannot run without consent", async () => {
  const masks = [{ x: 1, y: 2, width: 3, height: 4 }];
  let received: unknown;
  const blob = await captureScreenshot({ consent: { screenshot: true }, capturePolicy: { retentionMs: 1, screenshotMasks: masks }, captureScreenshot: async (input) => { received = input; return new Blob(["masked"]); } });
  assert.ok(blob);
  assert.deepEqual(received, { masks, element: undefined });
  assert.equal(await captureScreenshot({ consent: {}, captureScreenshot: async () => new Blob() }), undefined);
});
test("capture helpers redact and bound host data", () => {
  assert.deepEqual(allowMetadata({ plan: "pro", token: "secret" }, ["plan"]), { plan: "pro" });
  assert.match(redactUrl("https://user:pass@example.test/a?token=secret&view=all"), /token=%5BREDACTED%5D/);
  assert.deepEqual(sanitizeConsoleLogs(["abcdef", "uvwxyz"], true, { maxConsoleEntries: 1, maxConsoleChars: 3 }), ["uvw"]);
  assert.deepEqual(sanitizeConsoleLogs(["aaaa", "bbbb", "cccc"], true, { maxConsoleTotalChars: 6 }), ["bb", "cccc"]);
});
test("capture context finds declared components, source, and sensitive masks", () => {
  const dom = new JSDOM('<main data-feedback-component="Page"><section data-feedback-component="Billing"><input id="card" autocomplete="billing cc-number" data-feedback-source="src/Billing.tsx:42"><secure-field></secure-field></section></main>');
  const input = dom.window.document.querySelector("input")!;
  input.getBoundingClientRect = () => ({ x: 10, y: 20, width: 200, height: 30, top: 20, right: 210, bottom: 50, left: 10, toJSON: () => ({}) });
  const shadowInput = dom.window.document.querySelector("secure-field")!.attachShadow({ mode: "open" }).appendChild(dom.window.document.createElement("input")); shadowInput.autocomplete = "section-login current-password"; shadowInput.getBoundingClientRect = () => ({ x: 5, y: 6, width: 70, height: 20, top: 6, right: 75, bottom: 26, left: 5, toJSON: () => ({}) });
  assert.deepEqual(collectPrivacyMasks(dom.window.document), [{ x: 10, y: 20, width: 200, height: 30 }, { x: 5, y: 6, width: 70, height: 20 }]);
  assert.deepEqual(elementContext(input), { selector: "#card", componentStack: ["Billing", "Page"], source: { file: "src/Billing.tsx", line: 42 } });
});
test("element context fallback produces queryable selectors for leading digits", () => {
  const dom = new JSDOM('<div id="2024-report"></div>'); const element = dom.window.document.querySelector("div")!;
  Object.defineProperty(dom.window.CSS, "escape", { value: undefined, configurable: true });
  const context = elementContext(element)!;
  assert.equal(dom.window.document.querySelector(context.selector), element);
});
test("privacy masks support detached documents without a browsing context", () => {
  const dom = new JSDOM(); const detached = dom.window.document.implementation.createHTMLDocument(); detached.body.innerHTML = '<input type="password">'; const input = detached.querySelector("input")!;
  input.getBoundingClientRect = () => ({ x: 1, y: 2, width: 3, height: 4, top: 2, right: 4, bottom: 6, left: 1, toJSON: () => ({}) });
  assert.deepEqual(collectPrivacyMasks(detached), [{ x: 1, y: 2, width: 3, height: 4 }]);
});
test("flows resolve conditions and reject incomplete or ambiguous schemas", () => {
  const flow = { id: "bug", fields: [{ id: "title", label: "Title", required: true }, { id: "steps", label: "Steps", required: true, when: (values: Record<string, unknown>) => values.reproducible === true }] };
  assert.deepEqual(validateFlow(flow, { title: "Broken", reproducible: false }).missing, []);
  assert.deepEqual(validateFlow(flow, { title: "", reproducible: true }).missing, ["title", "steps"]);
  assert.throws(() => validateFlow({ id: "bad", fields: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] }, {}), /unique/);
  assert.throws(() => validateFlow({ id: "bad", fields: [{ id: "   ", label: "Blank" }] }, {}), /non-empty/);
  assert.throws(() => validateFlow({ id: "bad", fields: [{ id: " title", label: "Title" }] }, {}), /whitespace/);
  assert.deepEqual(validateFlow({ id: "prototype", fields: [{ id: "constructor", label: "Constructor", required: true }] }, {}).missing, ["constructor"]);
});
test("flow renderer updates conditions, reports missing values, and submits host-owned data", async () => {
  const dom = new JSDOM("<main></main>"); const container = dom.window.document.querySelector("main") as HTMLElement; let submitted: Readonly<Record<string, string>> | undefined;
  const rendered = renderFlow(container, { id: "bug", title: "Report a bug", fields: [{ id: "title", label: "Title", required: true, placeholder: "What broke?" }, { id: "details", label: "Details", multiline: true, when: (values) => values.title === "Broken" }] }, { initialValues: { ignored: "secret" }, onSubmit: (values) => { submitted = values; } });
  const form = container.querySelector("form") as HTMLFormElement; const title = form.elements.namedItem("title") as HTMLInputElement; const details = form.elements.namedItem("details") as HTMLTextAreaElement;
  assert.equal(form.querySelector("h2")?.textContent, "Report a bug"); assert.equal(title.placeholder, "What broke?"); assert.equal(details.disabled, true);
  form.requestSubmit(); assert.equal(title.getAttribute("aria-invalid"), "true"); assert.equal(submitted, undefined);
  title.value = "Broken"; title.dispatchEvent(new dom.window.Event("input", { bubbles: true })); assert.equal(details.disabled, false); details.value = "Private reproduction steps"; details.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  title.value = "Fixed"; title.dispatchEvent(new dom.window.Event("input", { bubbles: true })); assert.equal(details.disabled, true);
  form.requestSubmit(); await Promise.resolve(); assert.deepEqual(submitted, { title: "Fixed" }); assert.deepEqual(rendered.getValues(), { title: "Fixed", details: "Private reproduction steps" });
  rendered.destroy(); assert.equal(container.childElementCount, 0);
});
test("flow renderer prevents concurrent submissions and reports host failures", async () => {
  const dom = new JSDOM("<main></main>"); const container = dom.window.document.querySelector("main") as HTMLElement; let attempts = 0; let rejectSubmission: ((reason?: unknown) => void) | undefined; let reported: unknown;
  renderFlow(container, { id: "question", fields: [{ id: "title", label: "Title" }] }, { initialValues: { title: "Help" }, onSubmit: () => { attempts += 1; return new Promise((_, reject) => { rejectSubmission = reject; }); }, onSubmitError: (error) => { reported = error; } });
  const form = container.querySelector("form") as HTMLFormElement; const button = form.querySelector("button") as HTMLButtonElement; form.requestSubmit(); form.dispatchEvent(new dom.window.SubmitEvent("submit", { bubbles: true, cancelable: true }));
  assert.equal(attempts, 1); assert.equal(button.disabled, true); assert.equal(form.getAttribute("aria-busy"), "true");
  const failure = new Error("host unavailable"); rejectSubmission?.(failure); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reported, failure); assert.equal(button.disabled, false); assert.equal(form.hasAttribute("aria-busy"), false); assert.equal(form.querySelector('[role="alert"]:not([hidden])')?.textContent, "Feedback could not be submitted. Try again.");
});
