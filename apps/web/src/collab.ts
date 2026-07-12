import type { CollabClientMsg, CollabOp, CollabServerMsg } from '@codeviz/shared';
import { authToken } from './api';
import { collabBus } from './collabBus';
import { useStore } from './store';

let ws: WebSocket | null = null;
let lastCursorSent = 0;

function send(msg: CollabClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function applyRemoteOp(op: CollabOp) {
  const s = useStore.getState();
  switch (op.t) {
    case 'ann:add':
      // remote echo of an id we already have would duplicate — replace
      if (s.annotations.some((a) => a.id === op.annotation.id)) {
        s.updateAnnotation(op.annotation.id, op.annotation);
      } else {
        s.addAnnotation(op.annotation);
      }
      break;
    case 'ann:update':
      s.updateAnnotation(op.id, op.patch);
      break;
    case 'ann:updateMany':
      s.updateAnnotations(op.ids, op.patch);
      break;
    case 'ann:remove':
      s.removeAnnotations(op.ids);
      break;
    case 'edge:add':
      s.addAnnotationEdge(op.edge);
      break;
    case 'edge:remove':
      s.removeAnnotationEdges(op.ids);
      break;
    case 'pos':
      s.moveNode(op.id, op.xy);
      break;
  }
}

function handle(msg: CollabServerMsg) {
  const s = useStore.getState();
  switch (msg.type) {
    case 'joined':
      s.setPeers(msg.peers);
      s.setCollabActive(true);
      // The server's copy is authoritative for everyone in the room.
      if (msg.diagram) {
        collabBus.applyRemote(() => {
          s.loadDiagram(msg.diagram!);
          useStore.temporal.getState().clear();
        });
      }
      break;
    case 'peer-joined':
      s.addPeer(msg.peer);
      break;
    case 'peer-left':
      s.removePeer(msg.id);
      break;
    case 'op':
      collabBus.applyRemote(() => applyRemoteOp(msg.op));
      break;
    case 'cursor':
      s.setCursor(msg.from, { x: msg.x, y: msg.y });
      break;
    case 'error':
      console.warn('collab:', msg.message);
      leaveCollab();
      break;
  }
}

export function joinCollab(diagramId: string) {
  leaveCollab();
  void (async () => {
    // Clerk mode: browsers can't set WS headers, so the token rides the URL.
    const token = await authToken();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${proto}://${location.host}/api/collab${token ? `?token=${encodeURIComponent(token)}` : ''}`,
    );
    ws = socket;
    socket.onopen = () => send({ type: 'join', diagramId });
    socket.onmessage = (ev) => handle(JSON.parse(ev.data as string) as CollabServerMsg);
    socket.onclose = () => {
      if (ws !== socket) return; // superseded by a newer session
      collabBus.setSender(null);
      const s = useStore.getState();
      s.setPeers([]);
      s.setCollabActive(false);
    };
    collabBus.setSender((op) => send({ type: 'op', op }));
  })();
}

export function leaveCollab() {
  if (!ws) return;
  const socket = ws;
  ws = null;
  socket.onclose = null;
  socket.close();
  collabBus.setSender(null);
  const s = useStore.getState();
  s.setPeers([]);
  s.setCollabActive(false);
}

/** Broadcast our cursor in flow coordinates, throttled to ~25 msg/s. */
export function sendCursor(x: number, y: number) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const now = Date.now();
  if (now - lastCursorSent < 40) return;
  lastCursorSent = now;
  send({ type: 'cursor', x, y });
}
