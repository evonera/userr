/** Pure command builder: the static site never sends selected values anywhere. */
export function commandFor({ backend = "convex", framework = "next" } = {}) {
  if (!new Set(["convex", "neon"]).has(backend)) throw new Error("Unsupported backend.");
  if (framework !== "next") throw new Error("Unsupported framework.");
  return `npx userr init --backend ${backend} --framework ${framework}`;
}

function mount() {
  const form = document.querySelector("form");
  const output = document.querySelector("output");
  const copy = document.querySelector("button[data-copy]");
  if (!(form instanceof HTMLFormElement) || !(output instanceof HTMLOutputElement) || !(copy instanceof HTMLButtonElement)) return;
  const update = () => {
    const data = new FormData(form);
    output.value = commandFor({ backend: String(data.get("backend")), framework: String(data.get("framework")) });
  };
  form.addEventListener("change", update); update();
  copy.addEventListener("click", async () => {
    copy.disabled = true;
    try {
      if (!navigator.clipboard) throw new Error("Clipboard is unavailable.");
      await navigator.clipboard.writeText(output.value);
      copy.textContent = "Copied";
    } catch {
      copy.textContent = "Copy unavailable — select command";
    }
    setTimeout(() => { copy.textContent = "Copy command"; copy.disabled = false; }, 1800);
  });
}
if (typeof document !== "undefined") mount();
