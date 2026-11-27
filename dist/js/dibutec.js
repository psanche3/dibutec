import { createUser } from "./simulacion/usuario-virtual.js";
import { Camera } from "./vista/Camera.js";
import { GridLayer } from "./vista/GridLayer.js";
const ZOOM_SENSITIVITY = 0.001;
const MAX_WHEEL_DELTA = 200;
function query(selector, root = document) {
    const el = root.querySelector(selector);
    if (!el)
        throw new Error(`No se encuentra el elemento: ${selector}`);
    return el;
}
const drawing = query("#drawing");
const camera = new Camera({ scale: 1, minScale: 0.01, maxScale: 1000 });
new GridLayer(query("#grid", drawing), camera);
function syncViewportSize() {
    camera.setViewportSize(drawing.clientWidth, drawing.clientHeight);
}
new ResizeObserver(syncViewportSize).observe(drawing);
window.addEventListener("resize", syncViewportSize);
syncViewportSize();
drawing.addEventListener("wheel", (e) => {
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE)
        delta *= 16;
    else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE)
        delta *= camera.height;
    delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, delta));
    const rect = drawing.getBoundingClientRect();
    camera.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.exp(-delta * ZOOM_SENSITIVITY));
}, { passive: false });
let lastPointer = { x: 0, y: 0 };
function updateStatus() {
    const w = camera.screenToWorld(lastPointer);
    console.log(`x: ${w.x.toFixed(2)}  y: ${w.y.toFixed(2)}  |  escala: ${camera.scale.toFixed(3)}`);
}
drawing.addEventListener("pointermove", (e) => {
    const rect = drawing.getBoundingClientRect();
    lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    updateStatus();
});
camera.subscribe(updateStatus);
updateStatus();
async function simulacio() {
    const user = createUser({ delay: 400, timeScale: 1 });
    await user
        .moveTo("#test")
        .click()
        .moveTo("#command")
        .click()
        .type("pepe@mail.com\n");
    await user.click("#test");
    user.destroy();
}
await simulacio();
//# sourceMappingURL=dibutec.js.map