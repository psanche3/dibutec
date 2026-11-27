import { ancestors, codeFor, DEFAULTS, DELAY, easeInOut, editField, FOCUSABLE, focusables, GhostUserError, isTextField, isVisible, parseCombo, TEXT_INPUT_TYPES } from "./auxiliar.js";
export class GhostUser {
    opts;
    x;
    y;
    hovered = null;
    queue = Promise.resolve();
    cursorRoot;
    cursorSvg;
    constructor(options = {}) {
        this.opts = { ...DEFAULTS, ...options };
        this.x = window.innerWidth / 2;
        this.y = window.innerHeight / 2;
        if (this.opts.showCursor)
            this.createCursor();
    }
    get position() {
        return { x: this.x, y: this.y };
    }
    then(onfulfilled, onrejected) {
        const q = this.queue;
        this.queue = Promise.resolve();
        return q.then(onfulfilled, onrejected);
    }
    enqueue(task) {
        this.queue = this.queue.then(() => {
            this.checkAbort();
            return task();
        });
        return this;
    }
    wait(ms = DELAY) {
        return this.enqueue(() => this.sleep(ms));
    }
    waitFor(selector, options = {}) {
        return this.enqueue(async () => {
            await this.waitForElement(selector, options);
        });
    }
    moveTo(target) {
        return this.enqueue(async () => {
            await this.doMove(target);
            await this.pause();
        });
    }
    hover(target) {
        return this.moveTo(target);
    }
    click(target) {
        return this.enqueue(async () => {
            await this.doClick(target, 0, 1);
            await this.pause();
        });
    }
    doubleClick(target) {
        return this.enqueue(async () => {
            await this.doClick(target, 0, 2);
            await this.pause();
        });
    }
    rightClick(target) {
        return this.enqueue(async () => {
            await this.doClick(target, 2, 1);
            await this.pause();
        });
    }
    type(text, target) {
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
    press(combo) {
        return this.enqueue(async () => {
            const { key, mods } = parseCombo(combo);
            await this.keystroke(key, mods);
            await this.pause();
        });
    }
    clear(target) {
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
    select(target, valueOrLabel) {
        return this.enqueue(async () => {
            await this.doClick(target, 0, 1);
            const { el } = await this.resolve(target);
            if (!(el instanceof HTMLSelectElement)) {
                throw new GhostUserError("select() necesita un elemento <select>");
            }
            const opt = Array.from(el.options).find(o => o.value === valueOrLabel || o.text.trim() === valueOrLabel);
            if (!opt)
                throw new GhostUserError(`No existe la opción "${valueOrLabel}"`);
            el.value = opt.value;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            await this.pause();
        });
    }
    destroy() {
        this.cursorRoot?.remove();
        this.cursorRoot = undefined;
        this.cursorSvg = undefined;
    }
    checkAbort() {
        const s = this.opts.signal;
        if (s?.aborted)
            throw s.reason ?? new DOMException("Secuencia cancelada", "AbortError");
    }
    sleep(ms) {
        const signal = this.opts.signal;
        const real = Math.max(0, ms * this.opts.timeScale);
        return new Promise((resolve, reject) => {
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
    pause() {
        return this.sleep(this.opts.delay);
    }
    waitForElement(selector, o = {}) {
        const timeout = o.timeout ?? this.opts.timeout;
        const visible = o.visible ?? true;
        const signal = this.opts.signal;
        const find = () => {
            const el = document.querySelector(selector);
            return el && (!visible || isVisible(el)) ? el : null;
        };
        const now = find();
        if (now)
            return Promise.resolve(now);
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (fn) => {
                if (done)
                    return;
                done = true;
                mo.disconnect();
                clearInterval(iv);
                clearTimeout(to);
                signal?.removeEventListener("abort", onAbort);
                fn();
            };
            const check = () => {
                const el = find();
                if (el)
                    finish(() => resolve(el));
            };
            const onAbort = () => finish(() => reject(signal?.reason ?? new DOMException("Secuencia cancelada", "AbortError")));
            const mo = new MutationObserver(check);
            mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
            const iv = setInterval(check, 50);
            const to = setTimeout(() => finish(() => reject(new GhostUserError(`Timeout (${timeout} ms) esperando "${selector}"${visible ? " visible" : ""}`))), timeout);
            signal?.addEventListener("abort", onAbort, { once: true });
        });
    }
    async resolve(target) {
        const t = typeof target === "string" ? await this.waitForElement(target) : target;
        if (t instanceof Element) {
            let r = t.getBoundingClientRect();
            const inView = r.top >= 0 && r.left >= 0 &&
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
    elementAtCursor() {
        return document.elementFromPoint(this.x, this.y);
    }
    async doMove(target) {
        const { el, x, y } = await this.resolve(target);
        await this.glide(x, y);
        this.setPos(x, y);
        this.hoverAt(x, y);
        return el;
    }
    async glide(x1, y1) {
        const x0 = this.x;
        const y0 = this.y;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        if (this.opts.timeScale === 0 || dist < 1)
            return;
        const duration = this.opts.moveDuration * this.opts.timeScale *
            Math.min(1.6, 0.4 + dist / 800) * (0.9 + Math.random() * 0.2);
        const nx = -(y1 - y0) / dist;
        const ny = (x1 - x0) / dist;
        const off = (Math.random() * 2 - 1) * dist * this.opts.curve;
        const cx = (x0 + x1) / 2 + nx * off;
        const cy = (y0 + y1) / 2 + ny * off;
        const start = performance.now();
        await new Promise((resolve, reject) => {
            const tick = (now) => {
                try {
                    this.checkAbort();
                }
                catch (e) {
                    reject(e);
                    return;
                }
                const t = Math.min(Math.max((now - start) / duration, 0), 1);
                const e = easeInOut(t);
                const u = 1 - e;
                const x = u * u * x0 + 2 * u * e * cx + e * e * x1;
                const y = u * u * y0 + 2 * u * e * cy + e * e * y1;
                this.setPos(x, y);
                this.hoverAt(x, y);
                if (t < 1)
                    requestAnimationFrame(tick);
                else
                    resolve();
            };
            requestAnimationFrame(tick);
        });
    }
    async doClick(target, button, clicks) {
        let expected = null;
        if (target !== undefined)
            expected = await this.doMove(target);
        const el = this.elementAtCursor();
        if (!el)
            throw new GhostUserError("No hay ningún elemento bajo el cursor");
        if (expected && !expected.contains(el)) {
            throw new GhostUserError(`El elemento está tapado por <${el.tagName.toLowerCase()}>`);
        }
        if (el.closest(":disabled, [aria-disabled='true']")) {
            throw new GhostUserError(`El elemento <${el.tagName.toLowerCase()}> está deshabilitado`);
        }
        for (let i = 1; i <= clicks; i++) {
            await this.pressButton(el, button, i);
            if (i < clicks)
                await this.sleep(60);
        }
        if (clicks === 2 && button === 0)
            this.fire(el, "dblclick", { detail: 2 });
    }
    async pressButton(el, button, detail) {
        const down = button === 0 ? 1 : 2;
        this.setPressed(true);
        this.fire(el, "pointerdown", { button, buttons: down });
        const ok = this.fire(el, "mousedown", { button, buttons: down, detail });
        if (ok && button === 0)
            this.focusFromClick(el);
        await this.sleep(80);
        this.setPressed(false);
        this.ripple();
        this.fire(el, "pointerup", { button, buttons: 0 });
        this.fire(el, "mouseup", { button, buttons: 0, detail });
        if (button === 0)
            this.fire(el, "click", { button: 0, detail });
        else
            this.fire(el, "contextmenu", { button: 2, detail });
    }
    focusFromClick(el) {
        const focusable = el.closest(FOCUSABLE);
        if (focusable)
            focusable.focus({ preventScroll: true });
        else if (document.activeElement instanceof HTMLElement)
            document.activeElement.blur();
    }
    hoverAt(x, y) {
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
    fire(el, type, init = {}) {
        const noBubble = /enter$|leave$/.test(type);
        const base = {
            bubbles: !noBubble,
            cancelable: !noBubble,
            composed: true,
            view: window,
            clientX: this.x,
            clientY: this.y,
            ...init,
        };
        const ev = type.startsWith("pointer") && typeof PointerEvent !== "undefined"
            ? new PointerEvent(type, { ...base, pointerId: 1, pointerType: "mouse", isPrimary: true })
            : new MouseEvent(type, base);
        return el.dispatchEvent(ev);
    }
    async keystroke(key, mods = {}) {
        this.checkAbort();
        const active = document.activeElement;
        const target = active && active !== document.body ? active : document.body;
        const init = {
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
            }
            else if (key === "Enter") {
                this.defaultEnter(target);
            }
            else if (key === "Backspace") {
                this.defaultBackspace(target);
            }
            else if (printable && ctrl) {
                if (key.toLowerCase() === "a" && isTextField(target))
                    target.select();
            }
            else if (printable) {
                if (key === " " && this.isButtonLike(target))
                    clickAfterKeyup = true;
                else
                    this.insertText(target, key);
            }
        }
        target.dispatchEvent(new KeyboardEvent("keyup", init));
        if (clickAfterKeyup && target instanceof HTMLElement)
            target.click();
    }
    isButtonLike(el) {
        if (el instanceof HTMLButtonElement)
            return true;
        return el instanceof HTMLInputElement &&
            ["button", "submit", "reset", "checkbox", "radio"].includes(el.type);
    }
    insertText(el, text) {
        if (isTextField(el)) {
            editField(el, "insertText", text, (value, start, end) => ({
                value: value.slice(0, start) + text + value.slice(end),
                caret: start + text.length,
            }));
        }
        else if (el instanceof HTMLElement && el.isContentEditable) {
            const ok = el.dispatchEvent(new InputEvent("beforeinput", {
                bubbles: true, cancelable: true, composed: true, data: text, inputType: "insertText",
            }));
            if (ok)
                document.execCommand("insertText", false, text);
        }
    }
    defaultBackspace(el) {
        if (isTextField(el)) {
            editField(el, "deleteContentBackward", null, (value, start, end) => {
                if (start === end) {
                    if (start === 0)
                        return null;
                    start -= 1;
                }
                return { value: value.slice(0, start) + value.slice(end), caret: start };
            });
        }
        else if (el instanceof HTMLElement && el.isContentEditable) {
            document.execCommand("delete");
        }
    }
    defaultEnter(el) {
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
            if (!form)
                return;
            const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
            if (submit) {
                if (!submit.matches(":disabled"))
                    submit.click();
            }
            else if (form.querySelectorAll("input").length <= 1) {
                form.requestSubmit();
            }
            return;
        }
        if (el instanceof HTMLButtonElement ||
            (el instanceof HTMLAnchorElement && el.hasAttribute("href")) ||
            (el instanceof HTMLInputElement && ["button", "submit", "reset", "image"].includes(el.type))) {
            el.click();
        }
    }
    moveFocus(back) {
        const list = focusables();
        if (list.length === 0)
            return;
        const idx = document.activeElement ? list.indexOf(document.activeElement) : -1;
        const next = idx === -1
            ? (back ? list[list.length - 1] : list[0])
            : list[(idx + (back ? -1 : 1) + list.length) % list.length];
        next.focus();
        if (next instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(next.type)) {
            try {
                next.select();
            }
            catch { }
        }
    }
    createCursor() {
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
            pointerEvents: "none",
            zIndex: "2147483647",
            willChange: "transform",
            transform: `translate(${this.x}px, ${this.y}px)`,
        });
        const svgWrap = document.createElement("div");
        Object.assign(svgWrap.style, {
            transformOrigin: "3px 2px",
            transition: "transform 80ms ease-out",
        });
        svgWrap.innerHTML =
            '<svg width="24" height="24" viewBox="0 0 24 24" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))">' +
                '<path d="M3 2l7.5 19 2.6-7.9L21 10.5z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>' +
                "</svg>";
        root.appendChild(svgWrap);
        document.body.appendChild(root);
        this.cursorRoot = root;
        this.cursorSvg = svgWrap;
    }
    setPos(x, y) {
        this.x = x;
        this.y = y;
        if (this.cursorRoot)
            this.cursorRoot.style.transform = `translate(${x}px, ${y}px)`;
    }
    setPressed(pressed) {
        if (this.cursorSvg)
            this.cursorSvg.style.transform = pressed ? "scale(.82)" : "scale(1)";
    }
    ripple() {
        if (!this.cursorRoot || typeof this.cursorRoot.animate !== "function")
            return;
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
        });
        document.body.appendChild(r);
        const anim = r.animate([{ transform: "scale(.4)", opacity: 0.9 }, { transform: "scale(1.6)", opacity: 0 }], { duration: 400 * Math.max(this.opts.timeScale, 0.1), easing: "ease-out" });
        anim.onfinish = () => r.remove();
    }
}
export function createUser(options = {}) {
    return new GhostUser(options);
}
//# sourceMappingURL=usuario-virtual.js.map