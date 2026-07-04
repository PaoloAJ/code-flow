import fs from 'node:fs';
import path from 'node:path';
import type { RepoFile } from './types.js';

const posix = path.posix;

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts'];
const UNIT_MARKERS = new Set([
  'package.json',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
]);

/** Result of resolving an import: a repo-relative file or directory, or null (external dep). */
export type ResolvedTarget = { file: string } | { dir: string } | null;

export class ImportResolver {
  private fileSet: Set<string>;
  private dirSet: Set<string>;
  /** package.json "name" → package dir */
  private jsPackages = new Map<string, string>();
  /** go.mod module path → module dir */
  private goModules = new Map<string, string>();
  /** java/kotlin fully-qualified class → file, and package → dir */
  private javaClasses = new Map<string, string>();
  private javaPackages = new Map<string, string>();
  /** dirs containing a build-unit marker, longest first */
  readonly unitDirs: string[];

  constructor(sources: RepoFile[], configs: RepoFile[]) {
    this.fileSet = new Set(sources.map((f) => f.relPath));
    this.dirSet = new Set<string>();
    for (const f of sources) {
      let d = posix.dirname(f.relPath);
      while (d && d !== '.') {
        this.dirSet.add(d);
        d = posix.dirname(d);
      }
    }

    const units = new Set<string>(['']);
    for (const cfg of configs) {
      const base = posix.basename(cfg.relPath);
      const dir = posix.dirname(cfg.relPath);
      if (UNIT_MARKERS.has(base)) units.add(dir === '.' ? '' : dir);
      try {
        if (base === 'package.json') {
          const pkg = JSON.parse(fs.readFileSync(cfg.absPath, 'utf8'));
          if (typeof pkg.name === 'string') {
            this.jsPackages.set(pkg.name, dir === '.' ? '' : dir);
          }
        } else if (base === 'go.mod') {
          const m = /^module\s+(\S+)/m.exec(fs.readFileSync(cfg.absPath, 'utf8'));
          if (m) this.goModules.set(m[1], dir === '.' ? '' : dir);
        }
      } catch {
        // unreadable config — ignore
      }
    }
    this.unitDirs = [...units].sort((a, b) => b.length - a.length);
  }

  /** Register a java/kotlin package declaration found while parsing. */
  registerJavaPackage(pkg: string, relPath: string) {
    const cls = posix.basename(relPath).replace(/\.(java|kt|kts)$/, '');
    this.javaClasses.set(`${pkg}.${cls}`, relPath);
    if (!this.javaPackages.has(pkg)) this.javaPackages.set(pkg, posix.dirname(relPath));
  }

  nearestUnit(relPath: string): string {
    for (const u of this.unitDirs) {
      if (u === '' || relPath === u || relPath.startsWith(u + '/')) return u;
    }
    return '';
  }

  resolve(file: RepoFile, spec: string): ResolvedTarget {
    switch (file.language) {
      case 'javascript':
      case 'typescript':
        return this.resolveJs(file.relPath, spec);
      case 'python':
        return this.resolvePy(file.relPath, spec);
      case 'go':
        return this.resolveGo(spec);
      case 'java':
      case 'kotlin':
        return this.resolveJava(spec);
      default:
        return null;
    }
  }

  private tryFile(base: string): ResolvedTarget {
    if (this.fileSet.has(base)) return { file: base };
    for (const ext of JS_EXTS) {
      if (this.fileSet.has(base + ext)) return { file: base + ext };
    }
    for (const ext of JS_EXTS) {
      const idx = posix.join(base, 'index' + ext);
      if (this.fileSet.has(idx)) return { file: idx };
    }
    if (this.dirSet.has(base)) return { dir: base };
    return null;
  }

  private resolveJs(fromRel: string, spec: string): ResolvedTarget {
    if (spec.startsWith('.')) {
      const base = posix.normalize(posix.join(posix.dirname(fromRel), spec));
      return this.tryFile(base);
    }
    // "@/foo" convention → <unit>/src/foo or <unit>/foo
    if (spec.startsWith('@/') || spec.startsWith('~/')) {
      const unit = this.nearestUnit(fromRel);
      const rest = spec.slice(2);
      return (
        this.tryFile(posix.join(unit, 'src', rest)) ?? this.tryFile(posix.join(unit, rest))
      );
    }
    // workspace package (possibly with a subpath)
    const parts = spec.split('/');
    const candidates = spec.startsWith('@') ? [parts.slice(0, 2).join('/')] : [parts[0]];
    for (const pkgName of candidates) {
      const dir = this.jsPackages.get(pkgName);
      if (dir === undefined) continue;
      const sub = spec.slice(pkgName.length).replace(/^\//, '');
      if (sub) return this.tryFile(posix.join(dir, sub)) ?? { dir };
      return (
        this.tryFile(posix.join(dir, 'src', 'index')) ??
        this.tryFile(posix.join(dir, 'index')) ?? { dir }
      );
    }
    return null;
  }

  private resolvePy(fromRel: string, spec: string): ResolvedTarget {
    const tryModule = (root: string, dotted: string): ResolvedTarget => {
      if (!dotted) return this.dirSet.has(root) ? { dir: root } : null;
      const rel = posix.join(root, ...dotted.split('.'));
      if (this.fileSet.has(rel + '.py')) return { file: rel + '.py' };
      if (this.fileSet.has(posix.join(rel, '__init__.py'))) {
        return { file: posix.join(rel, '__init__.py') };
      }
      if (this.dirSet.has(rel)) return { dir: rel };
      return null;
    };

    const dots = /^(\.+)(.*)$/.exec(spec);
    if (dots) {
      let base = posix.dirname(fromRel);
      for (let i = 1; i < dots[1].length; i++) base = posix.dirname(base);
      if (base === '.') base = '';
      return tryModule(base, dots[2]);
    }
    const roots = new Set<string>(['', this.nearestUnit(fromRel), posix.dirname(fromRel)]);
    const unit = this.nearestUnit(fromRel);
    roots.add(posix.join(unit, 'src'));
    for (const root of roots) {
      const hit = tryModule(root === '.' ? '' : root, spec);
      if (hit) return hit;
      // "from a.b import c" where c is a module: also try trimming isn't needed
      // because the specifier we extract is the module part only.
    }
    return null;
  }

  private resolveGo(spec: string): ResolvedTarget {
    for (const [mod, dir] of this.goModules) {
      if (spec === mod) return this.dirSet.has(dir) || dir === '' ? { dir } : null;
      if (spec.startsWith(mod + '/')) {
        const rel = posix.join(dir, spec.slice(mod.length + 1));
        if (this.dirSet.has(rel)) return { dir: rel };
        return null;
      }
    }
    return null;
  }

  private resolveJava(spec: string): ResolvedTarget {
    if (spec.endsWith('.*')) {
      const pkg = spec.slice(0, -2);
      const dir = this.javaPackages.get(pkg);
      return dir ? { dir } : null;
    }
    const file = this.javaClasses.get(spec);
    if (file) return { file };
    // Maybe the spec is itself a package (kotlin allows importing members)
    const asPkg = this.javaPackages.get(spec.split('.').slice(0, -1).join('.'));
    return asPkg ? { dir: asPkg } : null;
  }
}
