const bibtex = document.querySelector("#bibtex");
const copyButtons = document.querySelectorAll("[data-copy-citation]");
const toast = document.querySelector(".toast");
let toastTimer;

async function copyCitation(button) {
  if (!bibtex) return;

  try {
    await navigator.clipboard.writeText(bibtex.textContent.trim());
    const label = button.querySelector("[data-copy-label]");
    const original = label ? label.textContent : button.textContent;

    if (label) label.textContent = "Copied";
    else button.textContent = "Copied";

    toast?.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast?.classList.remove("is-visible"), 1800);

    window.setTimeout(() => {
      if (label) label.textContent = original;
      else button.textContent = original;
    }, 1800);
  } catch {
    window.getSelection()?.selectAllChildren(bibtex);
  }
}

copyButtons.forEach((button) => {
  button.addEventListener("click", () => copyCitation(button));
});
