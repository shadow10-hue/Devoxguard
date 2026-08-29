/**
 * Shared traversal helpers for the injection detectors
 * (sql-injection.detector.ts, nosql-injection.detector.ts).
 *
 * Both detectors have to look at arbitrarily-shaped request input — query
 * strings that Express' extended parser may have turned into nested objects
 * (`?filter[$ne]=1` → `{ filter: { $ne: '1' } }`), JSON bodies, route params —
 * so the traversal is factored out here with hard bounds: attacker-controlled
 * input must never be able to turn a scan into unbounded work.
 *
 * Fail-CLOSED on those bounds (security fix): a scan that hits either limit
 * returns `truncated: true`, and the detectors turn a truncated scan into a
 * `blocked` finding rather than silently reporting "clean". Previously the
 * traversal `return`ed early and the unscanned siblings/subtrees were treated
 * as if absent — so padding a request with 500+ decoy params, or nesting the
 * payload 9+ levels deep, evaded detection entirely while the payload still
 * reached the handler. Legitimate traffic for these endpoints never
 * approaches these bounds, so blocking on truncation is the correct default.
 */

/** Deepest object/array nesting the scanners descend into before failing closed. */
const MAX_DEPTH = 12;
/**
 * Cap on total nodes visited per scan. Raised well above any realistic
 * request shape (input is already bounded by the host's body/header size
 * limits) so this only trips on abusive padding — which now fails closed
 * rather than slipping through.
 */
const MAX_NODES = 4096;
/** Strings longer than this are truncated before regex matching (ReDoS/`work` bound). */
const MAX_STRING_LENGTH = 4096;

export interface ScannedString {
  /** Dotted path to the value, e.g. `query.q` or `body.items[0].name`. */
  path: string;
  value: string;
}

/** A completed scan plus whether either hard bound stopped it short of visiting everything. */
export interface ScanResult<T> {
  results: T[];
  /** True if MAX_NODES or MAX_DEPTH cut the traversal short — some input went unexamined. */
  truncated: boolean;
}

/**
 * Collects every string leaf under `root`, labelled with its path. Used by
 * the SQLi detector, which matches patterns against string values regardless
 * of where they sit in the request shape.
 */
export function collectStrings(root: unknown, rootLabel: string): ScanResult<ScannedString> {
  const out: ScannedString[] = [];
  let visited = 0;
  let truncated = false;

  const visit = (node: unknown, path: string, depth: number): void => {
    if (visited >= MAX_NODES) {
      truncated = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      // Only counts as truncation when there's actually something below to miss.
      if (node !== null && typeof node === 'object') truncated = true;
      return;
    }
    visited += 1;

    if (typeof node === 'string') {
      out.push({ path, value: node.length > MAX_STRING_LENGTH ? node.slice(0, MAX_STRING_LENGTH) : node });
    } else if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) visit(node[i], `${path}[${i}]`, depth + 1);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        visit(value, `${path}.${key}`, depth + 1);
      }
    }
  };

  visit(root, rootLabel, 0);
  return { results: out, truncated };
}

export interface OperatorHit {
  /** Dotted path to the operator key, e.g. `body.email.$ne`. */
  path: string;
  /** The offending key, e.g. `$ne`, `$where`. */
  operator: string;
}

/**
 * Finds MongoDB query-operator keys (any key beginning with `$`) anywhere in
 * `root`. This is the structural check the DSL can't express: a scalar field
 * that arrives as `{ $ne: null }` / `{ $gt: '' }` is operator injection, and a
 * `$where`/`$function`/`$accumulator` key is server-side JS execution. Mirrors
 * how `express-mongo-sanitize` and similar defences identify tainted input.
 */
export function findMongoOperatorKeys(root: unknown, rootLabel: string): ScanResult<OperatorHit> {
  const out: OperatorHit[] = [];
  let visited = 0;
  let truncated = false;

  const visit = (node: unknown, path: string, depth: number): void => {
    if (visited >= MAX_NODES) {
      truncated = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      if (node !== null && typeof node === 'object') truncated = true;
      return;
    }
    visited += 1;

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) visit(node[i], `${path}[${i}]`, depth + 1);
    } else if (node !== null && typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.startsWith('$')) out.push({ path: `${path}.${key}`, operator: key });
        visit(value, `${path}.${key}`, depth + 1);
      }
    }
  };

  visit(root, rootLabel, 0);
  return { results: out, truncated };
}

/** Operators that allow arbitrary server-side JavaScript execution — the highest-severity NoSQLi class. */
export const JS_EXECUTION_OPERATORS: ReadonlySet<string> = new Set(['$where', '$function', '$accumulator', '$expr']);
