import type { Camera } from "./Camera.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface GridOptions {
	/** Separación mínima en pantalla (px) entre puntos menores. */
	minSpacingPx?: number;
	dotRadius?: number;
	dotColor?: string;
	majorDotRadius?: number;
	majorDotColor?: string;
}

interface GridSteps {
	/** Paso de los puntos menores, en unidades del mundo. */
	minor: number;
	/** Paso de los puntos mayores (múltiplo exacto de `minor`), en unidades del mundo. */
	major: number;
}

/**
 * Elige un paso "bonito" (1, 2, 5 × 10^k) tal que la separación en pantalla
 * sea >= minSpacingPx (y como mucho ~2.5 veces ese valor).
 * El paso mayor es 5×, 5× o 2× según el menor, de forma que siempre sea 1, 5 o 10 × 10^k.
 */
export function computeGridSteps(scale: number, minSpacingPx: number): GridSteps {
	const minWorld = minSpacingPx / scale;
	const base = 10 ** Math.floor(Math.log10(minWorld));
	const tolerance = 1 - 1e-9;

	const candidates: Array<[mantissa: number, majorFactor: number]> = [
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
	// Inalcanzable (10 * base > minWorld siempre), pero satisface al compilador.
	return { minor: 10 * base, major: 50 * base };
}

let instanceCounter = 0;

interface DotPattern {
	pattern: SVGPatternElement;
	circle: SVGCircleElement;
	rect: SVGRectElement;
}

/**
 * Capa de rejilla de puntos. Solo conoce la cámara (no el ratón).
 * Usa dos <pattern> (menor y mayor) aplicados a sendos <rect> que cubren la vista;
 * el radio de los puntos está siempre en píxeles, independientemente del zoom.
 */
export class GridLayer {
	private readonly minor: DotPattern;
	private readonly major: DotPattern;
	private readonly unsubscribe: () => void;
	private readonly options: Required<GridOptions>;

	constructor(
		private readonly layer: SVGGElement,
		private readonly camera: Camera,
		options: GridOptions = {},
	) {
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

	dispose(): void {
		this.unsubscribe();
		this.layer.replaceChildren();
	}

	private createDotPattern(id: string, radius: number, color: string): DotPattern {
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

	private render(): void {
		const { camera } = this;
		if (camera.width === 0 || camera.height === 0) return;

		const steps = computeGridSteps(camera.scale, this.options.minSpacingPx);
		const origin = camera.worldToScreen({ x: 0, y: 0 });

		this.updatePattern(this.minor, steps.minor * camera.scale, origin.x, origin.y);
		this.updatePattern(this.major, steps.major * camera.scale, origin.x, origin.y);
	}

	/**
	 * El punto se dibuja en el centro del tile, así que el tile se desplaza medio paso
	 * para que el centro caiga exactamente sobre el origen del mundo (y sus múltiplos).
	 */
	private updatePattern(dp: DotPattern, stepPx: number, originX: number, originY: number): void {
		const mod = (v: number) => ((v % stepPx) + stepPx) % stepPx;

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
