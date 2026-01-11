// FILE: /server/legal/diffUtils.ts

type Op = { type: "equal" | "insert" | "delete"; line: string };

function splitLines(s: string): string[] {
  return String(s || "").replace(/\r\n/g, "\n").split("\n");
}

/**
 * Myers diff (line-based) -> ops
 * Correctly implemented with proper trace storage after each D iteration.
 */
export function myersDiffLines(oldText: string, newText: string): Op[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);

  const N = a.length;
  const M = b.length;
  const MAX = N + M;

  if (MAX === 0) return [];

  const v: Record<number, number> = { 1: 0 };
  const trace: Array<Record<number, number>> = [];

  outer: for (let d = 0; d <= MAX; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x: number;

      if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }

      let y = x - k;

      while (x < N && y < M && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k] = x;

      if (x >= N && y >= M) {
        trace.push({ ...v });
        break outer;
      }
    }
    trace.push({ ...v });
  }

  return backtrack(trace, a, b);
}

function backtrack(trace: Array<Record<number, number>>, a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = v[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      ops.push({ type: "equal", line: a[x - 1] });
      x--;
      y--;
    }

    if (d > 0) {
      if (k === -d || (k !== d && (v[k - 1] ?? -1) < (v[k + 1] ?? -1))) {
        ops.push({ type: "insert", line: b[y - 1] });
        y--;
      } else {
        ops.push({ type: "delete", line: a[x - 1] });
        x--;
      }
    }
  }

  ops.reverse();
  return ops;
}

export function formatDiffText(ops: Op[]): string {
  return ops
    .map((op) => {
      if (op.type === "equal") return `  ${op.line}`;
      if (op.type === "insert") return `+ ${op.line}`;
      if (op.type === "delete") return `- ${op.line}`;
      return `  ${op.line}`;
    })
    .join("\n");
}

export function diffStats(ops: Op[]): { equal: number; inserted: number; deleted: number } {
  let equal = 0;
  let inserted = 0;
  let deleted = 0;
  for (const op of ops) {
    if (op.type === "equal") equal++;
    else if (op.type === "insert") inserted++;
    else if (op.type === "delete") deleted++;
  }
  return { equal, inserted, deleted };
}

export function computeDiff(
  oldText: string,
  newText: string
): { text: string; stats: { equal: number; inserted: number; deleted: number } } {
  const ops = myersDiffLines(oldText, newText);
  return {
    text: formatDiffText(ops),
    stats: diffStats(ops),
  };
}
