// techtrash.org : Undo and Redo, of the editor's own.
//
// A snapshot of what's written, and where the cursor was, after each change
// (or each burst of typing: a pause of PAUSE ends one). The browser's own Undo
// only knows about the changes the browser made, and the editor makes some of
// its own (a picture kept first in its paragraph, an empty line tidied away, a
// size dragged, a line of Markdown drawn again), so the browser's undoes the
// wrong things: lines come back, a picture goes. editor.js's box and
// live-markdown.js's each keep one.
//
// createHistory(read, write)
//   read()        { content, caret } as things are now
//   write(state)  puts a snapshot back
// gives back { reset(), soon(), now(), undo(), redo() }: soon() after a change,
// now() to take the snapshot straight away.

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
