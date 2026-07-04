import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import type { Language } from '@codeviz/shared';
import type { ImportRef } from '../types.js';
import { extractImportsRegex } from './regex.js';

const require = createRequire(import.meta.url);

// web-tree-sitter has a default export class with a static Language namespace.
// Types are loose here on purpose: we only touch a small, stable surface
// (type / text / children / fields), which survives minor version changes.
type TSNode = {
  type: string;
  text: string;
  namedChildren: TSNode[];
  childForFieldName(name: string): TSNode | null;
  startPosition: { row: number };
};

let ParserCtor: any;
const languageCache = new Map<string, any>();
let initFailed = false;

const WASM_NAME: Partial<Record<Language, string>> = {
  javascript: 'tree-sitter-javascript',
  typescript: 'tree-sitter-typescript',
  python: 'tree-sitter-python',
  java: 'tree-sitter-java',
  kotlin: 'tree-sitter-kotlin',
  go: 'tree-sitter-go',
};

async function loadLanguage(language: Language, relPath?: string): Promise<any | null> {
  if (initFailed) return null;
  let wasmBase = WASM_NAME[language];
  // The plain TypeScript grammar can't parse JSX — .tsx needs its own grammar.
  if (language === 'typescript' && relPath?.endsWith('.tsx')) wasmBase = 'tree-sitter-tsx';
  if (!wasmBase) return null;
  if (languageCache.has(wasmBase)) return languageCache.get(wasmBase);
  try {
    if (!ParserCtor) {
      const mod = await import('web-tree-sitter');
      ParserCtor = (mod as any).Parser ?? (mod as any).default;
      await ParserCtor.init();
    }
    const pkgDir = path.dirname(require.resolve('tree-sitter-wasms/package.json'));
    const wasmPath = path.join(pkgDir, 'out', `${wasmBase}.wasm`);
    if (!fs.existsSync(wasmPath)) {
      languageCache.set(wasmBase, null);
      return null;
    }
    const LanguageNs = ParserCtor.Language ?? (await import('web-tree-sitter') as any).Language;
    const lang = await LanguageNs.load(wasmPath);
    languageCache.set(wasmBase, lang);
    return lang;
  } catch {
    initFailed = true;
    return null;
  }
}

function stripQuotes(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '');
}

function collectImports(root: TSNode, language: Language): ImportRef[] {
  const out: ImportRef[] = [];
  const push = (specifier: string, node: TSNode) =>
    out.push({ specifier, line: node.startPosition.row + 1 });

  const visit = (node: TSNode) => {
    switch (language) {
      case 'javascript':
      case 'typescript': {
        if (node.type === 'import_statement' || node.type === 'export_statement') {
          const src = node.childForFieldName('source');
          if (src) push(stripQuotes(src.text), node);
        } else if (node.type === 'call_expression') {
          const fn = node.childForFieldName('function');
          const args = node.childForFieldName('arguments');
          if (
            fn &&
            (fn.text === 'require' || fn.type === 'import') &&
            args?.namedChildren[0]?.type === 'string'
          ) {
            push(stripQuotes(args.namedChildren[0].text), node);
          }
        }
        break;
      }
      case 'python': {
        if (node.type === 'import_statement') {
          for (const child of node.namedChildren) {
            if (child.type === 'dotted_name') push(child.text, node);
            else if (child.type === 'aliased_import') {
              const name = child.namedChildren.find((c) => c.type === 'dotted_name');
              if (name) push(name.text, node);
            }
          }
        } else if (node.type === 'import_from_statement') {
          const mod = node.childForFieldName('module_name');
          if (mod) push(mod.text, node);
        }
        break;
      }
      case 'go': {
        if (node.type === 'import_spec') {
          const p = node.childForFieldName('path');
          if (p) push(stripQuotes(p.text), node);
        }
        break;
      }
      case 'java': {
        if (node.type === 'import_declaration') {
          const spec = node.text
            .replace(/^import\s+(static\s+)?/, '')
            .replace(/;\s*$/, '')
            .trim();
          if (spec) push(spec, node);
        }
        break;
      }
      case 'kotlin': {
        if (node.type === 'import_header') {
          const spec = node.text.replace(/^import\s+/, '').split(/\s+as\s+/)[0].trim();
          if (spec) push(spec, node);
        }
        break;
      }
    }
    for (const child of node.namedChildren) visit(child);
  };

  visit(root);
  return out;
}

/** Extract import specifiers, preferring tree-sitter and falling back to regex. */
export async function extractImports(
  language: Language,
  text: string,
  relPath?: string,
): Promise<ImportRef[]> {
  const lang = await loadLanguage(language, relPath);
  if (!lang) return extractImportsRegex(language, text);
  try {
    const parser = new ParserCtor();
    parser.setLanguage(lang);
    const tree = parser.parse(text);
    const refs = collectImports(tree.rootNode as TSNode, language);
    tree.delete?.();
    parser.delete?.();
    return refs;
  } catch {
    return extractImportsRegex(language, text);
  }
}
