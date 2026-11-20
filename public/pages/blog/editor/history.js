// Snapshot undo/redo. Native undo only tracks the browser's own edits, so it breaks
// after the editor's DOM fixes (lines come back, pictures vanish).
// read() returns { content, caret }, write(state) restores one.
// soon() snapshots once changes pause for PAUSE ms, now() snapshots immediately.

const PAUSE = 400;
const MOST_UNDOS = 200;

export function createHistory(read, write) {
  const states = [];
  let at = -1;
  let waiting = 0;
  function now() {
    clearTimeout(waiting);
    waiting = 0;
    const state = read();
    if (states[at]?.content === state.content) {
      states[at].caret = state.caret;
      return;
    }
    states.splice(at + 1);
    states.push(state);
    if (states.length > MOST_UNDOS) states.shift();
    at = states.length - 1;
  }
  const step = (by) => {
    if (waiting) now();
    if (!states[at + by]) return;
    at += by;
    write(states[at]);
  };
  return {
    reset() {
      states.length = 0;
      at = -1;
      now();
    },
    soon() {
      clearTimeout(waiting);
      waiting = setTimeout(now, PAUSE);
    },
    now,
    undo: () => step(-1),
    redo: () => step(1),
  };
}
