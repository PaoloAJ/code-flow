import type { FastifyInstance } from 'fastify';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Diagram, SaveDiagramRequest } from '@codeviz/shared';
import { config } from '../config.js';

const diagramsDir = () => path.join(config.dataDir, 'diagrams');

function diagramPath(id: string): string {
  // ids are uuids generated client-side; keep the filesystem safe regardless
  if (!/^[\w-]+$/.test(id)) throw new Error('invalid diagram id');
  return path.join(diagramsDir(), `${id}.json`);
}

export async function diagramRoutes(app: FastifyInstance) {
  app.get('/api/diagrams', async () => {
    await fs.mkdir(diagramsDir(), { recursive: true });
    const files = await fs.readdir(diagramsDir());
    const diagrams: Pick<Diagram, 'id' | 'name' | 'analysisId' | 'updatedAt'>[] = [];
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        const d = JSON.parse(await fs.readFile(path.join(diagramsDir(), f), 'utf8')) as Diagram;
        diagrams.push({ id: d.id, name: d.name, analysisId: d.analysisId, updatedAt: d.updatedAt });
      } catch {
        // skip unreadable files
      }
    }
    diagrams.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { diagrams };
  });

  app.get<{ Params: { id: string } }>('/api/diagrams/:id', async (req, reply) => {
    try {
      const raw = await fs.readFile(diagramPath(req.params.id), 'utf8');
      return { diagram: JSON.parse(raw) as Diagram };
    } catch {
      return reply.code(404).send({ error: 'no such diagram' });
    }
  });

  app.put<{ Params: { id: string }; Body: SaveDiagramRequest }>(
    '/api/diagrams/:id',
    async (req, reply) => {
      const body = req.body?.diagram;
      if (!body || body.id !== req.params.id) {
        return reply.code(400).send({ error: 'diagram.id must match the URL id' });
      }
      const diagram: Diagram = { ...body, updatedAt: new Date().toISOString() };
      await fs.mkdir(diagramsDir(), { recursive: true });
      await fs.writeFile(diagramPath(diagram.id), JSON.stringify(diagram, null, 2));
      return { diagram };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/diagrams/:id', async (req, reply) => {
    try {
      await fs.unlink(diagramPath(req.params.id));
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: 'no such diagram' });
    }
  });
}
