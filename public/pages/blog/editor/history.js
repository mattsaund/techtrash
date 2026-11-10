// The editor's own Undo and Redo. The browser's Undo only knows the changes
// the browser made, but the editor makes some of its own (a picture kept first
// in its paragraph, an empty line tidied away, a dragged size, a Markdown line
// drawn again), so the browser's Undo gets it wrong (lines come back, a
// picture vanishes). editor.js and live-markdown.js each keep one of these.
//
// It snapshots the content and the cursor after each change, or after each
// burst of typing (a pause of PAUSE ends one).
//
// createHistory(read, write) returns
//   { reset(), soon(), now(), undo(), redo() }
// read() gives { content, caret } as things are now and write(state) puts a
// snapshot back. Call soon() after a change, or now() to snapshot right away.

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
