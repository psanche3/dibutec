export class Camera {
    minScale;
    maxScale;
    _scale;
    _center;
    _width = 0;
    _height = 0;
    listeners = new Set();
    constructor(options = {}) {
        this.minScale = options.minScale ?? 0.01;
        this.maxScale = options.maxScale ?? 1000;
        this._scale = this.clampScale(options.scale ?? 1);
        this._center = { ...(options.center ?? { x: 0, y: 0 }) };
    }
    get scale() {
        return this._scale;
    }
    get center() {
        return { ...this._center };
    }
    get width() {
        return this._width;
    }
    get height() {
        return this._height;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    setViewportSize(width, height) {
        if (width === this._width && height === this._height)
            return;
        this._width = width;
        this._height = height;
        this.notify();
    }
    worldToScreen(p) {
        return {
            x: this._width / 2 + (p.x - this._center.x) * this._scale,
            y: this._height / 2 - (p.y - this._center.y) * this._scale,
        };
    }
    screenToWorld(p) {
        return {
            x: this._center.x + (p.x - this._width / 2) / this._scale,
            y: this._center.y - (p.y - this._height / 2) / this._scale,
        };
    }
    zoomAt(screenPoint, factor) {
        const newScale = this.clampScale(this._scale * factor);
        if (newScale === this._scale)
            return;
        const anchor = this.screenToWorld(screenPoint);
        this._scale = newScale;
        this._center = {
            x: anchor.x - (screenPoint.x - this._width / 2) / newScale,
            y: anchor.y + (screenPoint.y - this._height / 2) / newScale,
        };
        this.notify();
    }
    panBy(dxScreen, dyScreen) {
        if (dxScreen === 0 && dyScreen === 0)
            return;
        this._center = {
            x: this._center.x - dxScreen / this._scale,
            y: this._center.y + dyScreen / this._scale,
        };
        this.notify();
    }
    clampScale(scale) {
        return Math.min(this.maxScale, Math.max(this.minScale, scale));
    }
    notify() {
        for (const listener of this.listeners)
            listener(this);
    }
}
//# sourceMappingURL=Camera.js.map