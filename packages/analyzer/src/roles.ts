import type { FileRole } from '@codeviz/shared';
import type { FileFacts } from './types.js';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|fixtures|testdata)\//i;
const TEST_FILE = /(\.(test|spec)\.[jt]sx?|_test\.go|_test\.py)$|(^|\/)test_[^/]*\.py$/i;

const ENTRY_CONTENT: [RegExp, RegExp][] = [
  [/\.(go)$/, /^func main\s*\(/m],
  [/\.(py)$/, /__name__\s*==\s*['"]__main__['"]/],
  [/\.[jt]sx?$/, /\.listen\s*\(|createServer\s*\(|serve\s*\(\s*\{/],
  [/\.(java|kt)$/, /public\s+static\s+void\s+main\s*\(|@SpringBootApplication|fun main\s*\(/],
];

const PATH_ROLE: [RegExp, FileRole][] = [
  [/(^|\/)(routes?|controllers?|handlers?|endpoints?|views|api)(\/|$)/i, 'routes'],
  [/(^|\/)(models?|entities|domain|schemas?|dto)(\/|$)/i, 'model'],
  [/(^|\/)(repositor(y|ies)|dao|persistence|migrations?|stores?|db|database)(\/|$)/i, 'data'],
  [/(^|\/)(clients?|integrations?|external|gateways?|sdk)(\/|$)/i, 'client'],
  [/(^|\/)(config|settings|env)(\/|$)/i, 'config'],
  [/(^|\/)(utils?|helpers?|common|shared|lib)(\/|$)/i, 'util'],
];

const NAME_ROLE: [RegExp, FileRole][] = [
  [/controller\.[\w]+$|Controller\.(java|kt)$/i, 'routes'],
  [/(repository|repo|dao)\.[\w]+$/i, 'data'],
  [/(model|entity|schema)\.[\w]+$/i, 'model'],
  [/(client|gateway)\.[\w]+$/i, 'client'],
  [/^(config|settings|constants)\.[\w]+$/i, 'config'],
];

/** Classify a file's architectural role from its path, content and extracted facts. */
export function classifyRole(relPath: string, text: string, facts: Pick<FileFacts, 'routes' | 'outboundCalls'>): FileRole {
  if (TEST_PATH.test(relPath) || TEST_FILE.test(relPath)) return 'test';

  for (const [ext, sig] of ENTRY_CONTENT) {
    if (ext.test(relPath) && sig.test(text)) return 'entrypoint';
  }

  if (facts.routes.length > 0) return 'routes';

  for (const [re, role] of PATH_ROLE) if (re.test(relPath)) return role;
  const base = relPath.split('/').pop() ?? '';
  for (const [re, role] of NAME_ROLE) if (re.test(base)) return role;

  const hasDb = facts.outboundCalls.some((o) => o.kind === 'db');
  const hasHttp = facts.outboundCalls.some((o) => o.kind === 'http');
  if (hasDb && !hasHttp) return 'data';
  if (hasHttp && !hasDb) return 'client';

  return 'service';
}
