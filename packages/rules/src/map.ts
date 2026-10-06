// Map marker helpers. RULE: R-SCN-18 (stickers go on the map by grid coordinate; "FR" is a
// numbered spot inside Frosthaven). Pixel positions are host-placed data; these helpers only
// suggest positions from the grid once a few markers are placed.

export interface GridCell {
  /** 0-based letter index (A = 0). */
  letter: number;
  /** Number part as printed (1-based). */
  number: number;
}

/** Parses a coordinate like "K8". Returns null for "FR" and anything that is not a grid cell. */
export function parseCoord(coord: string | null | undefined): GridCell | null {
  const m = /^\s*([A-Za-z])\s*(\d{1,2})\s*$/.exec(coord ?? '');
  if (!m) return null;
  return { letter: m[1]!.toUpperCase().charCodeAt(0) - 65, number: Number(m[2]) };
}

export interface PlacedMarker {
  coord: string | null;
  x: number;
  y: number;
}

/** Linear map from grid cells to relative image positions (0..1). */
export interface GridFit {
  /** true: letters run along x and numbers along y. */
  lettersOnX: boolean;
  x0: number;
  dx: number;
  y0: number;
  dy: number;
}

function line(pts: [number, number][]): { a: number; b: number; err: number } | null {
  if (new Set(pts.map((p) => p[0])).size < 2) return null;
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
  }
  const b = sxy / sxx;
  const a = my - b * mx;
  const err = pts.reduce((s, [x, y]) => s + (a + b * x - y) ** 2, 0);
  return { a, b, err };
}

/**
 * Fits the map grid from markers already placed on grid cells (least squares per axis).
 * Needs two markers that differ in both letter and number. Which axis the letters run along
 * is not stated in the rules, so both orientations are tried and the closer fit wins; with
 * an exact tie (e.g. only two markers) letters are taken as columns.
 */
export function fitGrid(placed: PlacedMarker[]): GridFit | null {
  const pts = placed.flatMap((p) => {
    const c = parseCoord(p.coord);
    return c ? [{ ...c, x: p.x, y: p.y }] : [];
  });
  let best: { fit: GridFit; err: number } | null = null;
  for (const lettersOnX of [true, false]) {
    const fx = line(pts.map((p) => [lettersOnX ? p.letter : p.number, p.x]));
    const fy = line(pts.map((p) => [lettersOnX ? p.number : p.letter, p.y]));
    if (!fx || !fy || fx.b === 0 || fy.b === 0) continue;
    const fit = { lettersOnX, x0: fx.a, dx: fx.b, y0: fy.a, dy: fy.b };
    const err = fx.err + fy.err;
    if (!best || err < best.err - 1e-9) best = { fit, err };
  }
  return best?.fit ?? null;
}

/** Suggested relative position of a grid coordinate, clamped to the image. */
export function suggestPosition(
  coord: string | null | undefined,
  fit: GridFit | null,
): { x: number; y: number } | null {
  const c = parseCoord(coord);
  if (!c || !fit) return null;
  const [u, v] = fit.lettersOnX ? [c.letter, c.number] : [c.number, c.letter];
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  return { x: clamp(fit.x0 + fit.dx * u), y: clamp(fit.y0 + fit.dy * v) };
}

/** Grid size needed to show all given coordinates (letters as columns), at least 1×1. */
export function gridExtent(coords: (string | null)[]): { letters: number; numbers: number } {
  let letters = 1;
  let numbers = 1;
  for (const c of coords.map(parseCoord)) {
    if (!c) continue;
    letters = Math.max(letters, c.letter + 1);
    numbers = Math.max(numbers, c.number);
  }
  return { letters, numbers };
}
