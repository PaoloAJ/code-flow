import type { CollabOp } from '@codeviz/shared';

/**
 * Tiny dependency-free bridge between the store and the collab socket.
 * Store actions emit ops here; the socket client registers a sender when a
 * live session is active. `applyRemote` guards against echo loops when
 * incoming ops are applied through the same store actions.
 */
type Sender = (op: CollabOp) => void;

let sender: Sender | null = null;
let applying = false;

export const collabBus = {
  setSender(s: Sender | null) {
    sender = s;
  },
  emit(op: CollabOp) {
    if (sender && !applying) sender(op);
  },
  applyRemote(fn: () => void) {
    applying = true;
    try {
      fn();
    } finally {
      applying = false;
    }
  },
};
