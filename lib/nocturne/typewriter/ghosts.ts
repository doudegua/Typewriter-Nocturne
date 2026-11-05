// What the paper remembers.
//
// In classic typewriter mode the terminal is allowed to take a character back (the shell needs its
// backspace), but a typewriter's ink does not come off paper. This is the comparison that finds
// the cells a redraw has emptied, so the Nocturne layer can leave a faint stain where the glyph
// used to be.

/** One cell of a row: what was printed there, and how. */
export type GhostCell = {
  char: string;
  /** Cells the glyph covers (two for wide characters). */
  width: number;
  fg: number | string | null;
  bold: boolean;
};

/** Columns of a row that held a character before and hold nothing now. */
export function vanishedCells(before: GhostCell[], after: GhostCell[]): number[] {
  const vanished: number[] = [];
  const cols = Math.min(before.length, after.length);
  for (let col = 0; col < cols; col++) {
    const was = before[col];
    const now = after[col];
    if (was.char.trim() !== '' && now.char.trim() === '' && was.char !== now.char) {
      vanished.push(col);
    }
  }
  return vanished;
}
