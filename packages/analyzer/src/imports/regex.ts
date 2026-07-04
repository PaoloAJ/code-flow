import type { Language } from '@codeviz/shared';
import type { ImportRef } from '../types.js';

/**
 * Regex-based import extraction. Used as a fallback when the tree-sitter
 * grammar for a language is unavailable or fails to parse a file.
 */
export function extractImportsRegex(language: Language, text: string): ImportRef[] {
  const lines = text.split('\n');
  const out: ImportRef[] = [];
  const push = (specifier: string, i: number) => out.push({ specifier, line: i + 1 });

  if (language === 'javascript' || language === 'typescript') {
    const importFrom = /(?:^|\s)(?:import|export)\s+(?:[\w${}\s,*]+?\s+from\s+)?['"]([^'"]+)['"]/;
    const requireOrDynamic = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    lines.forEach((line, i) => {
      const m = importFrom.exec(line);
      if (m) push(m[1], i);
      for (const r of line.matchAll(requireOrDynamic)) push(r[1], i);
    });
  } else if (language === 'python') {
    lines.forEach((line, i) => {
      const from = /^\s*from\s+(\.*[\w.]*)\s+import\s+/.exec(line);
      if (from) {
        push(from[1], i);
        return;
      }
      const imp = /^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/.exec(line);
      if (imp) for (const spec of imp[1].split(',')) push(spec.trim().split(/\s+as\s+/)[0], i);
    });
  } else if (language === 'go') {
    let inBlock = false;
    lines.forEach((line, i) => {
      if (/^\s*import\s*\(/.test(line)) {
        inBlock = true;
        return;
      }
      if (inBlock && /^\s*\)/.test(line)) {
        inBlock = false;
        return;
      }
      const single = /^\s*import\s+(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
      if (single) {
        push(single[1], i);
        return;
      }
      if (inBlock) {
        const m = /^\s*(?:[\w.]+\s+)?"([^"]+)"/.exec(line);
        if (m) push(m[1], i);
      }
    });
  } else if (language === 'java' || language === 'kotlin') {
    lines.forEach((line, i) => {
      const m = /^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)/.exec(line);
      if (m) push(m[1], i);
    });
  }
  return out;
}
