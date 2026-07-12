import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import type { ServerConfigResponse } from '@codeviz/shared';
import { authProvider, config } from './config.js';
import { getDb } from './db.js';
import { authRoutes } from './auth.js';
import { collabRoutes } from './collab.js';
import { analysisRoutes } from './routes/analyses.js';
import { diagramRoutes } from './routes/diagrams.js';

const app = Fastify({ logger: true });

getDb(); // open + migrate the database up front so boot fails loudly

await app.register(cors, { origin: true, credentials: true });
await app.register(cookie);
await app.register(websocket);

app.get('/api/config', async (): Promise<ServerConfigResponse> => ({
  allowLocalPaths: config.allowLocalPaths,
  enrichmentAvailable: Boolean(config.anthropicApiKey),
  authRequired: config.authRequired,
  authProvider: authProvider(),
  clerkPublishableKey: config.clerkPublishableKey,
}));

app.get('/api/health', async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(analysisRoutes);
await app.register(diagramRoutes);
await app.register(collabRoutes);

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
