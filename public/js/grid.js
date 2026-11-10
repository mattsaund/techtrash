// The desktop's icon grid. The page (js/icons.js) and the server
// (server/desktop.js) both use it, so they always agree on which cells are
// free.
//
// A cell is [column, row], counted from the top left like XP's desktop with
// Align to Grid on. Each one is --icon-cell square.

export const LAST_CELL = 99;   // no column or row past this one

export const cellKey = ([column, row]) => `${column},${row}`;

// The free cell nearest `cell`, among the first `columns` x `rows`. Ties go to
// the leftmost, then the highest. Null if they're all taken.
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

// How many icons go down a column before XP starts the next one. Seven fit a
// screen 768 pixels tall, and a smaller screen shows the rest in the nearest
// free cell it has (js/icons.js).
const COLUMN_ROWS = 7;

// The first free cell, going down each column in turn like XP.
export function nextFreeCell(taken) {
  for (let column = 0; column <= LAST_CELL; column++) {
    for (let row = 0; row < COLUMN_ROWS; row++) {
      if (!taken.has(cellKey([column, row]))) return [column, row];
    }
  }
  return [0, 0];
}

// Where every icon starts. `saved` maps ids to the cells the server already
// has. Icons without one take the next free cells down XP's columns, in the
// order of `ids`.
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
