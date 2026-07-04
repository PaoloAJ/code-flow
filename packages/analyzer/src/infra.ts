import fs from 'node:fs';
import yaml from 'js-yaml';
import type { RepoFile, InfraFacts, InfraFunction } from './types.js';

/** Parse serverless.yml / SAM template.yaml / docker-compose.yml for service boundaries. */
export function parseInfra(configs: RepoFile[]): InfraFacts {
  const functions: InfraFunction[] = [];
  const composeServices: InfraFacts['composeServices'] = [];

  for (const cfg of configs) {
    const name = cfg.relPath.split('/').pop() ?? '';
    if (!/\.ya?ml$/.test(name)) continue;
    // Infra configs inside test/fixture trees describe fake infrastructure.
    if (/(^|\/)(tests?|__tests__|spec|e2e|fixtures|testdata)\//i.test(cfg.relPath)) continue;
    let doc: any;
    try {
      // SAM templates use CloudFormation intrinsics (!Ref etc.); ignore unknown tags.
      doc = yaml.load(fs.readFileSync(cfg.absPath, 'utf8'), { schema: yaml.JSON_SCHEMA });
    } catch {
      try {
        // Retry with a very lenient pass: strip tag directives.
        const raw = fs.readFileSync(cfg.absPath, 'utf8').replace(/!\w+/g, '');
        doc = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
      } catch {
        continue;
      }
    }
    if (!doc || typeof doc !== 'object') continue;

    // Serverless Framework
    if (/serverless\.ya?ml$/.test(name) && doc.functions && typeof doc.functions === 'object') {
      for (const [fnName, fn] of Object.entries<any>(doc.functions)) {
        if (fn && typeof fn.handler === 'string') {
          functions.push({ name: fnName, handler: fn.handler, configFile: cfg.relPath });
        }
      }
    }

    // AWS SAM
    if (doc.Resources && typeof doc.Resources === 'object') {
      for (const [resName, res] of Object.entries<any>(doc.Resources)) {
        if (res?.Type === 'AWS::Serverless::Function' || res?.Type === 'AWS::Lambda::Function') {
          const props = res.Properties ?? {};
          const handler = props.Handler ?? '';
          const codeUri = typeof props.CodeUri === 'string' ? props.CodeUri : '';
          functions.push({
            name: props.FunctionName ?? resName,
            handler: codeUri ? `${codeUri.replace(/\/$/, '')}/${handler}` : handler,
            configFile: cfg.relPath,
          });
        }
      }
    }

    // docker-compose — capture build contexts so services can be mapped to components
    if (/docker-compose\.ya?ml$/.test(name) && doc.services && typeof doc.services === 'object') {
      const composeDir = cfg.relPath.includes('/')
        ? cfg.relPath.slice(0, cfg.relPath.lastIndexOf('/'))
        : '';
      for (const [svcName, svc] of Object.entries<any>(doc.services)) {
        const build = svc?.build;
        const context = typeof build === 'string' ? build : build?.context;
        let buildContext: string | undefined;
        if (typeof context === 'string') {
          const joined = context === '.' ? composeDir : `${composeDir ? composeDir + '/' : ''}${context}`;
          buildContext = joined.replace(/^\.\//, '').replace(/\/$/, '');
        }
        composeServices.push({ name: svcName, configFile: cfg.relPath, buildContext });
      }
    }
  }

  return { functions, composeServices };
}

/**
 * Resolve a handler string like "src/handlers/users.handler" or
 * "dist/index.handler" to a source file in the census, best-effort.
 */
export function resolveHandlerFile(handler: string, filesByPath: Set<string>): string | null {
  // Strip the exported-function suffix: "a/b/c.handler" → "a/b/c"
  const base = handler.replace(/\.[\w$]+$/, '').replace(/\\/g, '/');
  const candidates = [
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.py`,
    `${base}/index.ts`,
    `${base}/index.js`,
    // Java handlers look like "com.example.Handler::handleRequest"
  ];
  for (const c of candidates) {
    if (filesByPath.has(c)) return c;
  }
  // Java/Kotlin: com.example.Foo::method → search for a file ending in /Foo.java|kt
  const javaClass = /^([\w.]+?)(?:::[\w]+)?$/.exec(handler);
  if (javaClass && javaClass[1].includes('.')) {
    const clsPath = javaClass[1].split('.').join('/');
    for (const f of filesByPath) {
      if (f.endsWith(`${clsPath}.java`) || f.endsWith(`${clsPath}.kt`)) return f;
    }
    const clsName = javaClass[1].split('.').pop();
    for (const f of filesByPath) {
      if (f.endsWith(`/${clsName}.java`) || f.endsWith(`/${clsName}.kt`)) return f;
    }
  }
  return null;
}
