import { describe, expect, it } from 'vitest';
import { classifyRole } from '../src/roles.js';

const none = { routes: [], outboundCalls: [] };

describe('file role classification', () => {
  it('detects tests by path and filename', () => {
    expect(classifyRole('src/__tests__/user.ts', '', none)).toBe('test');
    expect(classifyRole('pkg/api/handler_test.go', '', none)).toBe('test');
    expect(classifyRole('app/test_views.py', '', none)).toBe('test');
    expect(classifyRole('src/user.spec.ts', '', none)).toBe('test');
  });

  it('detects entrypoints by content', () => {
    expect(classifyRole('cmd/api/main.go', 'func main() {}', none)).toBe('entrypoint');
    expect(classifyRole('run.py', 'if __name__ == "__main__":', none)).toBe('entrypoint');
    expect(classifyRole('src/server.ts', 'app.listen(3000);', none)).toBe('entrypoint');
    expect(classifyRole('src/Main.java', 'public static void main(String[] a) {}', none)).toBe('entrypoint');
  });

  it('detects layers by path convention', () => {
    expect(classifyRole('src/models/user.ts', '', none)).toBe('model');
    expect(classifyRole('src/repositories/user.ts', '', none)).toBe('data');
    expect(classifyRole('src/clients/stripe.ts', '', none)).toBe('client');
    expect(classifyRole('src/utils/format.ts', '', none)).toBe('util');
  });

  it('detects routes from extracted facts', () => {
    expect(
      classifyRole('src/whatever.ts', '', {
        routes: [{ method: 'GET', path: '/x', file: 'src/whatever.ts', line: 1 }],
        outboundCalls: [],
      }),
    ).toBe('routes');
  });

  it('infers data/client from call kinds', () => {
    expect(
      classifyRole('src/foo.ts', '', {
        routes: [],
        outboundCalls: [{ kind: 'db', target: 'Pool', file: 'src/foo.ts', line: 1 }],
      }),
    ).toBe('data');
    expect(
      classifyRole('src/bar.ts', '', {
        routes: [],
        outboundCalls: [{ kind: 'http', target: 'https://api.x.com', file: 'src/bar.ts', line: 1 }],
      }),
    ).toBe('client');
  });
});
