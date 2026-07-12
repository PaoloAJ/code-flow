import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import type {
  AnnotationEdge,
  AnnotationNode,
  CollabClientMsg,
  CollabOp,
  CollabServerMsg,
  Diagram,
  PeerInfo,
} from '@codeviz/shared';
import { requestUser } from './auth.js';
import { config } from './config.js';
import * as db from './db.js';

const PEER_COLORS = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#ec835a', '#d03b3b', '#1baf7a', '#4a3aa7'];
const FLUSH_MS = 1500;

interface Client {
  ws: WebSocket;
  peer: PeerInfo;
}

/** One live diagram: connected peers + the authoritative user layer. */
interface Room {
  diagramId: string;
  clients: Map<string, Client>;
  /** Loaded lazily from the DB; null when the diagram was never saved. */
  diagram: Diagram | null;
  dirty: boolean;
  flushTimer: NodeJS.Timeout | null;
  colorCursor: number;
}

const rooms = new Map<string, Room>();

function applyOp(diagram: Diagram, op: CollabOp) {
  switch (op.t) {
    case 'ann:add':
      diagram.annotations = [...diagram.annotations.filter((a) => a.id !== op.annotation.id), op.annotation];
      break;
    case 'ann:update':
      diagram.annotations = diagram.annotations.map((a) =>
        a.id === op.id ? ({ ...a, ...op.patch } as AnnotationNode) : a,
      );
      break;
    case 'ann:updateMany':
      diagram.annotations = diagram.annotations.map((a) =>
        op.ids.includes(a.id) ? ({ ...a, ...op.patch } as AnnotationNode) : a,
      );
      break;
    case 'ann:remove':
      diagram.annotations = diagram.annotations.filter((a) => !op.ids.includes(a.id));
      diagram.annotationEdges = diagram.annotationEdges.filter(
        (e) => !op.ids.includes(e.source) && !op.ids.includes(e.target),
      );
      break;
    case 'edge:add':
      diagram.annotationEdges = [
        ...diagram.annotationEdges.filter((e) => e.id !== op.edge.id),
        op.edge as AnnotationEdge,
      ];
      break;
    case 'edge:remove':
      diagram.annotationEdges = diagram.annotationEdges.filter((e) => !op.ids.includes(e.id));
      break;
    case 'pos':
      diagram.nodePositions = { ...diagram.nodePositions, [op.id]: op.xy };
      break;
  }
}

function scheduleFlush(room: Room) {
  room.dirty = true;
  if (room.flushTimer) return;
  room.flushTimer = setTimeout(() => {
    room.flushTimer = null;
    flush(room);
  }, FLUSH_MS);
}

function flush(room: Room) {
  if (!room.dirty || !room.diagram) return;
  room.dirty = false;
  room.diagram.updatedAt = new Date().toISOString();
  const owner = db.getDiagramOwner(room.diagramId);
  if (owner) db.saveDiagram(room.diagram, owner);
}

function broadcast(room: Room, msg: CollabServerMsg, exceptPeerId?: string) {
  const data = JSON.stringify(msg);
  for (const [id, client] of room.clients) {
    if (id !== exceptPeerId && client.ws.readyState === client.ws.OPEN) client.ws.send(data);
  }
}

export async function collabRoutes(app: FastifyInstance) {
  app.get('/api/collab', { websocket: true }, async (socket, req) => {
    const user = await requestUser(req);
    if (config.authRequired && !user) {
      socket.send(JSON.stringify({ type: 'error', message: 'sign in required' } satisfies CollabServerMsg));
      socket.close();
      return;
    }

    let room: Room | null = null;
    let peer: PeerInfo | null = null;

    socket.on('message', (raw: Buffer) => {
      let msg: CollabClientMsg;
      try {
        msg = JSON.parse(raw.toString()) as CollabClientMsg;
      } catch {
        return;
      }

      if (msg.type === 'join' && !room) {
        if (!/^[\w-]+$/.test(msg.diagramId)) return;
        let r = rooms.get(msg.diagramId);
        if (!r) {
          r = {
            diagramId: msg.diagramId,
            clients: new Map(),
            diagram: db.getDiagram(msg.diagramId),
            dirty: false,
            flushTimer: null,
            colorCursor: 0,
          };
          rooms.set(msg.diagramId, r);
        }
        room = r;
        peer = {
          id: randomUUID(),
          name: user?.name ?? 'Guest',
          color: PEER_COLORS[r.colorCursor++ % PEER_COLORS.length],
        };
        const others = [...r.clients.values()].map((c) => c.peer);
        r.clients.set(peer.id, { ws: socket, peer });
        socket.send(
          JSON.stringify({
            type: 'joined',
            self: peer,
            peers: others,
            diagram: r.diagram,
          } satisfies CollabServerMsg),
        );
        broadcast(r, { type: 'peer-joined', peer }, peer.id);
        return;
      }

      if (!room || !peer) return;

      if (msg.type === 'op') {
        if (room.diagram) {
          applyOp(room.diagram, msg.op);
          scheduleFlush(room);
        }
        broadcast(room, { type: 'op', from: peer.id, op: msg.op }, peer.id);
      } else if (msg.type === 'cursor') {
        broadcast(room, { type: 'cursor', from: peer.id, x: msg.x, y: msg.y }, peer.id);
      }
    });

    socket.on('close', () => {
      if (!room || !peer) return;
      room.clients.delete(peer.id);
      broadcast(room, { type: 'peer-left', id: peer.id });
      if (room.clients.size === 0) {
        if (room.flushTimer) clearTimeout(room.flushTimer);
        flush(room);
        rooms.delete(room.diagramId);
      }
    });
  });
}
