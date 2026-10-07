const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

let dialog = null;
let stage = null;
let image = null;
let counter = null;
let previousButton = null;
let nextButton = null;

let sources = [];
let index = 0;
let zoom = 1;
let fitWidth = 0;
let drag = null;
let dragged = false;

function button(label, text, className, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.className = className;
  node.setAttribute("aria-label", label);
  node.addEventListener("click", onClick);
  return node;
}

function setZoom(value) {
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
  if (zoom === MIN_ZOOM) fitWidth = image.clientWidth;
  const centerX = (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth;
  const centerY = (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight;
  zoom = next;
  image.classList.toggle("zoomed", zoom > MIN_ZOOM);
  image.style.width = zoom > MIN_ZOOM ? `${fitWidth * zoom}px` : "";
  stage.scrollLeft = centerX * stage.scrollWidth - stage.clientWidth / 2;
  stage.scrollTop = centerY * stage.scrollHeight - stage.clientHeight / 2;
}

function show(position) {
  index = (position + sources.length) % sources.length;
  zoom = MIN_ZOOM;
  image.classList.remove("zoomed");
  image.style.width = "";
  image.src = sources[index];
  counter.textContent = sources.length > 1 ? `${index + 1} / ${sources.length}` : "";
  previousButton.hidden = sources.length < 2;
  nextButton.hidden = sources.length < 2;
}

function build() {
  dialog = document.createElement("dialog");
  dialog.className = "lightbox";

  stage = document.createElement("div");
  stage.className = "lightbox-stage";
  image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  stage.append(image);

  counter = document.createElement("span");
  const bar = document.createElement("div");
  bar.className = "lightbox-bar";
  bar.append(
    counter,
    button("Zoom out", "−", "lightbox-button", () => setZoom(zoom - ZOOM_STEP)),
    button("Zoom in", "+", "lightbox-button", () => setZoom(zoom + ZOOM_STEP)),
    button("Close", "×", "lightbox-button", () => dialog.close()),
  );

  previousButton = button("Previous image", "‹", "lightbox-button lightbox-nav previous", () => show(index - 1));
  nextButton = button("Next image", "›", "lightbox-button lightbox-nav next", () => show(index + 1));
  dialog.append(stage, bar, previousButton, nextButton);
  document.body.append(dialog);

  stage.addEventListener("click", (event) => {
    if (event.target === stage) dialog.close();
  });

  image.addEventListener("click", () => {
    if (!dragged) setZoom(zoom > MIN_ZOOM ? MIN_ZOOM : 2);
  });

  image.addEventListener("pointerdown", (event) => {
    dragged = false;
    if (zoom === MIN_ZOOM) return;
    drag = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    image.setPointerCapture(event.pointerId);
  });

  image.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const moveX = event.clientX - drag.x;
    const moveY = event.clientY - drag.y;
    if (Math.abs(moveX) + Math.abs(moveY) > 4) {
      dragged = true;
      stage.classList.add("dragging");
    }
    stage.scrollLeft = drag.left - moveX;
    stage.scrollTop = drag.top - moveY;
  });

  for (const type of ["pointerup", "pointercancel"]) {
    image.addEventListener(type, () => {
      drag = null;
      stage.classList.remove("dragging");
    });
  }

  stage.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      setZoom(zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    },
    { passive: false },
  );

  dialog.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" && sources.length > 1) show(index - 1);
    else if (event.key === "ArrowRight" && sources.length > 1) show(index + 1);
    else if (event.key === "+" || event.key === "=") setZoom(zoom + ZOOM_STEP);
    else if (event.key === "-") setZoom(zoom - ZOOM_STEP);
  });
}

export function openLightbox(images, start) {
  if (!dialog) build();
  sources = images;
  show(start);
  dialog.showModal();
}
