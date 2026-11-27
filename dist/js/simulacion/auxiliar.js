export const DELAY = 300;
export const DEFAULTS = {
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
    constructor(message) {
        super(message);
        this.name = "GhostUserError";
    }
}
export const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';
export const TEXT_INPUT_TYPES = new Set([
    "text", "search", "email", "url", "tel", "password", "number",
]);
export const easeInOut = (t) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
export function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0)
        return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none";
}
export function ancestors(el) {
    const chain = [];
    for (let n = el; n; n = n.parentElement)
        chain.push(n);
    return chain;
}
export function codeFor(key) {
    if (/^[a-z]$/i.test(key))
        return `Key${key.toUpperCase()}`;
    if (/^\d$/.test(key))
        return `Digit${key}`;
    if (key === " ")
        return "Space";
    return key;
}
export function parseCombo(combo) {
    const parts = combo.length > 1 ? combo.split("+") : [combo];
    const key = parts.pop() || "+";
    const mods = {};
    for (const p of parts.map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (p === "ctrl" || p === "control")
            mods.ctrlKey = true;
        else if (p === "shift")
            mods.shiftKey = true;
        else if (p === "alt")
            mods.altKey = true;
        else if (p === "meta" || p === "cmd")
            mods.metaKey = true;
    }
    return { key, mods };
}
function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter)
        setter.call(el, value);
    else
        el.value = value;
}
export function isTextField(el) {
    if (el instanceof HTMLTextAreaElement)
        return true;
    return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}
export function editField(el, inputType, data, compute) {
    if (el.readOnly || el.disabled)
        return;
    let start = el.value.length;
    let end = start;
    try {
        if (el.selectionStart !== null) {
            start = el.selectionStart;
            end = el.selectionEnd ?? start;
        }
    }
    catch { }
    const result = compute(el.value, start, end);
    if (!result)
        return;
    const before = new InputEvent("beforeinput", {
        bubbles: true, cancelable: true, composed: true, data, inputType,
    });
    if (!el.dispatchEvent(before))
        return;
    setNativeValue(el, result.value);
    try {
        el.setSelectionRange(result.caret, result.caret);
    }
    catch { }
    el.dispatchEvent(new InputEvent("input", {
        bubbles: true, composed: true, data, inputType,
    }));
}
export function focusables() {
    return Array.from(document.querySelectorAll(FOCUSABLE)).filter(el => {
        if (el.matches(":disabled"))
            return false;
        if (el instanceof HTMLInputElement && el.type === "hidden")
            return false;
        const ti = el.getAttribute("tabindex");
        if (ti !== null && Number(ti) < 0)
            return false;
        return isVisible(el);
    });
}
//# sourceMappingURL=auxiliar.js.map