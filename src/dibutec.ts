import { createUser } from "./simulacion/usuario-virtual.js";
import { Camera } from "./vista/Camera.js";
import { GridLayer } from "./vista/GridLayer.js";

/** Sensibilidad del zoom: factor = exp(-delta * k). Una muesca de ratón (~100) ≈ ×1.1. */
const ZOOM_SENSITIVITY = 0.001;
const MAX_WHEEL_DELTA = 200;

function query<T extends Element>(selector: string, root: ParentNode = document): T {
	const el = root.querySelector<T>(selector);
	if (!el) throw new Error(`No se encuentra el elemento: ${selector}`);
	return el;
}

const drawing = query<SVGSVGElement>("#drawing");
//const status = query<HTMLDivElement>("#status");

// Escala 1, (0,0) en el centro de la vista, Y hacia arriba.
const camera = new Camera({ scale: 1, minScale: 0.01, maxScale: 1000 });

// Capas
new GridLayer(query<SVGGElement>("#grid", drawing), camera);

// Tamaño del área de dibujo
function syncViewportSize(): void {
	camera.setViewportSize(drawing.clientWidth, drawing.clientHeight);
}

new ResizeObserver(syncViewportSize).observe(drawing);
window.addEventListener("resize", syncViewportSize);
syncViewportSize();

// Zoom con la rueda
drawing.addEventListener(
	"wheel",
	(e: WheelEvent) => {
		e.preventDefault();

		// Normalizar a píxeles: ratones y trackpads usan modos/magnitudes distintos.
		let delta = e.deltaY;
		if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) delta *= 16;
		else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) delta *= camera.height;
		delta = Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, delta));

		const rect = drawing.getBoundingClientRect();
		camera.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.exp(-delta * ZOOM_SENSITIVITY));
	},
	{ passive: false },
);

// Barra de estado (útil para comprobar la proyección)
let lastPointer = { x: 0, y: 0 };
function updateStatus(): void {
	const w = camera.screenToWorld(lastPointer);
	//status.textContent = `x: ${w.x.toFixed(2)}  y: ${w.y.toFixed(2)}  |  escala: ${camera.scale.toFixed(3)}`;
	console.log(`x: ${w.x.toFixed(2)}  y: ${w.y.toFixed(2)}  |  escala: ${camera.scale.toFixed(3)}`);

}

drawing.addEventListener("pointermove", (e: PointerEvent) => {
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
		.type("pepe@mail.com\n");   // \t = Tab, \n = Enter, \b = Backspace, \x1b = Escape
	await user.click("#test")/*.waitFor(".toast-ok")*/;
	user.destroy();

	// Modo rápido para CI (sin esperas ni animaciones):
	//const fast = createUser({ timeScale: 0, showCursor: false });
}

await simulacio();