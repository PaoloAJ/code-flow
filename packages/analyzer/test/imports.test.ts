import { describe, expect, it } from 'vitest';
import { extractImports } from '../src/imports/treesitter.js';
import { extractImportsRegex } from '../src/imports/regex.js';

const specs = (refs: { specifier: string }[]) => refs.map((r) => r.specifier).sort();

describe('import extraction (tree-sitter with regex fallback)', () => {
  it('typescript', async () => {
    const src = [
      `import fs from 'node:fs';`,
      `import { thing } from './lib/thing';`,
      `export { other } from '../other';`,
      `const dyn = await import('./dyn');`,
      `const legacy = require('legacy-pkg');`,
    ].join('\n');
    const refs = await extractImports('typescript', src, 'src/a.ts');
    expect(specs(refs)).toEqual(['../other', './dyn', './lib/thing', 'legacy-pkg', 'node:fs'].sort());
  });

  it('tsx', async () => {
    const src = `import React from 'react';\nexport const X = () => <div className="x" />;`;
    const refs = await extractImports('typescript', src, 'src/x.tsx');
    expect(specs(refs)).toContain('react');
  });

  it('python', async () => {
    const src = [`import os, sys`, `from ..core import db`, `from app.models import User`].join('\n');
    const refs = await extractImports('python', src, 'app/api/views.py');
    expect(specs(refs)).toEqual(['..core', 'app.models', 'os', 'sys'].sort());
  });

  it('go', async () => {
    const src = [
      `package main`,
      `import (`,
      `  "fmt"`,
      `  api "github.com/acme/shop/internal/api"`,
      `)`,
      `import "os"`,
    ].join('\n');
    const refs = await extractImports('go', src, 'main.go');
    expect(specs(refs)).toEqual(['fmt', 'github.com/acme/shop/internal/api', 'os'].sort());
  });

  it('java', async () => {
    const src = [`package com.acme;`, `import java.util.List;`, `import static org.junit.Assert.*;`].join('\n');
    const refs = await extractImports('java', src, 'src/A.java');
    expect(specs(refs)).toContain('java.util.List');
  });

  it('kotlin', async () => {
    const src = [`package com.acme`, `import io.ktor.server.routing.get`, `import com.acme.db.Repo as R`].join('\n');
    const refs = await extractImports('kotlin', src, 'App.kt');
    expect(specs(refs)).toEqual(['com.acme.db.Repo', 'io.ktor.server.routing.get'].sort());
  });
});

describe('regex fallback parity', () => {
  it('typescript fallback matches core cases', () => {
    const src = `import a from './a';\nconst b = require('b');`;
    expect(specs(extractImportsRegex('typescript', src))).toEqual(['./a', 'b']);
  });
  it('go fallback handles blocks', () => {
    const src = `import (\n  "fmt"\n  x "example.com/x"\n)`;
    expect(specs(extractImportsRegex('go', src))).toEqual(['example.com/x', 'fmt']);
  });
});
