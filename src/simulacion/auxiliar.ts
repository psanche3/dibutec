
/** Retardo por defecto (ms) entre acciones. */
export const DELAY = 300;

export const DEFAULTS: Omit<GhostUserOptions, "signal"> = {
	delay: DELAY,
	typeDelay: 70,
	moveDuration: 600,
	timeScale: 1,
	timeout: 5000,
	curve: 0.15,
	jitter: 0.3,
	showCursor: true,
};


export type Target = string | Element | { x: number; y: number };

export interface GhostUserOptions {
	/** Pausa (ms) tras cada acción. */
	delay: number;
	/** Pausa (ms) entre teclas al escribir. */
	typeDelay: number;
	/** Duración base (ms) de un movimiento de ratón. */
	moveDuration: number;
	/** Factor de tiempo: 1 = normal, 2 = el doble de lento, 0 = instantáneo. */
	timeScale: number;
	/** Tiempo máximo (ms) esperando a que aparezca un elemento. No se escala. */
	timeout: number;
	/** Curvatura de la trayectoria (0 = línea recta, 0.15 = suave). */
	curve: number;
	/** Variación aleatoria del punto de clic dentro del elemento (0 = centro exacto). */
	jitter: number;
	/** Mostrar el cursor falso. */
	showCursor: boolean;
	/** Para cancelar una secuencia a mitad. */
	signal?: AbortSignal;
}

export class GhostUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GhostUserError";
	}
}


// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

export const FOCUSABLE =
	'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

export const TEXT_INPUT_TYPES = new Set([
	"text", "search", "email", "url", "tel", "password", "number",
]);

export const easeInOut = (t: number): number =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

export function isVisible(el: Element): boolean {
	const r = el.getBoundingClientRect();
	if (r.width === 0 && r.height === 0) return false;
	const s = getComputedStyle(el);
	return s.visibility !== "hidden" && s.display !== "none";
}

export function ancestors(el: Element): Element[] {
	const chain: Element[] = [];
	for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
	return chain;
}

export function codeFor(key: string): string {
	if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
	if (/^\d$/.test(key)) return `Digit${key}`;
	if (key === " ") return "Space";
	return key;
}

export function parseCombo(combo: string): { key: string; mods: KeyboardEventInit } {
	const parts = combo.length > 1 ? combo.split("+") : [combo];
	const key = parts.pop() || "+";
	const mods: KeyboardEventInit = {};
	for (const p of parts.map(s => s.trim().toLowerCase()).filter(Boolean)) {
		if (p === "ctrl" || p === "control") mods.ctrlKey = true;
		else if (p === "shift") mods.shiftKey = true;
		else if (p === "alt") mods.altKey = true;
		else if (p === "meta" || p === "cmd") mods.metaKey = true;
	}
	return { key, mods };
}

/** Asigna value con el setter nativo (necesario para que React/Vue lo detecten). */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	const proto = el instanceof HTMLTextAreaElement
		? HTMLTextAreaElement.prototype
		: HTMLInputElement.prototype;
	const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
	if (setter) setter.call(el, value);
	else el.value = value;
}

export function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
	if (el instanceof HTMLTextAreaElement) return true;
	return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

/**
 * Edita el valor de un input/textarea respetando la selección.
 * `compute` recibe (valor, inicio, fin) y devuelve el nuevo valor y la posición
 * del cursor, o null si no hay nada que hacer.
 */
export function editField(
	el: HTMLInputElement | HTMLTextAreaElement,
	inputType: string,
	data: string | null,
	compute: (value: string, start: number, end: number) => { value: string; caret: number } | null,
): void {
	if (el.readOnly || el.disabled) return;

	let start = el.value.length;
	let end = start;
	try {
		// En type="email"/"number" la selección puede ser null o lanzar error.
		if (el.selectionStart !== null) {
			start = el.selectionStart;
			end = el.selectionEnd ?? start;
		}
	} catch { /* se añade al final */ }

	const result = compute(el.value, start, end);
	if (!result) return;

	const before = new InputEvent("beforeinput", {
		bubbles: true, cancelable: true, composed: true, data, inputType,
	});
	if (!el.dispatchEvent(before)) return;

	setNativeValue(el, result.value);
	try { el.setSelectionRange(result.caret, result.caret); } catch { /* ignorar */ }
	el.dispatchEvent(new InputEvent("input", {
		bubbles: true, composed: true, data, inputType,
	}));
}

export function focusables(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
		if (el.matches(":disabled")) return false;
		if (el instanceof HTMLInputElement && el.type === "hidden") return false;
		const ti = el.getAttribute("tabindex");
		if (ti !== null && Number(ti) < 0) return false;
		return isVisible(el);
	});
}
