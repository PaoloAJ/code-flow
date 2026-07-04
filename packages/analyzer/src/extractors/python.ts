import type { OutboundCall, RouteDef } from '@codeviz/shared';
import type { LoopCallHit } from './loops.js';
import { callsInLoopsIndent, stripLineComment } from './loops.js';

// Flask/FastAPI decorators: @app.get("/x"), @router.post("/y"), @bp.route("/z", methods=[...])
const DECORATOR_ROUTE =
  /^\s*@(?:\w+)\.(get|post|put|delete|patch|head|options|route|websocket)\s*\(\s*(?:f?['"])([^'"]+)['"]/;
const ROUTE_METHODS_KWARG = /methods\s*=\s*\[([^\]]+)\]/;

// Django: path("users/", views.users), re_path(r"^api/", ...)
const DJANGO_PATH = /\b(?:re_)?path\s*\(\s*r?['"]([^'"]+)['"]/g;

const REQUESTS_CALL = /\b(?:requests|httpx)\.(get|post|put|delete|patch|head|options|request)\s*\(\s*(?:f?['"]([^'"]+)['"])?/g;
const AIOHTTP_CALL = /\bsession\.(get|post|put|delete|patch)\s*\(\s*(?:f?['"]([^'"]+)['"])?/g;
const URLLIB_CALL = /\burllib\.request\.urlopen\s*\(/g;

const BOTO3_CLIENT = /\bboto3\.(?:client|resource)\s*\(\s*['"](\w+)['"]/g;
const LAMBDA_INVOKE = /\.invoke\s*\(\s*(?:FunctionName\s*=\s*f?['"]([^'"]+)['"])?/g;

const DB_HINT =
  /\bcreate_engine\s*\(|\bpsycopg2?\.connect\s*\(|\bpymongo\b|\bMongoClient\s*\(|\bsqlite3\.connect\s*\(|(?<![\w.])(?:Strict)?Redis\s*\(|\bredis\.(?:Redis|StrictRedis)\s*\(/g;

const CALL_IN_LOOP = /\b(?:requests|httpx)\.\w+\s*\(|\.execute\s*\(|\.invoke\s*\(|await\s+/;

const BOTO3_KIND: Record<string, OutboundCall['kind']> = {
  lambda: 'lambda',
  s3: 'storage',
  dynamodb: 'db',
  sqs: 'queue',
  sns: 'queue',
  events: 'queue',
  kinesis: 'queue',
};

export function extractPyFacts(relPath: string, text: string): {
  routes: RouteDef[];
  outboundCalls: OutboundCall[];
  callsInLoops: LoopCallHit[];
} {
  const routes: RouteDef[] = [];
  const outboundCalls: OutboundCall[] = [];
  const lines = text.split('\n');
  const isUrlsFile = /(^|\/)urls\.py$/.test(relPath);

  lines.forEach((rawLine, i) => {
    const line = stripLineComment(rawLine, '#');
    const lineNo = i + 1;
    const dec = DECORATOR_ROUTE.exec(line);
    if (dec) {
      let method = dec[1].toUpperCase();
      if (method === 'ROUTE') {
        const mk = ROUTE_METHODS_KWARG.exec(line);
        method = mk ? mk[1].replace(/['"\s]/g, '') : 'GET';
      }
      if (method === 'WEBSOCKET') method = 'WS';
      routes.push({ method, path: dec[2], file: relPath, line: lineNo });
    }
    if (isUrlsFile) {
      for (const m of line.matchAll(DJANGO_PATH)) {
        routes.push({ method: '*', path: `/${m[1].replace(/^\^|\$$/g, '')}`, file: relPath, line: lineNo });
      }
    }
    for (const m of line.matchAll(REQUESTS_CALL)) {
      outboundCalls.push({ kind: 'http', target: m[2] ?? `http:${m[1]}`, file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(AIOHTTP_CALL)) {
      outboundCalls.push({ kind: 'http', target: m[2] ?? `http:${m[1]}`, file: relPath, line: lineNo });
    }
    if (URLLIB_CALL.test(line)) {
      URLLIB_CALL.lastIndex = 0;
      outboundCalls.push({ kind: 'http', target: 'urllib.urlopen', file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(BOTO3_CLIENT)) {
      outboundCalls.push({
        kind: BOTO3_KIND[m[1]] ?? 'other',
        target: `boto3:${m[1]}`,
        file: relPath,
        line: lineNo,
      });
    }
    for (const m of line.matchAll(LAMBDA_INVOKE)) {
      outboundCalls.push({ kind: 'lambda', target: m[1] ?? 'lambda:invoke', file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(DB_HINT)) {
      outboundCalls.push({ kind: 'db', target: m[0].replace(/\s*\($/, ''), file: relPath, line: lineNo });
    }
  });

  return { routes, outboundCalls, callsInLoops: callsInLoopsIndent(text, CALL_IN_LOOP) };
}
