import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import fs from 'node:fs';
import type {
  AnalysisProgressEvent,
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  GetAnalysisResponse,
} from '@codeviz/shared';
import { jobManager } from '../jobs.js';
import { config } from '../config.js';
import { requireUser } from '../auth.js';

export async function analysisRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.post<{ Body: CreateAnalysisRequest }>('/api/analyses', async (req, reply) => {
    const { source, skipEnrichment } = req.body ?? {};
    if (!source || (source.type !== 'local' && source.type !== 'github')) {
      return reply.code(400).send({ error: 'source must be {type:"local",path} or {type:"github",url}' });
    }
    if (source.type === 'local') {
      if (!config.allowLocalPaths) {
        return reply.code(403).send({ error: 'Local paths are disabled on this deployment' });
      }
      const resolved = path.resolve(source.path);
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        return reply.code(400).send({ error: `Not a directory: ${resolved}` });
      }
      source.path = resolved;
    }
    if (source.type === 'github' && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(source.url)) {
      return reply.code(400).send({ error: 'url must look like https://github.com/owner/repo' });
    }
    const job = jobManager.create(source, skipEnrichment ?? false);
    const res: CreateAnalysisResponse = { id: job.id };
    return reply.code(201).send(res);
  });

  app.get<{ Params: { id: string } }>('/api/analyses/:id', async (req, reply) => {
    const job = jobManager.get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'no such analysis' });
    const res: GetAnalysisResponse = {
      job: jobManager.summary(job),
      graph: job.phase === 'done' ? job.graph : undefined,
    };
    return res;
  });

  // Server-Sent Events progress stream.
  app.get<{ Params: { id: string } }>('/api/analyses/:id/events', async (req, reply) => {
    const job = jobManager.get(req.params.id);
    if (!job) return reply.code(404).send({ error: 'no such analysis' });

    // Take over the raw socket for SSE — Fastify must not write its own reply.
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    const send = (ev: AnalysisProgressEvent) => {
      reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
      if (ev.phase === 'done' || ev.phase === 'error') {
        cleanup();
        reply.raw.end();
      }
    };
    // Catch the consumer up on current state immediately.
    send({ phase: job.phase, message: job.error ?? `phase: ${job.phase}` });

    const channel = `progress:${job.id}`;
    const cleanup = () => jobManager.events.off(channel, send);
    if (job.phase !== 'done' && job.phase !== 'error') {
      jobManager.events.on(channel, send);
      req.raw.on('close', cleanup);
    }
  });
}
