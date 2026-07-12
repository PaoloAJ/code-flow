import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Diagram, DiagramListItem, SaveDiagramRequest, User } from '@codeviz/shared';
import { requireUser } from '../auth.js';
import * as db from '../db.js';

type Authed = FastifyRequest & { user: User };

export async function diagramRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/diagrams', async (req) => {
    const rows = db.listDiagrams((req as Authed).user.id);
    const diagrams: DiagramListItem[] = rows.map((r) => {
      let repo: string | undefined;
      let components = 0;
      let annotations = 0;
      try {
        const d = JSON.parse(r.data) as Diagram;
        repo = d.graph?.repo.name;
        components = d.graph?.components.length ?? 0;
        annotations = d.annotations.length;
      } catch {
        // unreadable payload — show the card with zero counts
      }
      return { id: r.id, name: r.name, updatedAt: r.updated_at, repo, components, annotations };
    });
    return { diagrams };
  });

  // Access by id is capability-style (ids are uuids): anyone with the link can
  // open and edit — that's what makes shared collaboration links work.
  app.get<{ Params: { id: string } }>('/api/diagrams/:id', async (req, reply) => {
    const diagram = db.getDiagram(req.params.id);
    if (!diagram) return reply.code(404).send({ error: 'no such diagram' });
    return { diagram };
  });

  app.put<{ Params: { id: string }; Body: SaveDiagramRequest }>('/api/diagrams/:id', async (req, reply) => {
    const body = req.body?.diagram;
    if (!body || body.id !== req.params.id) {
      return reply.code(400).send({ error: 'diagram.id must match the URL id' });
    }
    const diagram: Diagram = { ...body, updatedAt: new Date().toISOString() };
    // first save claims ownership; later saves keep the original owner
    const owner = db.getDiagramOwner(diagram.id) ?? (req as Authed).user.id;
    db.saveDiagram(diagram, owner);
    return { diagram };
  });

  app.delete<{ Params: { id: string } }>('/api/diagrams/:id', async (req, reply) => {
    const owner = db.getDiagramOwner(req.params.id);
    if (!owner) return reply.code(404).send({ error: 'no such diagram' });
    if (owner !== (req as Authed).user.id) {
      return reply.code(403).send({ error: 'only the owner can delete a diagram' });
    }
    db.deleteDiagram(req.params.id);
    return { ok: true };
  });
}
