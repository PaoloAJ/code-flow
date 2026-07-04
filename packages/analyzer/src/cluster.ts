import fs from 'node:fs';
import path from 'node:path';
import type {
  ComponentNodeData,
  EdgeDetail,
  EdgeKind,
  FileRole,
  GraphEdge,
  Language,
  OutboundCall,
} from '@codeviz/shared';
import type { FileFacts, InfraFacts, RepoFile } from './types.js';
import { ImportResolver, type ResolvedTarget } from './resolve.js';
import { resolveHandlerFile } from './infra.js';

const posix = path.posix;

/** Units bigger than this get split by top-level directory. */
const SPLIT_THRESHOLD = 40;
const MAX_EXTERNAL_NODES = 8;
const FRONTEND_DEPS = ['react', 'vue', 'svelte', '@angular/core', 'next', 'preact', 'solid-js'];

export interface ClusterResult {
  components: ComponentNodeData[];
  edges: GraphEdge[];
  /** file relPath → component id */
  fileToComponent: Map<string, string>;
}

function slug(s: string): string {
  return (s === '' ? 'root' : s).replace(/[^\w./-]/g, '_').replace(/[/.]/g, '-');
}

/** Map a raw db call-site target to a technology bucket. */
function dbTech(target: string): string {
  const t = target.toLowerCase();
  if (/dynamo/.test(t)) return 'DynamoDB';
  if (/mongo/.test(t)) return 'MongoDB';
  if (/redis/.test(t)) return 'Redis';
  if (/prisma|pool|sequelize|datasource|knex|drizzle|sql\.open|gorm|jdbc|entitymanager|create_engine|psycopg|sqlite|createconnection|drivermanager/.test(t)) {
    return 'SQL database';
  }
  return 'Database';
}

function externalHost(target: string): string | null {
  try {
    const url = new URL(target);
    if (/^(localhost|127\.|0\.0\.0\.0|::1)/.test(url.hostname)) return null;
    return url.hostname;
  } catch {
    return null;
  }
}

/** Convert a route path with params (:id, {id}, <id>) into a matcher regex. */
function routeMatcher(routePath: string): RegExp | null {
  if (!routePath.startsWith('/')) return null;
  const escaped = routePath
    .replace(/[.*+?^${}()|[\]\\]/g, (ch) => (ch === '{' || ch === '}' ? ch : `\\${ch}`))
    .replace(/:(\w+)/g, '[^/]+')
    .replace(/\{\w+\}/g, '[^/]+')
    .replace(/<\w+(:\w+)?>/g, '[^/]+');
  try {
    return new RegExp(`^${escaped}/?$`);
  } catch {
    return null;
  }
}

export function cluster(
  repoName: string,
  facts: FileFacts[],
  configs: RepoFile[],
  infra: InfraFacts,
  resolver: ImportResolver,
  resolvedImports: { from: FileFacts; target: ResolvedTarget; line: number }[],
): ClusterResult {
  // ── 1. group files into components ────────────────────────────────────────
  const groupOfFile = new Map<string, string>(); // relPath → group key (a dir)
  const filesByGroup = new Map<string, FileFacts[]>();

  const unitFiles = new Map<string, FileFacts[]>();
  for (const f of facts) {
    const unit = resolver.nearestUnit(f.file.relPath);
    (unitFiles.get(unit) ?? unitFiles.set(unit, []).get(unit)!).push(f);
  }

  const assign = (key: string, f: FileFacts) => {
    groupOfFile.set(f.file.relPath, key);
    (filesByGroup.get(key) ?? filesByGroup.set(key, []).get(key)!).push(f);
  };

  for (const [unit, files] of unitFiles) {
    if (files.length <= SPLIT_THRESHOLD) {
      for (const f of files) assign(unit, f);
      continue;
    }
    // Split a big unit by its top-level directories. If almost everything
    // lives under one wrapper dir (src/, lib/, app/), descend into it first.
    let base = unit;
    for (let hop = 0; hop < 2; hop++) {
      const counts = new Map<string, number>();
      for (const f of files) {
        const rest = base === '' ? f.file.relPath : f.file.relPath.slice(base.length + 1);
        const seg = rest.includes('/') ? rest.split('/')[0] : '.';
        counts.set(seg, (counts.get(seg) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top && top[0] !== '.' && top[1] / files.length > 0.8) {
        base = base === '' ? top[0] : `${base}/${top[0]}`;
      } else break;
    }
    for (const f of files) {
      if (base !== unit && !(f.file.relPath === base || f.file.relPath.startsWith(base + '/'))) {
        assign(unit, f); // outside the wrapper dir → unit root group
        continue;
      }
      const rest = base === '' ? f.file.relPath : f.file.relPath.slice(base.length + 1);
      const seg = rest.includes('/') ? rest.split('/')[0] : '.';
      assign(seg === '.' ? base || unit : base === '' ? seg : `${base}/${seg}`, f);
    }
  }

  // Merge tiny groups (1 file) into their parent unit group when one exists.
  for (const [key, files] of [...filesByGroup.entries()]) {
    if (files.length > 1) continue;
    const unit = resolver.nearestUnit(key);
    if (unit !== key && filesByGroup.has(unit)) {
      filesByGroup.delete(key);
      for (const f of files) assign(unit, f);
    }
  }

  // ── 2. carve out lambda components from infra configs ────────────────────
  const fileSet = new Set(facts.map((f) => f.file.relPath));
  const lambdaComponents = new Map<string, { name: string; file: string | null }>();
  for (const fn of infra.functions) {
    const handlerFile = resolveHandlerFile(fn.handler, fileSet);
    const id = `lambda-${slug(fn.name)}`;
    lambdaComponents.set(id, { name: fn.name, file: handlerFile });
    if (handlerFile) {
      const oldKey = groupOfFile.get(handlerFile);
      if (oldKey !== undefined) {
        const group = filesByGroup.get(oldKey)!;
        const idx = group.findIndex((f) => f.file.relPath === handlerFile);
        if (idx >= 0 && group.length > 1) {
          const [f] = group.splice(idx, 1);
          groupOfFile.set(handlerFile, `__lambda__${id}`);
          filesByGroup.set(`__lambda__${id}`, [f]);
        } else if (idx >= 0) {
          groupOfFile.set(handlerFile, `__lambda__${id}`);
          filesByGroup.set(`__lambda__${id}`, group);
          filesByGroup.delete(oldKey);
        }
      }
    }
  }

  // ── 3. build components ───────────────────────────────────────────────────
  const components = new Map<string, ComponentNodeData>();
  const componentOfGroup = new Map<string, string>();

  const pkgMeta = new Map<string, { name?: string; deps: string[] }>(); // unit dir → package.json meta
  const goModName = new Map<string, string>();
  for (const cfg of configs) {
    const base = posix.basename(cfg.relPath);
    const dir = posix.dirname(cfg.relPath) === '.' ? '' : posix.dirname(cfg.relPath);
    try {
      if (base === 'package.json') {
        const pkg = JSON.parse(fs.readFileSync(cfg.absPath, 'utf8'));
        pkgMeta.set(dir, {
          name: typeof pkg.name === 'string' ? pkg.name : undefined,
          deps: [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})],
        });
      } else if (base === 'go.mod') {
        const m = /^module\s+(\S+)/m.exec(fs.readFileSync(cfg.absPath, 'utf8'));
        if (m) goModName.set(dir, m[1].split('/').pop()!);
      }
    } catch {
      /* ignore unreadable configs */
    }
  }

  const composeByContext = new Map<string, string>(); // build context dir → service name
  for (const svc of infra.composeServices) {
    if (svc.buildContext !== undefined) composeByContext.set(svc.buildContext, svc.name);
  }

  const isNoise = (f: FileFacts) => f.role === 'test' || f.role === 'config';

  for (const [key, files] of filesByGroup) {
    const isLambda = key.startsWith('__lambda__');
    const lambdaId = isLambda ? key.slice('__lambda__'.length) : null;
    const id = lambdaId ?? slug(key);
    componentOfGroup.set(key, id);

    const languages = [...new Set(files.map((f) => f.file.language))] as Language[];
    // Routes/calls from test fixtures & config files are noise, not architecture.
    const signalFiles = files.filter((f) => !isNoise(f));
    const routes = signalFiles.flatMap((f) => f.routes);
    const outboundCalls = signalFiles.flatMap((f) => f.outboundCalls);
    const loc = files.reduce((acc, f) => acc + f.loc, 0);
    const dirPath = isLambda ? posix.dirname(files[0]?.file.relPath ?? '') : key;

    const roleCounts: Partial<Record<FileRole, number>> = {};
    for (const f of files) roleCounts[f.role] = (roleCounts[f.role] ?? 0) + 1;

    // Semantic naming: compose service > package.json name > go module > dir name.
    const unit = resolver.nearestUnit(files[0]?.file.relPath ?? key);
    const isWholeUnit = key === unit;
    let name: string;
    if (isLambda) {
      name = lambdaComponents.get(lambdaId!)?.name ?? lambdaId!;
    } else if (composeByContext.has(key)) {
      name = composeByContext.get(key)!;
    } else if (isWholeUnit && pkgMeta.get(unit)?.name) {
      name = pkgMeta.get(unit)!.name!;
    } else if (isWholeUnit && goModName.get(unit)) {
      name = goModName.get(unit)!;
    } else {
      name = key === '' ? repoName : posix.basename(key);
    }

    let type: ComponentNodeData['type'] = 'unknown';
    if (isLambda) {
      type = 'lambda';
    } else {
      const deps = pkgMeta.get(unit)?.deps ?? [];
      const tsxShare =
        files.filter((f) => /\.(tsx|jsx)$/.test(f.file.relPath)).length / Math.max(files.length, 1);
      const hasEntrypoint = files.some((f) => f.role === 'entrypoint');
      if (FRONTEND_DEPS.some((d) => deps.includes(d)) || tsxShare > 0.3) type = 'frontend';
      else if (routes.length > 0 || composeByContext.has(key)) type = 'service';
      else if (hasEntrypoint) type = 'service';
    }

    components.set(id, {
      id,
      name,
      path: dirPath === '' ? '.' : dirPath,
      type,
      languages,
      files: files.map((f) => f.file.relPath).sort(),
      routes,
      outboundCalls,
      metrics: { loc, fileCount: files.length, fanIn: 0, fanOut: 0 },
      bottlenecks: [],
      roleCounts,
    });
  }

  // Placeholder nodes for lambda functions whose handler we couldn't resolve.
  for (const [id, fn] of lambdaComponents) {
    if (!components.has(id)) {
      components.set(id, {
        id,
        name: fn.name,
        path: '(defined in infra config)',
        type: 'lambda',
        languages: [],
        files: [],
        routes: [],
        outboundCalls: [],
        metrics: { loc: 0, fileCount: 0, fanIn: 0, fanOut: 0 },
        bottlenecks: [],
      });
    }
  }

  const fileToComponent = new Map<string, string>();
  for (const [file, group] of groupOfFile) {
    fileToComponent.set(file, componentOfGroup.get(group)!);
  }

  // ── 4. edges ──────────────────────────────────────────────────────────────
  const dirToComponent = (dir: string): string | null => {
    let best: string | null = null;
    let bestLen = -1;
    for (const c of components.values()) {
      const p = c.path === '.' ? '' : c.path;
      if ((p === '' || dir === p || dir.startsWith(p + '/')) && p.length > bestLen) {
        best = c.id;
        bestLen = p.length;
      }
    }
    return best;
  };

  const edgeMap = new Map<string, GraphEdge>();
  const addEdge = (source: string, target: string, kind: EdgeKind, detail: EdgeDetail) => {
    if (source === target) return;
    const key = `${source}→${target}:${kind}`;
    let edge = edgeMap.get(key);
    if (!edge) {
      edge = { id: key, source, target, kind, count: 0, details: [] };
      edgeMap.set(key, edge);
    }
    edge.count++;
    if (edge.details.length < 5) edge.details.push(detail);
  };

  for (const { from, target, line } of resolvedImports) {
    if (!target || isNoise(from)) continue; // test-file imports aren't architecture
    const sourceComp = fileToComponent.get(from.file.relPath);
    if (!sourceComp) continue;
    let targetComp: string | null = null;
    if ('file' in target) targetComp = fileToComponent.get(target.file) ?? null;
    else targetComp = dirToComponent(target.dir);
    if (!targetComp) continue;
    addEdge(sourceComp, targetComp, 'import', { file: from.file.relPath, line });
  }

  // invoke edges: outbound lambda calls whose target matches an infra function name
  const lambdaByName = new Map<string, string>();
  for (const [id, fn] of lambdaComponents) lambdaByName.set(fn.name.toLowerCase(), id);
  for (const comp of components.values()) {
    for (const call of comp.outboundCalls) {
      if (call.kind !== 'lambda') continue;
      const targetId = lambdaByName.get(call.target.toLowerCase());
      if (targetId && targetId !== comp.id) {
        addEdge(comp.id, targetId, 'invoke', { file: call.file, line: call.line, note: call.target });
      }
    }
  }

  // ── 5. cross-service HTTP matching ────────────────────────────────────────
  // A relative-path HTTP call ("/api/orders") that matches exactly one other
  // component's route table becomes a service-to-service edge.
  const routeTables = [...components.values()]
    .filter((c) => c.routes.length > 0)
    .map((c) => ({
      id: c.id,
      matchers: c.routes
        .map((r) => routeMatcher(r.path))
        .filter((m): m is RegExp => m !== null),
    }));

  for (const comp of components.values()) {
    for (const call of comp.outboundCalls) {
      if (call.kind !== 'http' || !call.target.startsWith('/')) continue;
      const callPath = call.target.split('?')[0];
      const hits = routeTables.filter(
        (t) => t.id !== comp.id && t.matchers.some((m) => m.test(callPath)),
      );
      if (hits.length === 1) {
        addEdge(comp.id, hits[0].id, 'http', { file: call.file, line: call.line, note: call.target });
      }
    }
  }

  // ── 6. synthesized infrastructure nodes: databases & external APIs ───────
  const ensureSynth = (
    id: string,
    name: string,
    type: ComponentNodeData['type'],
    kindDetail: string,
  ) => {
    if (!components.has(id)) {
      components.set(id, {
        id,
        name,
        path: type === 'database' ? '(shared data store)' : '(external dependency)',
        type,
        languages: [],
        files: [],
        routes: [],
        outboundCalls: [],
        metrics: { loc: 0, fileCount: 0, fanIn: 0, fanOut: 0 },
        bottlenecks: [],
        kindDetail,
      });
    }
    return components.get(id)!;
  };

  for (const comp of [...components.values()]) {
    if (comp.type === 'database' || comp.type === 'external') continue;
    const byTech = new Map<string, OutboundCall[]>();
    for (const call of comp.outboundCalls) {
      if (call.kind !== 'db') continue;
      const tech = dbTech(call.target);
      (byTech.get(tech) ?? byTech.set(tech, []).get(tech)!).push(call);
    }
    for (const [tech, calls] of byTech) {
      const dbId = `db-${slug(tech.toLowerCase())}`;
      ensureSynth(dbId, tech, 'database', tech);
      for (const call of calls.slice(0, 5)) {
        addEdge(comp.id, dbId, 'db', { file: call.file, line: call.line, note: call.target });
      }
      const edge = edgeMap.get(`${comp.id}→${dbId}:db`);
      if (edge) edge.count = calls.length;
    }
  }

  const hostRefs = new Map<string, { comp: string; call: OutboundCall }[]>();
  for (const comp of components.values()) {
    if (comp.type === 'database' || comp.type === 'external') continue;
    for (const call of comp.outboundCalls) {
      if (call.kind !== 'http') continue;
      const host = externalHost(call.target);
      if (!host) continue;
      (hostRefs.get(host) ?? hostRefs.set(host, []).get(host)!).push({ comp: comp.id, call });
    }
  }
  const topHosts = [...hostRefs.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_EXTERNAL_NODES);
  for (const [host, refs] of topHosts) {
    const extId = `ext-${slug(host)}`;
    ensureSynth(extId, host, 'external', host);
    for (const { comp, call } of refs) {
      addEdge(comp, extId, 'http', { file: call.file, line: call.line, note: call.target });
    }
  }

  // ── 7. fan-in / fan-out ───────────────────────────────────────────────────
  const fanOut = new Map<string, Set<string>>();
  const fanIn = new Map<string, Set<string>>();
  for (const e of edgeMap.values()) {
    (fanOut.get(e.source) ?? fanOut.set(e.source, new Set()).get(e.source)!).add(e.target);
    (fanIn.get(e.target) ?? fanIn.set(e.target, new Set()).get(e.target)!).add(e.source);
  }
  for (const c of components.values()) {
    c.metrics.fanOut = fanOut.get(c.id)?.size ?? 0;
    c.metrics.fanIn = fanIn.get(c.id)?.size ?? 0;
    if (c.type === 'unknown' && c.metrics.fanIn > 0 && c.routes.length === 0) c.type = 'library';
  }

  return {
    components: [...components.values()].sort((a, b) => b.metrics.loc - a.metrics.loc),
    edges: [...edgeMap.values()],
    fileToComponent,
  };
}
