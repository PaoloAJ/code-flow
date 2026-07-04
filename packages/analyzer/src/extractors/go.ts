import type { OutboundCall, RouteDef } from '@codeviz/shared';
import type { LoopCallHit } from './loops.js';
import { callsInLoopsBraces, stripLineComment } from './loops.js';

// net/http: http.HandleFunc("/x", ...), mux.HandleFunc("/x", ...)
const HANDLE_FUNC = /\b\w+\.(?:HandleFunc|Handle)\s*\(\s*"([^"]+)"/g;
// gin/echo/fiber: r.GET("/x", ...), e.POST("/y", ...)
const VERB_ROUTE = /\b\w+\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"([^"]+)"/g;
// chi: r.Get("/x", ...)
const CHI_ROUTE = /\b\w+\.(Get|Post|Put|Delete|Patch|Head|Options)\s*\(\s*"([^"]+)"/g;

const HTTP_CALL = /\bhttp\.(?:Get|Post|PostForm|Head)\s*\(\s*(?:"([^"]+)")?/g;
const NEW_REQUEST = /\bhttp\.NewRequest(?:WithContext)?\s*\(\s*(?:\w+\s*,\s*)?(?:http\.Method(\w+)|"(\w+)")\s*,\s*(?:"([^"]+)")?/g;

// AWS SDK for Go v1 (lambda.New(sess)) and v2 (lambda.NewFromConfig(cfg))
const AWS_NEW = /\b(lambda|s3|dynamodb|sqs|sns|eventbridge|kinesis)\.New(?:FromConfig)?\s*\(/g;

const DB_HINT = /\bsql\.Open\s*\(|\bgorm\.Open\s*\(|\bmongo\.Connect\s*\(|\bredis\.NewClient\s*\(/g;

const CALL_IN_LOOP = /http\.(?:Get|Post|Do)\b|\.Do\s*\(|\.Query\s*\(|\.Exec\s*\(|\.Invoke\s*\(/;

const AWS_KIND: Record<string, OutboundCall['kind']> = {
  lambda: 'lambda',
  s3: 'storage',
  dynamodb: 'db',
  sqs: 'queue',
  sns: 'queue',
  eventbridge: 'queue',
  kinesis: 'queue',
};

export function extractGoFacts(relPath: string, text: string): {
  routes: RouteDef[];
  outboundCalls: OutboundCall[];
  callsInLoops: LoopCallHit[];
} {
  const routes: RouteDef[] = [];
  const outboundCalls: OutboundCall[] = [];
  const lines = text.split('\n');

  lines.forEach((rawLine, i) => {
    const line = stripLineComment(rawLine, '//');
    const lineNo = i + 1;
    for (const m of line.matchAll(HANDLE_FUNC)) {
      routes.push({ method: '*', path: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(VERB_ROUTE)) {
      routes.push({ method: m[1], path: m[2], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(CHI_ROUTE)) {
      // Avoid double-counting the ALL-CAPS variants matched above.
      if (m[1] === m[1].toUpperCase()) continue;
      routes.push({ method: m[1].toUpperCase(), path: m[2], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(HTTP_CALL)) {
      outboundCalls.push({ kind: 'http', target: m[1] ?? 'http:call', file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(NEW_REQUEST)) {
      outboundCalls.push({
        kind: 'http',
        target: m[3] ?? `http:${(m[1] ?? m[2] ?? 'request').toUpperCase()}`,
        file: relPath,
        line: lineNo,
      });
    }
    for (const m of line.matchAll(AWS_NEW)) {
      outboundCalls.push({
        kind: AWS_KIND[m[1]] ?? 'other',
        target: `aws:${m[1]}`,
        file: relPath,
        line: lineNo,
      });
    }
    for (const m of line.matchAll(DB_HINT)) {
      outboundCalls.push({ kind: 'db', target: m[0].replace(/\s*\($/, ''), file: relPath, line: lineNo });
    }
  });

  return { routes, outboundCalls, callsInLoops: callsInLoopsBraces(text, CALL_IN_LOOP) };
}
