// Desktop icon grid, shared by js/icons.js and server/desktop.js so both agree
// on free cells. A cell is [column, row] from the top left, --icon-cell square.

export const LAST_CELL = 99;   // no column or row past this one

export const cellKey = ([column, row]) => `${column},${row}`;

// Nearest free cell within `columns` x `rows`. Ties go to the leftmost, then
// the topmost. Null if full.
export function nearestFree(cell, taken, columns = LAST_CELL + 1, rows = LAST_CELL + 1) {
  let best = null;
  let bestDistance = Infinity;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      if (taken.has(cellKey([column, row]))) continue;
      const distance = (column - cell[0]) ** 2 + (row - cell[1]) ** 2;
      if (distance < bestDistance) {
        best = [column, row];
        bestDistance = distance;
      }
    }
  }
  return best;
}

// Icons per column before the next, like XP. Seven fit a 768 px tall screen.
// Smaller screens show the rest in the nearest free cell (js/icons.js).
const COLUMN_ROWS = 7;

// First free cell, column by column like XP.
export function nextFreeCell(taken) {
  for (let column = 0; column <= LAST_CELL; column++) {
    for (let row = 0; row < COLUMN_ROWS; row++) {
      if (!taken.has(cellKey([column, row]))) return [column, row];
    }
  }
  return [0, 0];
}

// Starting cells. `saved` maps ids to stored cells. The rest take the next
// free cells, in `ids` order.
export function startingCells(ids, saved) {
  const cells = new Map(ids.filter((id) => saved.has(id)).map((id) => [id, saved.get(id)]));
  const taken = new Set([...cells.values()].map(cellKey));
  for (const id of ids) {
    if (cells.has(id)) continue;
    const cell = nextFreeCell(taken);
    cells.set(id, cell);
    taken.add(cellKey(cell));
  }
  return cells;
}
