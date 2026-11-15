(() => {
  const dialog = document.getElementById("style-preview");
  if (!dialog || typeof dialog.showModal !== "function") return;
  const image = document.getElementById("style-image");
  const name = document.getElementById("style-name");
  const note = document.getElementById("style-note");
  let opener = null;

  document.querySelectorAll(".themes button").forEach((button) => {
    button.addEventListener("click", () => {
      const style = button.dataset.style;
      opener = button;
      image.src = `images/themes/${style}-large.png`;
      image.alt = `The ${button.textContent.trim()} map style in Next Stop`;
      name.textContent = button.textContent.trim();
      note.textContent = style === "classic" ? "Included" : "With Next Stop Pro";
      dialog.showModal();
    });
  });

  const close = () => dialog.close();
  dialog.querySelector(".style-close").addEventListener("click", close);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener("close", () => opener?.focus());
})();
