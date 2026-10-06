import { describe, expect, it } from 'vitest';
import { fitGrid, gridExtent, parseCoord, suggestPosition } from '../src/map.ts';

describe('map grid (R-SCN-18)', () => {
  it('R-SCN-18: parses grid coordinates; "FR" is not a grid cell', () => {
    expect(parseCoord('K8')).toEqual({ letter: 10, number: 8 });
    expect(parseCoord(' a12 ')).toEqual({ letter: 0, number: 12 });
    expect(parseCoord('FR')).toBeNull();
    expect(parseCoord(null)).toBeNull();
    expect(parseCoord('')).toBeNull();
  });

  it('R-SCN-18: needs two markers that differ in letter and number', () => {
    expect(fitGrid([])).toBeNull();
    expect(fitGrid([{ coord: 'A1', x: 0.1, y: 0.1 }])).toBeNull();
    expect(
      fitGrid([
        { coord: 'A1', x: 0.1, y: 0.1 },
        { coord: 'A5', x: 0.1, y: 0.5 },
      ]),
    ).toBeNull();
    expect(
      fitGrid([
        { coord: 'FR', x: 0.5, y: 0.9 },
        { coord: 'A1', x: 0.1, y: 0.1 },
      ]),
    ).toBeNull();
  });

  it('R-SCN-18: two markers give a letters-as-columns grid', () => {
    const fit = fitGrid([
      { coord: 'A1', x: 0.05, y: 0.1 },
      { coord: 'K6', x: 0.55, y: 0.6 },
    ]);
    expect(fit?.lettersOnX).toBe(true);
    const p = suggestPosition('F3', fit)!;
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.3);
  });

  it('R-SCN-18: picks the orientation that fits the placed markers better', () => {
    // Letters run down, numbers run across.
    const at = (letter: number, number: number) => ({ x: number * 0.05, y: letter * 0.07 });
    const fit = fitGrid([
      { coord: 'A2', ...at(0, 2) },
      { coord: 'C9', ...at(2, 9) },
      { coord: 'H4', ...at(7, 4) },
    ]);
    expect(fit?.lettersOnX).toBe(false);
    const p = suggestPosition('E10', fit)!;
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.28);
  });

  it('R-SCN-18: suggestions stay on the image and skip "FR"', () => {
    const fit = fitGrid([
      { coord: 'A1', x: 0.5, y: 0.5 },
      { coord: 'B2', x: 0.9, y: 0.9 },
    ]);
    expect(suggestPosition('E5', fit)).toEqual({ x: 1, y: 1 });
    expect(suggestPosition('FR', fit)).toBeNull();
    expect(suggestPosition('A1', null)).toBeNull();
  });

  it('R-SCN-18: placeholder grid covers all coordinates', () => {
    expect(gridExtent(['K8', 'R2', 'B13', 'FR', null])).toEqual({ letters: 18, numbers: 13 });
    expect(gridExtent([])).toEqual({ letters: 1, numbers: 1 });
  });
});
