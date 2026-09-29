// techtrash.org : the desktop's grid, used by both the page (js/icons.js) and
// the server (worker.js), so the two always agree on where a cell is free.
//
// Icons sit in cells, [column, row], counted from the top left, like XP's
// desktop with Align to Grid on. A cell is --icon-cell square.

export const LAST_CELL = 99;   // no column or row past this one

export const cellKey = ([column, row]) => `${column},${row}`;

// The free cell nearest `cell`, among the first `columns` x `rows`. Ties go to
// the leftmost, then the highest. Null if every one of them is taken.
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

// Where every icon starts. `saved` is the cells the server knows, by id; an
// icon without one goes in XP's column down the left, first free row first,
// in the order `ids` gives.
export function startingCells(ids, saved) {
  const cells = new Map(ids.filter((id) => saved.has(id)).map((id) => [id, saved.get(id)]));
  const taken = new Set([...cells.values()].map(cellKey));
  for (const id of ids) {
    if (cells.has(id)) continue;
    let row = 0;
    while (taken.has(cellKey([0, row])) && row < LAST_CELL) row++;
    cells.set(id, [0, row]);
    taken.add(cellKey([0, row]));
  }
  return cells;
}
