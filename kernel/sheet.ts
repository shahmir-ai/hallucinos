/**
 * Slicing a 4x4 image sheet into sixteen cells (SPEC §12.5).
 *
 * Two places need the same arithmetic and must not disagree: the kernel slices
 * the boot icon sheet into the desktop's launchers, and the runtime injected
 * into a generated document slices a `faces` sheet into that document's
 * `[data-os-face]` elements (SEAM S1). Pure numbers, no DOM, so vitest can hold
 * them still.
 */

/**
 * How much of each cell's edge is trimmed.
 *
 * flux draws "a 4 by 4 grid" with gutters and stray rules between cells, so
 * slicing at exact quarters puts a slice of the neighbouring icons inside every
 * launcher (seen on the first real boot). Trimming 7% on each side of a cell
 * costs nothing and drops the bleed.
 */
export const SHEET_INSET = 0.07;

export const SHEET_COLS = 4;
export const SHEET_CELLS = SHEET_COLS * SHEET_COLS;

/** background-size, as a percentage of the element's own box. */
export const SHEET_ZOOM = Math.round((400 / (1 - 2 * SHEET_INSET)) * 100) / 100;

/** background-position for column or row `n` (0..3). */
export function cellPos(n: number): number {
  return Math.round(((100 * (n + SHEET_INSET)) / (SHEET_COLS - 1 + 2 * SHEET_INSET)) * 100) / 100;
}

export interface SheetSlice {
  size: string;
  position: string;
}

/** The two background properties that show cell `index` (0..15) of a 4x4 sheet. */
export function sheetSlice(index: number): SheetSlice {
  const i = Math.max(0, Math.min(SHEET_CELLS - 1, Math.floor(index) || 0));
  return {
    size: `${SHEET_ZOOM}% ${SHEET_ZOOM}%`,
    position: `${cellPos(i % SHEET_COLS)}% ${cellPos(Math.floor(i / SHEET_COLS))}%`,
  };
}
