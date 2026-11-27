const SVG_NS = "http://www.w3.org/2000/svg";
export function computeGridSteps(scale, minSpacingPx) {
    const minWorld = minSpacingPx / scale;
    const base = 10 ** Math.floor(Math.log10(minWorld));
    const tolerance = 1 - 1e-9;
    const candidates = [
        [1, 5],
        [2, 5],
        [5, 2],
        [10, 5],
    ];
    for (const [mantissa, majorFactor] of candidates) {
        const minor = mantissa * base;
        if (minor >= minWorld * tolerance) {
            return { minor, major: minor * majorFactor };
        }
    }
    return { minor: 10 * base, major: 50 * base };
}
let instanceCounter = 0;
export class GridLayer {
    layer;
    camera;
    minor;
    major;
    unsubscribe;
    options;
    constructor(layer, camera, options = {}) {
        this.layer = layer;
        this.camera = camera;
        this.options = {
            minSpacingPx: options.minSpacingPx ?? 14,
            dotRadius: options.dotRadius ?? 1,
            dotColor: options.dotColor ?? "#b0b0b0",
            majorDotRadius: options.majorDotRadius ?? 1.6,
            majorDotColor: options.majorDotColor ?? "#606060",
        };
        const id = `grid-${instanceCounter++}`;
        const defs = document.createElementNS(SVG_NS, "defs");
        this.minor = this.createDotPattern(`${id}-minor`, this.options.dotRadius, this.options.dotColor);
        this.major = this.createDotPattern(`${id}-major`, this.options.majorDotRadius, this.options.majorDotColor);
        defs.append(this.minor.pattern, this.major.pattern);
        this.layer.append(defs, this.minor.rect, this.major.rect);
        this.unsubscribe = camera.subscribe(() => this.render());
        this.render();
    }
    dispose() {
        this.unsubscribe();
        this.layer.replaceChildren();
    }
    createDotPattern(id, radius, color) {
        const pattern = document.createElementNS(SVG_NS, "pattern");
        pattern.setAttribute("id", id);
        pattern.setAttribute("patternUnits", "userSpaceOnUse");
        const circle = document.createElementNS(SVG_NS, "circle");
        circle.setAttribute("r", String(radius));
        circle.setAttribute("fill", color);
        pattern.append(circle);
        const rect = document.createElementNS(SVG_NS, "rect");
        rect.setAttribute("x", "0");
        rect.setAttribute("y", "0");
        rect.setAttribute("fill", `url(#${id})`);
        rect.setAttribute("pointer-events", "none");
        return { pattern, circle, rect };
    }
    render() {
        const { camera } = this;
        if (camera.width === 0 || camera.height === 0)
            return;
        const steps = computeGridSteps(camera.scale, this.options.minSpacingPx);
        const origin = camera.worldToScreen({ x: 0, y: 0 });
        this.updatePattern(this.minor, steps.minor * camera.scale, origin.x, origin.y);
        this.updatePattern(this.major, steps.major * camera.scale, origin.x, origin.y);
    }
    updatePattern(dp, stepPx, originX, originY) {
        const mod = (v) => ((v % stepPx) + stepPx) % stepPx;
        dp.pattern.setAttribute("x", String(mod(originX - stepPx / 2)));
        dp.pattern.setAttribute("y", String(mod(originY - stepPx / 2)));
        dp.pattern.setAttribute("width", String(stepPx));
        dp.pattern.setAttribute("height", String(stepPx));
        dp.circle.setAttribute("cx", String(stepPx / 2));
        dp.circle.setAttribute("cy", String(stepPx / 2));
        dp.rect.setAttribute("width", String(this.camera.width));
        dp.rect.setAttribute("height", String(this.camera.height));
    }
}
//# sourceMappingURL=GridLayer.js.map