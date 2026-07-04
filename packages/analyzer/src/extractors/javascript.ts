import type { OutboundCall, RouteDef } from '@codeviz/shared';
import type { LoopCallHit } from './loops.js';
import { callsInLoopsBraces, stripLineComment } from './loops.js';

const ROUTE_METHOD =
  /\b(?:app|router|server|api|fastify)\s*\.\s*(get|post|put|delete|patch|options|head|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;

const NEST_DECORATOR = /@(Get|Post|Put|Delete|Patch|Head|Options|All)\s*\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g;

const FETCH_CALL = /\bfetch\s*\(\s*['"`](https?:\/\/[^'"`]+|\/[^'"`]*)['"`]/g;
const AXIOS_CALL = /\baxios\s*(?:\.\s*(?:get|post|put|delete|patch|head|options|request))?\s*\(\s*['"`]([^'"`]+)['"`]/g;
const HTTP_MODULE = /\b(?:https?)\.(?:get|request)\s*\(\s*['"`]([^'"`]+)['"`]/g;

// AWS SDK v3 clients / v2 services → outbound kind
const AWS_V3 = /\bnew\s+(LambdaClient|S3Client|DynamoDBClient|DynamoDBDocumentClient|SQSClient|SNSClient|EventBridgeClient|KinesisClient)\b/g;
const AWS_V2 = /\bnew\s+AWS\.(Lambda|S3|DynamoDB(?:\.DocumentClient)?|SQS|SNS|EventBridge|Kinesis)\b/g;
const LAMBDA_INVOKE = /\bnew\s+InvokeCommand\s*\(|\.invoke\s*\(\s*\{?\s*FunctionName/g;
const LAMBDA_FN_NAME = /FunctionName\s*:\s*['"`]([^'"`]+)['"`]/;

const DB_CLIENT =
  /\bnew\s+(PrismaClient|Pool|Client|Sequelize|DataSource)\b|\bknex\s*\(|\bmongoose\.connect\s*\(|\bcreateConnection\s*\(|\bdrizzle\s*\(/g;

const CALL_IN_LOOP =
  /\bawait\b|\bfetch\s*\(|\baxios\b|\.query\s*\(|\.send\s*\(|\.invoke\s*\(/;

const AWS_KIND: Record<string, OutboundCall['kind']> = {
  Lambda: 'lambda',
  LambdaClient: 'lambda',
  S3: 'storage',
  S3Client: 'storage',
  DynamoDB: 'db',
  'DynamoDB.DocumentClient': 'db',
  DynamoDBClient: 'db',
  DynamoDBDocumentClient: 'db',
  SQS: 'queue',
  SQSClient: 'queue',
  SNS: 'queue',
  SNSClient: 'queue',
  EventBridge: 'queue',
  EventBridgeClient: 'queue',
  Kinesis: 'queue',
  KinesisClient: 'queue',
};

export function extractJsFacts(relPath: string, text: string): {
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
    for (const m of line.matchAll(ROUTE_METHOD)) {
      routes.push({ method: m[1].toUpperCase(), path: m[2], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(NEST_DECORATOR)) {
      routes.push({ method: m[1].toUpperCase(), path: m[2] ?? '/', file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(FETCH_CALL)) {
      outboundCalls.push({ kind: 'http', target: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(AXIOS_CALL)) {
      outboundCalls.push({ kind: 'http', target: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(HTTP_MODULE)) {
      outboundCalls.push({ kind: 'http', target: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(AWS_V3)) {
      outboundCalls.push({ kind: AWS_KIND[m[1]] ?? 'other', target: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(AWS_V2)) {
      outboundCalls.push({ kind: AWS_KIND[m[1]] ?? 'other', target: `AWS.${m[1]}`, file: relPath, line: lineNo });
    }
    if (LAMBDA_INVOKE.test(line)) {
      LAMBDA_INVOKE.lastIndex = 0;
      const fn = LAMBDA_FN_NAME.exec(line) ?? LAMBDA_FN_NAME.exec(lines.slice(i, i + 4).join('\n'));
      outboundCalls.push({
        kind: 'lambda',
        target: fn?.[1] ?? 'lambda:invoke',
        file: relPath,
        line: lineNo,
      });
    }
    for (const m of line.matchAll(DB_CLIENT)) {
      outboundCalls.push({ kind: 'db', target: m[0].replace(/\s+/g, ' ').trim(), file: relPath, line: lineNo });
    }
  });

  return { routes, outboundCalls, callsInLoops: callsInLoopsBraces(text, CALL_IN_LOOP) };
}

/** Next.js file-convention routes (pages/api/* and app/**\/route.ts). */
export function nextJsFileRoute(relPath: string): RouteDef | null {
  const pagesApi = /(?:^|\/)pages\/api\/(.+)\.(?:ts|js|tsx|jsx)$/.exec(relPath);
  if (pagesApi) {
    return { method: '*', path: `/api/${pagesApi[1].replace(/\/index$/, '')}`, file: relPath, line: 1 };
  }
  const appRoute = /(?:^|\/)app\/(.*?)\/?route\.(?:ts|js)$/.exec(relPath);
  if (appRoute) {
    return { method: '*', path: `/${appRoute[1]}`, file: relPath, line: 1 };
  }
  return null;
}
