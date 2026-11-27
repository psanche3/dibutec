/**
 * ghost-user.ts
 * ---------------------------------------------------------------------------
 * "Usuario fantasma": simula en el propio navegador lo que haría una persona
 * (mover el ratón, hacer clic, escribir con Tab/Enter...) mostrando un cursor
 * falso. Útil para tests visuales, demos y tutoriales dentro de la app.
 *
 * Uso:
 *
 *   const user = createUser({ delay: 400, timeScale: 1 });
 *
 *   await user
 *     .moveTo("#email")
 *     .click()
 *     .type("pepe@mail.com\tmi-clave\n");   // \t = Tab, \n = Enter, \b = Backspace
 *
 *   await user.click("#aceptar").waitFor(".toast-ok");
 *
 *   // Modo rápido para CI (sin esperas ni animaciones):
 *   const fast = createUser({ timeScale: 0, showCursor: false });
 *
 * Notas:
 *  - Los eventos sintéticos tienen isTrusted = false: no activan :hover de CSS
 *    ni comportamientos nativos del navegador. Para tu propia UI funciona bien.
 *  - Necesita un navegador real (usa layout y elementFromPoint). En jsdom no hay
 *    layout: usa waitFor(selector, { visible: false }) y pasa elementos.
 *  - Las acciones se encadenan y se ejecutan en orden; `await user` espera al final.
 */

/** Retardo por defecto (ms) entre acciones. */
export const DELAY = 300;

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

const DEFAULTS: Omit<GhostUserOptions, "signal"> = {
	delay: DELAY,
	typeDelay: 70,
	moveDuration: 600,
	timeScale: 1,
	timeout: 5000,
	curve: 0.15,
	jitter: 0.3,
	showCursor: true,
};

export class GhostUserError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "GhostUserError";
	}
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

const FOCUSABLE =
	'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

const TEXT_INPUT_TYPES = new Set([
	"text", "search", "email", "url", "tel", "password", "number",
]);

const easeInOut = (t: number): number =>
	t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

function isVisible(el: Element): boolean {
	const r = el.getBoundingClientRect();
	if (r.width === 0 && r.height === 0) return false;
	const s = getComputedStyle(el);
	return s.visibility !== "hidden" && s.display !== "none";
}

function ancestors(el: Element): Element[] {
	const chain: Element[] = [];
	for (let n: Element | null = el; n; n = n.parentElement) chain.push(n);
	return chain;
}

function codeFor(key: string): string {
	if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
	if (/^\d$/.test(key)) return `Digit${key}`;
	if (key === " ") return "Space";
	return key;
}

function parseCombo(combo: string): { key: string; mods: KeyboardEventInit } {
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

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
	if (el instanceof HTMLTextAreaElement) return true;
	return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

/**
 * Edita el valor de un input/textarea respetando la selección.
 * `compute` recibe (valor, inicio, fin) y devuelve el nuevo valor y la posición
 * del cursor, o null si no hay nada que hacer.
 */
function editField(
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

function focusables(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
		if (el.matches(":disabled")) return false;
		if (el instanceof HTMLInputElement && el.type === "hidden") return false;
		const ti = el.getAttribute("tabindex");
		if (ti !== null && Number(ti) < 0) return false;
		return isVisible(el);
	});
}

// ---------------------------------------------------------------------------
// Clase principal
// ---------------------------------------------------------------------------

export class GhostUser implements PromiseLike<void> {
	private readonly opts: GhostUserOptions;
	private x: number;
	private y: number;
	private hovered: Element | null = null;
	private queue: Promise<void> = Promise.resolve();

	private cursorRoot?: HTMLDivElement;
	private cursorSvg?: HTMLElement;

	constructor(options: Partial<GhostUserOptions> = {}) {
		this.opts = { ...DEFAULTS, ...options };
		this.x = window.innerWidth / 2;
		this.y = window.innerHeight / 2;
		if (this.opts.showCursor) this.createCursor();
	}

	/** Posición actual del cursor. */
	get position(): { x: number; y: number } {
		return { x: this.x, y: this.y };
	}

	// ------------------------------------------------------------------ cadena

	/**
	 * Hace que `await user.moveTo(...).click()` espere a toda la cadena.
	 * Tras esperar, la cadena se reinicia (también si hubo error).
	 */
	then<R1 = void, R2 = never>(
		onfulfilled?: ((value: void) => R1 | PromiseLike<R1>) | null,
		onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
	): Promise<R1 | R2> {
		const q = this.queue;
		this.queue = Promise.resolve();
		return q.then(onfulfilled, onrejected);
	}

	private enqueue(task: () => Promise<void>): this {
		this.queue = this.queue.then(() => {
			this.checkAbort();
			return task();
		});
		return this;
	}

	// ----------------------------------------------------------- API pública

	/** Espera `ms` milisegundos (escalados por timeScale). */
	wait(ms: number = DELAY): this {
		return this.enqueue(() => this.sleep(ms));
	}

	/** Espera a que exista (y sea visible) el elemento. */
	waitFor(selector: string, options: { timeout?: number; visible?: boolean } = {}): this {
		return this.enqueue(async () => {
			await this.waitForElement(selector, options);
		});
	}

	/** Mueve el cursor hasta el selector, elemento o coordenadas. */
	moveTo(target: Target): this {
		return this.enqueue(async () => {
			await this.doMove(target);
			await this.pause();
		});
	}

	/** Alias de moveTo (dispara los eventos de hover). */
	hover(target: Target): this {
		return this.moveTo(target);
	}

	/** Clic. Si se pasa un destino, se mueve primero hacia él. */
	click(target?: Target): this {
		return this.enqueue(async () => {
			await this.doClick(target, 0, 1);
			await this.pause();
		});
	}

	doubleClick(target?: Target): this {
		return this.enqueue(async () => {
			await this.doClick(target, 0, 2);
			await this.pause();
		});
	}

	rightClick(target?: Target): this {
		return this.enqueue(async () => {
			await this.doClick(target, 2, 1);
			await this.pause();
		});
	}

	/**
	 * Escribe texto en el elemento con foco (o en `target`, haciendo clic antes).
	 * Caracteres especiales: "\n" = Enter, "\t" = Tab, "\b" = Backspace, "\x1b" = Escape.
	 */
	type(text: string, target?: Target): this {
		return this.enqueue(async () => {
			if (target !== undefined) {
				await this.doClick(target, 0, 1);
				await this.pause();
			}
			for (const ch of text) {
				this.checkAbort();
				const key = ch === "\n" ? "Enter" : ch === "\t" ? "Tab" : ch === "\b" ? "Backspace" : ch === "\x1b" ? "Escape" : ch;
				await this.keystroke(key);
				await this.sleep(this.opts.typeDelay * (0.7 + Math.random() * 0.6));
			}
			await this.pause();
		});
	}

	/** Pulsa una tecla o combinación: "Enter", "Escape", "Shift+Tab", "Ctrl+A"... */
	press(combo: string): this {
		return this.enqueue(async () => {
			const { key, mods } = parseCombo(combo);
			await this.keystroke(key, mods);
			await this.pause();
		});
	}

	/** Vacía el campo (clic opcional + Ctrl+A + Backspace). */
	clear(target?: Target): this {
		return this.enqueue(async () => {
			if (target !== undefined) {
				await this.doClick(target, 0, 1);
				await this.pause();
			}
			await this.keystroke("a", { ctrlKey: true });
			await this.keystroke("Backspace");
			await this.pause();
		});
	}

	/** Elige una opción de un <select> por valor o por texto visible. */
	select(target: Target, valueOrLabel: string): this {
		return this.enqueue(async () => {
			await this.doClick(target, 0, 1);
			const { el } = await this.resolve(target);
			if (!(el instanceof HTMLSelectElement)) {
				throw new GhostUserError("select() necesita un elemento <select>");
			}
			const opt = Array.from(el.options).find(
				o => o.value === valueOrLabel || o.text.trim() === valueOrLabel,
			);
			if (!opt) throw new GhostUserError(`No existe la opción "${valueOrLabel}"`);
			el.value = opt.value;
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
			await this.pause();
		});
	}

	/** Quita el cursor falso del DOM. */
	destroy(): void {
		this.cursorRoot?.remove();
		this.cursorRoot = undefined;
		this.cursorSvg = undefined;
	}

	// ----------------------------------------------------------- tiempo/abort

	private checkAbort(): void {
		const s = this.opts.signal;
		if (s?.aborted) throw s.reason ?? new DOMException("Secuencia cancelada", "AbortError");
	}

	private sleep(ms: number): Promise<void> {
		const signal = this.opts.signal;
		const real = Math.max(0, ms * this.opts.timeScale);
		return new Promise<void>((resolve, reject) => {
			if (signal?.aborted) {
				reject(signal.reason ?? new DOMException("Secuencia cancelada", "AbortError"));
				return;
			}
			const onAbort = () => {
				clearTimeout(id);
				reject(signal?.reason ?? new DOMException("Secuencia cancelada", "AbortError"));
			};
			const id = setTimeout(() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			}, real);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	private pause(): Promise<void> {
		return this.sleep(this.opts.delay);
	}

	// -------------------------------------------------------------- elementos

	private waitForElement(
		selector: string,
		o: { timeout?: number; visible?: boolean } = {},
	): Promise<Element> {
		const timeout = o.timeout ?? this.opts.timeout;
		const visible = o.visible ?? true;
		const signal = this.opts.signal;

		const find = (): Element | null => {
			const el = document.querySelector(selector);
			return el && (!visible || isVisible(el)) ? el : null;
		};

		const now = find();
		if (now) return Promise.resolve(now);

		return new Promise<Element>((resolve, reject) => {
			let done = false;
			const finish = (fn: () => void) => {
				if (done) return;
				done = true;
				mo.disconnect();
				clearInterval(iv);
				clearTimeout(to);
				signal?.removeEventListener("abort", onAbort);
				fn();
			};
			const check = () => {
				const el = find();
				if (el) finish(() => resolve(el));
			};
			const onAbort = () =>
				finish(() => reject(signal?.reason ?? new DOMException("Secuencia cancelada", "AbortError")));

			const mo = new MutationObserver(check);
			mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
			const iv = setInterval(check, 50);
			const to = setTimeout(
				() => finish(() => reject(new GhostUserError(
					`Timeout (${timeout} ms) esperando "${selector}"${visible ? " visible" : ""}`,
				))),
				timeout,
			);
			signal?.addEventListener("abort", onAbort, { once: true });
		});
	}

	/** Convierte un Target en elemento + coordenadas (haciendo scroll si hace falta). */
	private async resolve(target: Target): Promise<{ el: Element | null; x: number; y: number }> {
		const t = typeof target === "string" ? await this.waitForElement(target) : target;

		if (t instanceof Element) {
			let r = t.getBoundingClientRect();
			const inView =
				r.top >= 0 && r.left >= 0 &&
				r.bottom <= window.innerHeight && r.right <= window.innerWidth;
			if (!inView) {
				t.scrollIntoView({ block: "center", inline: "center" });
				await this.sleep(80);
				r = t.getBoundingClientRect();
			}
			const jx = (Math.random() - 0.5) * r.width * this.opts.jitter;
			const jy = (Math.random() - 0.5) * r.height * this.opts.jitter;
			return { el: t, x: r.left + r.width / 2 + jx, y: r.top + r.height / 2 + jy };
		}
		return { el: null, x: t.x, y: t.y };
	}

	private elementAtCursor(): Element | null {
		return document.elementFromPoint(this.x, this.y);
	}

	// ----------------------------------------------------------------- ratón

	private async doMove(target: Target): Promise<Element | null> {
		const { el, x, y } = await this.resolve(target);
		await this.glide(x, y);
		this.setPos(x, y);
		this.hoverAt(x, y);
		return el;
	}

	/** Movimiento por tiempo, con curva y easing, disparando hover por el camino. */
	private async glide(x1: number, y1: number): Promise<void> {
		const x0 = this.x;
		const y0 = this.y;
		const dist = Math.hypot(x1 - x0, y1 - y0);

		if (this.opts.timeScale === 0 || dist < 1) return;

		const duration =
			this.opts.moveDuration * this.opts.timeScale *
			Math.min(1.6, 0.4 + dist / 800) * (0.9 + Math.random() * 0.2);

		// Punto de control perpendicular a la recta -> trayectoria curva.
		const nx = -(y1 - y0) / dist;
		const ny = (x1 - x0) / dist;
		const off = (Math.random() * 2 - 1) * dist * this.opts.curve;
		const cx = (x0 + x1) / 2 + nx * off;
		const cy = (y0 + y1) / 2 + ny * off;

		const start = performance.now();
		await new Promise<void>((resolve, reject) => {
			const tick = (now: number) => {
				try { this.checkAbort(); } catch (e) { reject(e); return; }
				const t = Math.min(Math.max((now - start) / duration, 0), 1);
				const e = easeInOut(t);
				const u = 1 - e;
				const x = u * u * x0 + 2 * u * e * cx + e * e * x1;
				const y = u * u * y0 + 2 * u * e * cy + e * e * y1;
				this.setPos(x, y);
				this.hoverAt(x, y);
				if (t < 1) requestAnimationFrame(tick);
				else resolve();
			};
			requestAnimationFrame(tick);
		});
	}

	private async doClick(
		target: Target | undefined,
		button: 0 | 2,
		clicks: 1 | 2,
	): Promise<void> {
		let expected: Element | null = null;
		if (target !== undefined) expected = await this.doMove(target);

		const el = this.elementAtCursor();
		if (!el) throw new GhostUserError("No hay ningún elemento bajo el cursor");
		if (expected && !expected.contains(el)) {
			throw new GhostUserError(
				`El elemento está tapado por <${el.tagName.toLowerCase()}>`,
			);
		}
		if (el.closest(":disabled, [aria-disabled='true']")) {
			throw new GhostUserError(`El elemento <${el.tagName.toLowerCase()}> está deshabilitado`);
		}

		for (let i = 1; i <= clicks; i++) {
			await this.pressButton(el, button, i);
			if (i < clicks) await this.sleep(60);
		}
		if (clicks === 2 && button === 0) this.fire(el, "dblclick", { detail: 2 });
	}

	/** pointerdown → mousedown → focus → pointerup → mouseup → click/contextmenu */
	private async pressButton(el: Element, button: 0 | 2, detail: number): Promise<void> {
		const down = button === 0 ? 1 : 2;
		this.setPressed(true);

		this.fire(el, "pointerdown", { button, buttons: down });
		const ok = this.fire(el, "mousedown", { button, buttons: down, detail });
		if (ok && button === 0) this.focusFromClick(el);

		await this.sleep(80);
		this.setPressed(false);
		this.ripple();

		this.fire(el, "pointerup", { button, buttons: 0 });
		this.fire(el, "mouseup", { button, buttons: 0, detail });
		if (button === 0) this.fire(el, "click", { button: 0, detail });
		else this.fire(el, "contextmenu", { button: 2, detail });
	}

	private focusFromClick(el: Element): void {
		const focusable = el.closest<HTMLElement>(FOCUSABLE);
		if (focusable) focusable.focus({ preventScroll: true });
		else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
	}

	/** Dispara los eventos de entrada/salida/movimiento según el elemento bajo el cursor. */
	private hoverAt(x: number, y: number): void {
		const el = document.elementFromPoint(x, y);
		const prev = this.hovered;

		if (el !== prev) {
			const prevChain = prev ? ancestors(prev) : [];
			const nextChain = el ? ancestors(el) : [];

			if (prev) {
				this.fire(prev, "pointerout", { relatedTarget: el });
				this.fire(prev, "mouseout", { relatedTarget: el });
				for (const n of prevChain.filter(n => !nextChain.includes(n))) {
					this.fire(n, "pointerleave", { relatedTarget: el });
					this.fire(n, "mouseleave", { relatedTarget: el });
				}
			}
			if (el) {
				this.fire(el, "pointerover", { relatedTarget: prev });
				this.fire(el, "mouseover", { relatedTarget: prev });
				for (const n of nextChain.filter(n => !prevChain.includes(n)).reverse()) {
					this.fire(n, "pointerenter", { relatedTarget: prev });
					this.fire(n, "mouseenter", { relatedTarget: prev });
				}
			}
			this.hovered = el;
		}

		if (el) {
			this.fire(el, "pointermove");
			this.fire(el, "mousemove");
		}
	}

	private fire(el: Element, type: string, init: MouseEventInit = {}): boolean {
		const noBubble = /enter$|leave$/.test(type);
		const base: MouseEventInit = {
			bubbles: !noBubble,
			cancelable: !noBubble,
			composed: true,
			view: window,
			clientX: this.x,
			clientY: this.y,
			...init,
		};
		const ev =
			type.startsWith("pointer") && typeof PointerEvent !== "undefined"
				? new PointerEvent(type, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true })
				: new MouseEvent(type, base);
		return el.dispatchEvent(ev);
	}

	// --------------------------------------------------------------- teclado

	/** keydown → keypress → acción por defecto → keyup */
	private async keystroke(key: string, mods: KeyboardEventInit = {}): Promise<void> {
		this.checkAbort();
		const active = document.activeElement;
		const target: Element = active && active !== document.body ? active : document.body;

		const init: KeyboardEventInit = {
			key, code: codeFor(key),
			bubbles: true, cancelable: true, composed: true, view: window,
			...mods,
		};

		let proceed = target.dispatchEvent(new KeyboardEvent("keydown", init));

		const printable = key.length === 1;
		if (proceed && (printable || key === "Enter")) {
			proceed = target.dispatchEvent(new KeyboardEvent("keypress", {
				...init,
				charCode: key === "Enter" ? 13 : key.charCodeAt(0),
			}));
		}

		let clickAfterKeyup = false;

		if (proceed) {
			const ctrl = !!(mods.ctrlKey || mods.metaKey);
			if (key === "Tab") {
				this.moveFocus(!!mods.shiftKey);
			} else if (key === "Enter") {
				this.defaultEnter(target);
			} else if (key === "Backspace") {
				this.defaultBackspace(target);
			} else if (printable && ctrl) {
				if (key.toLowerCase() === "a" && isTextField(target)) target.select();
			} else if (printable) {
				if (key === " " && this.isButtonLike(target)) clickAfterKeyup = true;
				else this.insertText(target, key);
			}
		}

		target.dispatchEvent(new KeyboardEvent("keyup", init));
		if (clickAfterKeyup && target instanceof HTMLElement) target.click();
	}

	private isButtonLike(el: Element): boolean {
		if (el instanceof HTMLButtonElement) return true;
		return el instanceof HTMLInputElement &&
			["button", "submit", "reset", "checkbox", "radio"].includes(el.type);
	}

	private insertText(el: Element, text: string): void {
		if (isTextField(el)) {
			editField(el, "insertText", text, (value, start, end) => ({
				value: value.slice(0, start) + text + value.slice(end),
				caret: start + text.length,
			}));
		} else if (el instanceof HTMLElement && el.isContentEditable) {
			const ok = el.dispatchEvent(new InputEvent("beforeinput", {
				bubbles: true, cancelable: true, composed: true, data: text, inputType: "insertText",
			}));
			if (ok) document.execCommand("insertText", false, text);
		}
	}

	private defaultBackspace(el: Element): void {
		if (isTextField(el)) {
			editField(el, "deleteContentBackward", null, (value, start, end) => {
				if (start === end) {
					if (start === 0) return null;
					start -= 1;
				}
				return { value: value.slice(0, start) + value.slice(end), caret: start };
			});
		} else if (el instanceof HTMLElement && el.isContentEditable) {
			document.execCommand("delete");
		}
	}

	private defaultEnter(el: Element): void {
		if (el instanceof HTMLTextAreaElement) {
			editField(el, "insertLineBreak", null, (value, start, end) => ({
				value: value.slice(0, start) + "\n" + value.slice(end),
				caret: start + 1,
			}));
			return;
		}
		if (el instanceof HTMLElement && el.isContentEditable) {
			document.execCommand("insertParagraph");
			return;
		}
		if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) {
			const form = el.form;
			if (!form) return;
			const submit = form.querySelector<HTMLElement>(
				'button[type="submit"], button:not([type]), input[type="submit"]',
			);
			if (submit) {
				if (!submit.matches(":disabled")) submit.click();
			} else if (form.querySelectorAll("input").length <= 1) {
				form.requestSubmit();
			}
			return;
		}
		if (
			el instanceof HTMLButtonElement ||
			(el instanceof HTMLAnchorElement && el.hasAttribute("href")) ||
			(el instanceof HTMLInputElement && ["button", "submit", "reset", "image"].includes(el.type))
		) {
			el.click();
		}
	}

	/** Tab / Shift+Tab (orden del DOM; no tiene en cuenta tabindex positivos). */
	private moveFocus(back: boolean): void {
		const list = focusables();
		if (list.length === 0) return;
		const idx = document.activeElement ? list.indexOf(document.activeElement as HTMLElement) : -1;
		const next = idx === -1
			? (back ? list[list.length - 1] : list[0])
			: list[(idx + (back ? -1 : 1) + list.length) % list.length];
		next.focus();
		if (next instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(next.type)) {
			try { next.select(); } catch { /* ignorar */ }
		}
	}

	// ----------------------------------------------------------- cursor falso

	private createCursor(): void {
		const root = document.createElement("div");
		root.setAttribute("data-ghost-cursor", "");
		Object.assign(root.style, {
			position: "fixed",
			left: "0",
			top: "0",
			width: "24px",
			height: "24px",
			marginLeft: "-3px",
			marginTop: "-2px",
			pointerEvents: "none", // imprescindible para que elementFromPoint lo ignore
			zIndex: "2147483647",
			willChange: "transform",
			transform: `translate(${this.x}px, ${this.y}px)`,
		} satisfies Partial<CSSStyleDeclaration>);

		const svgWrap = document.createElement("div");
		Object.assign(svgWrap.style, {
			transformOrigin: "3px 2px",
			transition: "transform 80ms ease-out",
		} satisfies Partial<CSSStyleDeclaration>);
		svgWrap.innerHTML =
			'<svg width="24" height="24" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">' +
			'<path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>' +
			"</svg>";

		root.appendChild(svgWrap);
		document.body.appendChild(root);
		this.cursorRoot = root;
		this.cursorSvg = svgWrap;
	}

	private setPos(x: number, y: number): void {
		this.x = x;
		this.y = y;
		if (this.cursorRoot) this.cursorRoot.style.transform = `translate(${x}px, ${y}px)`;
	}

	private setPressed(pressed: boolean): void {
		if (this.cursorSvg) this.cursorSvg.style.transform = pressed ? "scale(.82)" : "scale(1)";
	}

	private ripple(): void {
		if (!this.cursorRoot || typeof this.cursorRoot.animate !== "function") return;
		const r = document.createElement("div");
		Object.assign(r.style, {
			position: "fixed",
			left: `${this.x - 14}px`,
			top: `${this.y - 14}px`,
			width: "28px",
			height: "28px",
			borderRadius: "50%",
			border: "2px solid #3b82f6",
			pointerEvents: "none",
			zIndex: "2147483646",
		} satisfies Partial<CSSStyleDeclaration>);
		document.body.appendChild(r);
		const anim = r.animate(
			[{ transform: "scale(.4)", opacity: 0.9 }, { transform: "scale(1.6)", opacity: 0 }],
			{ duration: 400 * Math.max(this.opts.timeScale, 0.1), easing: "ease-out" },
		);
		anim.onfinish = () => r.remove();
	}
}

/** Atajo para crear un usuario fantasma. */
export function createUser(options: Partial<GhostUserOptions> = {}): GhostUser {
	return new GhostUser(options);
}