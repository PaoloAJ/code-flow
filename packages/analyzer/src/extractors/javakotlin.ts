import type { OutboundCall, RouteDef } from '@codeviz/shared';
import type { LoopCallHit } from './loops.js';
import { callsInLoopsBraces, stripLineComment } from './loops.js';

// Spring: @GetMapping("/x"), @RequestMapping(value = "/y", method = ...)
const SPRING_MAPPING =
  /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*"([^"]*)")?/g;
// JAX-RS: @Path("/x") with @GET/@POST on methods
const JAXRS_PATH = /@Path\s*\(\s*"([^"]+)"/g;
const JAXRS_METHOD = /@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g;
// Ktor routing DSL (only when file imports io.ktor)
const KTOR_ROUTE = /\b(get|post|put|delete|patch|head|options)\s*\(\s*"([^"]+)"\s*\)\s*\{/g;

const HTTP_CLIENT =
  /\brestTemplate\.\w+\s*\(\s*"([^"]+)"|\bWebClient\b|\bHttpClient\.newHttpClient\b|\bOkHttpClient\b|\.url\s*\(\s*"([^"]+)"/g;

const AWS_CLIENT =
  /\b(LambdaClient|S3Client|DynamoDbClient|SqsClient|SnsClient|AmazonS3ClientBuilder|AmazonDynamoDBClientBuilder|AmazonSQSClientBuilder|AmazonSNSClientBuilder|AWSLambdaClientBuilder)\b/g;

const DB_HINT =
  /@Entity\b|\bJdbcTemplate\b|\bEntityManager\b|\bDriverManager\.getConnection\b|\bDatabase\.connect\b/g;

const CALL_IN_LOOP = /restTemplate\.|webClient\.|\.execute\s*\(|\.query\s*\(|\.invoke\s*\(/;

const AWS_KIND: Record<string, OutboundCall['kind']> = {
  LambdaClient: 'lambda',
  AWSLambdaClientBuilder: 'lambda',
  S3Client: 'storage',
  AmazonS3ClientBuilder: 'storage',
  DynamoDbClient: 'db',
  AmazonDynamoDBClientBuilder: 'db',
  SqsClient: 'queue',
  AmazonSQSClientBuilder: 'queue',
  SnsClient: 'queue',
  AmazonSNSClientBuilder: 'queue',
};

export function extractJavaKotlinFacts(relPath: string, text: string): {
  routes: RouteDef[];
  outboundCalls: OutboundCall[];
  callsInLoops: LoopCallHit[];
} {
  const routes: RouteDef[] = [];
  const outboundCalls: OutboundCall[] = [];
  const lines = text.split('\n');
  const isKtor = text.includes('io.ktor');

  lines.forEach((rawLine, i) => {
    const line = stripLineComment(rawLine, '//');
    const lineNo = i + 1;
    for (const m of line.matchAll(SPRING_MAPPING)) {
      const method = m[1] === 'Request' ? '*' : m[1].toUpperCase();
      routes.push({ method, path: m[2] ?? '/', file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(JAXRS_PATH)) {
      routes.push({ method: '*', path: m[1], file: relPath, line: lineNo });
    }
    if (JAXRS_METHOD.test(line) && !line.includes('Mapping')) {
      JAXRS_METHOD.lastIndex = 0;
      // method-level JAX-RS annotations refine class @Path; recorded via @Path above
    }
    if (isKtor) {
      for (const m of line.matchAll(KTOR_ROUTE)) {
        routes.push({ method: m[1].toUpperCase(), path: m[2], file: relPath, line: lineNo });
      }
    }
    for (const m of line.matchAll(HTTP_CLIENT)) {
      const target = m[1] ?? m[2] ?? m[0].replace(/\s+/g, ' ').slice(0, 60);
      outboundCalls.push({ kind: 'http', target, file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(AWS_CLIENT)) {
      outboundCalls.push({ kind: AWS_KIND[m[1]] ?? 'other', target: m[1], file: relPath, line: lineNo });
    }
    for (const m of line.matchAll(DB_HINT)) {
      outboundCalls.push({ kind: 'db', target: m[0], file: relPath, line: lineNo });
    }
  });

  return { routes, outboundCalls, callsInLoops: callsInLoopsBraces(text, CALL_IN_LOOP) };
}
