import { describe, expect, it } from 'vitest';
import { extractJsFacts, nextJsFileRoute } from '../src/extractors/javascript.js';
import { extractPyFacts } from '../src/extractors/python.js';
import { extractJavaKotlinFacts } from '../src/extractors/javakotlin.js';
import { extractGoFacts } from '../src/extractors/go.js';

describe('javascript extractor', () => {
  it('finds express routes and outbound calls', () => {
    const src = [
      `import express from 'express';`,
      `const app = express();`,
      `app.get('/users', listUsers);`,
      `app.post('/users/:id/orders', createOrder);`,
      `const r = await fetch('https://api.stripe.com/v1/charges');`,
      `const lambda = new LambdaClient({});`,
      `await lambda.send(new InvokeCommand({ FunctionName: 'process-order' }));`,
      `const prisma = new PrismaClient();`,
    ].join('\n');
    const facts = extractJsFacts('src/app.ts', src);
    expect(facts.routes).toEqual([
      { method: 'GET', path: '/users', file: 'src/app.ts', line: 3 },
      { method: 'POST', path: '/users/:id/orders', file: 'src/app.ts', line: 4 },
    ]);
    expect(facts.outboundCalls).toContainEqual({
      kind: 'http',
      target: 'https://api.stripe.com/v1/charges',
      file: 'src/app.ts',
      line: 5,
    });
    expect(facts.outboundCalls.some((o) => o.kind === 'lambda')).toBe(true);
    expect(facts.outboundCalls.some((o) => o.kind === 'db')).toBe(true);
  });

  it('flags awaited calls inside loops', () => {
    const src = [
      `async function main(items) {`,
      `  for (const item of items) {`,
      `    await db.query('SELECT 1');`,
      `  }`,
      `}`,
    ].join('\n');
    const facts = extractJsFacts('src/loop.ts', src);
    expect(facts.callsInLoops.length).toBe(1);
    expect(facts.callsInLoops[0].line).toBe(3);
  });

  it('detects nest decorators and next.js file routes', () => {
    const facts = extractJsFacts('src/cats.controller.ts', `  @Get('cats')\n  findAll() {}`);
    expect(facts.routes[0]).toMatchObject({ method: 'GET', path: 'cats' });
    expect(nextJsFileRoute('web/pages/api/users/index.ts')?.path).toBe('/api/users');
    expect(nextJsFileRoute('app/api/orders/route.ts')?.path).toBe('/api/orders');
  });
});

describe('python extractor', () => {
  it('finds fastapi/flask routes and boto3 calls', () => {
    const src = [
      `import boto3`,
      `@app.get("/items")`,
      `def list_items(): ...`,
      `@bp.route("/legacy", methods=["POST"])`,
      `def legacy(): ...`,
      `client = boto3.client("dynamodb")`,
      `lam = boto3.client("lambda")`,
      `lam.invoke(FunctionName="resize-image")`,
      `r = requests.get("https://example.com/api")`,
    ].join('\n');
    const facts = extractPyFacts('svc/api.py', src);
    expect(facts.routes).toContainEqual({ method: 'GET', path: '/items', file: 'svc/api.py', line: 2 });
    expect(facts.routes).toContainEqual({ method: 'POST', path: '/legacy', file: 'svc/api.py', line: 4 });
    expect(facts.outboundCalls).toContainEqual({ kind: 'db', target: 'boto3:dynamodb', file: 'svc/api.py', line: 6 });
    expect(facts.outboundCalls).toContainEqual({ kind: 'lambda', target: 'resize-image', file: 'svc/api.py', line: 8 });
    expect(facts.outboundCalls).toContainEqual({ kind: 'http', target: 'https://example.com/api', file: 'svc/api.py', line: 9 });
  });

  it('flags requests inside for loops', () => {
    const src = [`for item in items:`, `    r = requests.get(url)`, `print("done")`].join('\n');
    const facts = extractPyFacts('svc/n1.py', src);
    expect(facts.callsInLoops).toEqual([{ line: 2, note: 'r = requests.get(url)' }]);
  });
});

describe('java/kotlin extractor', () => {
  it('finds spring mappings and aws clients', () => {
    const src = [
      `@RestController`,
      `public class UserController {`,
      `  @GetMapping("/users")`,
      `  public List<User> users() { return svc.all(); }`,
      `  @RequestMapping(value = "/admin")`,
      `  public String admin() { return "ok"; }`,
      `  private final DynamoDbClient dynamo = DynamoDbClient.create();`,
      `}`,
    ].join('\n');
    const facts = extractJavaKotlinFacts('src/main/java/UserController.java', src);
    expect(facts.routes).toContainEqual(expect.objectContaining({ method: 'GET', path: '/users' }));
    expect(facts.routes).toContainEqual(expect.objectContaining({ method: '*', path: '/admin' }));
    expect(facts.outboundCalls).toContainEqual(expect.objectContaining({ kind: 'db', target: 'DynamoDbClient' }));
  });

  it('finds ktor routes only in ktor files', () => {
    const ktor = [`import io.ktor.server.routing.*`, `routing {`, `  get("/ping") { call.respondText("pong") }`, `}`].join('\n');
    expect(extractJavaKotlinFacts('App.kt', ktor).routes).toContainEqual(
      expect.objectContaining({ method: 'GET', path: '/ping' }),
    );
    const notKtor = `get("/ping") { }`;
    expect(extractJavaKotlinFacts('Other.kt', notKtor).routes).toEqual([]);
  });
});

describe('go extractor', () => {
  it('finds handlers, gin routes and aws clients', () => {
    const src = [
      `package main`,
      `func main() {`,
      `  http.HandleFunc("/health", healthHandler)`,
      `  r.GET("/orders", listOrders)`,
      `  svc := lambda.NewFromConfig(cfg)`,
      `  db, _ := sql.Open("postgres", dsn)`,
      `  resp, _ := http.Get("https://api.example.com/v2")`,
      `}`,
    ].join('\n');
    const facts = extractGoFacts('cmd/api/main.go', src);
    expect(facts.routes).toContainEqual(expect.objectContaining({ method: '*', path: '/health' }));
    expect(facts.routes).toContainEqual(expect.objectContaining({ method: 'GET', path: '/orders' }));
    expect(facts.outboundCalls).toContainEqual(expect.objectContaining({ kind: 'lambda', target: 'aws:lambda' }));
    expect(facts.outboundCalls).toContainEqual(expect.objectContaining({ kind: 'db' }));
    expect(facts.outboundCalls).toContainEqual(
      expect.objectContaining({ kind: 'http', target: 'https://api.example.com/v2' }),
    );
  });
});
