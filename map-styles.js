(() => {
  // Web versions of the app's map styles: CSS filters on the live map, plus an ordered-dither
  // pattern for Dithered. The app draws them with its own shaders; these are close, not exact.
  const NAMES = { classic: "Classic", monochrome: "Monochrome", dithered: "Dithered", muffin: "Muffin" };
  const buttons = [...document.querySelectorAll(".themes button")];
  const note = document.getElementById("style-note");
  let dither = null;

  function apply(style) {
    if (!NAMES[style]) style = "classic";
    if (style === "classic") delete document.documentElement.dataset.mapStyle;
    else document.documentElement.dataset.mapStyle = style;
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.style === style)));
    note.hidden = style === "classic";
    note.textContent = style === "classic" ? "" : `Web preview · ${NAMES[style]} is part of Next Stop Pro`;

    const canvas = document.querySelector("#map .maplibregl-canvas");
    if (style === "dithered" && canvas) {
      dither ??= Object.assign(document.createElement("div"), { className: "dither" });
      if (dither.previousElementSibling !== canvas) canvas.after(dither);
    } else {
      dither?.remove();
    }
  }

  buttons.forEach((button) => button.addEventListener("click", () => apply(button.dataset.style)));
  const requested = new URLSearchParams(location.search).get("style");
  if (requested) {
    // The map canvas appears once demo.js has created the map.
    const wait = () => (document.querySelector("#map .maplibregl-canvas") ? apply(requested) : requestAnimationFrame(wait));
    wait();
  }
})();
