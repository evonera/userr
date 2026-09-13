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
    await navigator.clipboard?.writeText(output.value);
    copy.textContent = "Copied";
    setTimeout(() => { copy.textContent = "Copy command"; }, 1200);
  });
}
if (typeof document !== "undefined") mount();
