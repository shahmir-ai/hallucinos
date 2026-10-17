import { describe, it, expect } from 'vitest';
import { sheetSlice, cellPos, SHEET_CELLS, SHEET_COLS, SHEET_ZOOM, SHEET_INSET } from '../kernel/sheet.js';

/**
 * One 4x4 sheet, sixteen cells, two consumers: the kernel slices the boot icon
 * sheet into the desktop's launchers and the injected runtime slices a `faces`
 * sheet into a page's `[data-os-face]` elements (SEAM S1). If these two ever
 * disagree, half the product's images are off by a cell.
 */
describe('4x4 sheet slicing', () => {
  it('is a 4x4 sheet of sixteen cells', () => {
    expect(SHEET_COLS).toBe(4);
    expect(SHEET_CELLS).toBe(16);
  });

  it('zooms so one inset cell fills the element', () => {
    expect(SHEET_ZOOM).toBeGreaterThan(400);
    expect(SHEET_INSET).toBeGreaterThan(0);
    expect(SHEET_INSET).toBeLessThan(0.2);
  });

  it('puts cell 0 top-left and cell 15 bottom-right', () => {
    const first = sheetSlice(0);
    expect(first.position).toBe(`${cellPos(0)}% ${cellPos(0)}%`);
    // the number e2e/images.spec.ts asserts on the live desktop
    expect(first.position).toBe('2.23% 2.23%');
    const last = sheetSlice(15);
    expect(last.position).toBe(`${cellPos(3)}% ${cellPos(3)}%`);
    expect(cellPos(3)).toBeGreaterThan(cellPos(0));
  });

  it('walks in reading order: column then row', () => {
    for (let i = 0; i < SHEET_CELLS; i++) {
      const s = sheetSlice(i);
      const [x, y] = s.position.split(' ');
      expect(x).toBe(cellPos(i % 4) + '%');
      expect(y).toBe(cellPos(Math.floor(i / 4)) + '%');
      expect(s.size).toBe(`${SHEET_ZOOM}% ${SHEET_ZOOM}%`);
    }
    expect(new Set(Array.from({ length: SHEET_CELLS }, (_, i) => sheetSlice(i).position)).size).toBe(SHEET_CELLS);
  });

  it('clamps a model-written index instead of sliding off the sheet', () => {
    // data-os-face="99" and data-os-face="-3" are both things a model writes
    expect(sheetSlice(99)).toEqual(sheetSlice(15));
    expect(sheetSlice(-3)).toEqual(sheetSlice(0));
    expect(sheetSlice(NaN)).toEqual(sheetSlice(0));
    expect(sheetSlice(2.7)).toEqual(sheetSlice(2));
  });
});
