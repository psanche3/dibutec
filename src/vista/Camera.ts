export interface Point {
	x: number;
	y: number;
}

export type CameraListener = (camera: Camera) => void;

export interface CameraOptions {
	/** Píxeles por unidad del mundo. Por defecto 1. */
	scale?: number;
	minScale?: number;
	maxScale?: number;
	/** Punto del mundo que se muestra en el centro de la vista. Por defecto (0, 0). */
	center?: Point;
}

/**
 * Cámara 2D: única responsable de la proyección mundo <-> pantalla.
 *
 * - Mundo: X positivo a la derecha, Y positivo hacia arriba.
 * - Pantalla: píxeles del SVG (origen arriba a la izquierda, Y hacia abajo).
 * - `scale` = píxeles por unidad del mundo.
 * - `center` = punto del mundo situado en el centro de la vista.
 */
export class Camera {
	readonly minScale: number;
	readonly maxScale: number;

	private _scale: number;
	private _center: Point;
	private _width = 0;
	private _height = 0;
	private readonly listeners = new Set<CameraListener>();

	constructor(options: CameraOptions = {}) {
		this.minScale = options.minScale ?? 0.01;
		this.maxScale = options.maxScale ?? 1000;
		this._scale = this.clampScale(options.scale ?? 1);
		this._center = { ...(options.center ?? { x: 0, y: 0 }) };
	}

	get scale(): number {
		return this._scale;
	}

	get center(): Point {
		return { ...this._center };
	}

	get width(): number {
		return this._width;
	}

	get height(): number {
		return this._height;
	}

	/** Suscribe un listener a los cambios. Devuelve la función para cancelar la suscripción. */
	subscribe(listener: CameraListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	setViewportSize(width: number, height: number): void {
		if (width === this._width && height === this._height) return;
		this._width = width;
		this._height = height;
		this.notify();
	}

	worldToScreen(p: Point): Point {
		return {
			x: this._width / 2 + (p.x - this._center.x) * this._scale,
			y: this._height / 2 - (p.y - this._center.y) * this._scale,
		};
	}

	screenToWorld(p: Point): Point {
		return {
			x: this._center.x + (p.x - this._width / 2) / this._scale,
			y: this._center.y - (p.y - this._height / 2) / this._scale,
		};
	}

	/** Multiplica la escala por `factor` manteniendo fijo el punto del mundo bajo `screenPoint`. */
	zoomAt(screenPoint: Point, factor: number): void {
		const newScale = this.clampScale(this._scale * factor);
		if (newScale === this._scale) return;

		const anchor = this.screenToWorld(screenPoint);
		this._scale = newScale;
		this._center = {
			x: anchor.x - (screenPoint.x - this._width / 2) / newScale,
			y: anchor.y + (screenPoint.y - this._height / 2) / newScale,
		};
		this.notify();
	}

	/** Desplaza la vista (para el pan futuro). Los argumentos están en píxeles de pantalla. */
	panBy(dxScreen: number, dyScreen: number): void {
		if (dxScreen === 0 && dyScreen === 0) return;
		this._center = {
			x: this._center.x - dxScreen / this._scale,
			y: this._center.y + dyScreen / this._scale,
		};
		this.notify();
	}

	private clampScale(scale: number): number {
		return Math.min(this.maxScale, Math.max(this.minScale, scale));
	}

	private notify(): void {
		for (const listener of this.listeners) listener(this);
	}
}
