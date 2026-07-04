import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import type { ServerConfigResponse } from '@codeviz/shared';
import { config } from './config.js';
import { analysisRoutes } from './routes/analyses.js';
import { diagramRoutes } from './routes/diagrams.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

app.get('/api/config', async (): Promise<ServerConfigResponse> => ({
  allowLocalPaths: config.allowLocalPaths,
  enrichmentAvailable: Boolean(config.anthropicApiKey),
}));

await app.register(analysisRoutes);
await app.register(diagramRoutes);

// Serve the built web app when present (production / Docker).
if (config.staticDir && fs.existsSync(config.staticDir)) {
  await app.register(fastifyStatic, { root: config.staticDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
