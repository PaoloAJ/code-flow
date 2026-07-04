/**
 * Lightweight "network/db call inside a loop" scanners — a classic N+1 /
 * chatty-IO bottleneck signal. Approximate by design; used only to flag,
 * never to block.
 */

export interface LoopCallHit {
  line: number;
  note: string;
}

/**
 * Strip a trailing line comment so example code in comments doesn't register
 * as routes/calls. Conservative: `//` only when at start or after whitespace
 * (leaves `https://…` intact), `#` likewise for Python.
 */
export function stripLineComment(line: string, marker: '//' | '#'): string {
  const re = marker === '//' ? /(^|\s)\/\/.*$/ : /(^|\s)#.*$/;
  return re.test(line) ? line.replace(re, '$1') : line;
}

/** Brace-language scanner (JS/TS/Java/Kotlin/Go). */
export function callsInLoopsBraces(text: string, callPattern: RegExp): LoopCallHit[] {
  const lines = text.split('\n');
  const hits: LoopCallHit[] = [];
  /** Brace depths at which a loop body started. */
  const loopDepths: number[] = [];
  let depth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isLoopHeader = /\b(for|while)\s*\(|\.(forEach|map)\s*\(|\bfor\s+\w+(\s*,\s*\w+)?\s*:?=?\s*range\b/.test(
      line,
    );
    if (loopDepths.length > 0 && callPattern.test(line)) {
      hits.push({ line: i + 1, note: line.trim().slice(0, 120) });
    }
    for (const ch of line) {
      if (ch === '{') {
        depth++;
        if (isLoopHeader && loopDepths[loopDepths.length - 1] !== depth) loopDepths.push(depth);
      } else if (ch === '}') {
        if (loopDepths[loopDepths.length - 1] === depth) loopDepths.pop();
        depth = Math.max(0, depth - 1);
      }
    }
  }
  return hits;
}

/** Indentation-based scanner (Python). */
export function callsInLoopsIndent(text: string, callPattern: RegExp): LoopCallHit[] {
  const lines = text.split('\n');
  const hits: LoopCallHit[] = [];
  /** Indent widths of active for/while headers. */
  const loopIndents: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    while (loopIndents.length > 0 && indent <= loopIndents[loopIndents.length - 1]) {
      loopIndents.pop();
    }
    if (loopIndents.length > 0 && callPattern.test(line)) {
      hits.push({ line: i + 1, note: line.trim().slice(0, 120) });
    }
    if (/^\s*(for|while)\b.*:\s*(#.*)?$/.test(line)) {
      loopIndents.push(indent);
    }
  }
  return hits;
}
