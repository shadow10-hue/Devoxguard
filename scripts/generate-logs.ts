/**
 * Standalone synthetic traffic generator for calibrating and load-testing
 * DevoxGuard's anomaly engine (packages/engine/src/anomaly). Deliberately
 * has zero dependency on @devox/engine — it produces plain data, not
 * RequestContext/BehaviorLogEntry instances, so it can run from the repo
 * root without crossing the engine package's build boundary. The
 * anomaly analyzers' own unit tests build small local fixtures using the
 * same patterns rather than importing this file directly.
 *
 * Usage: npx ts-node scripts/generate-logs.ts > dataset.json
 */

export interface SyntheticLogEntry {
  userId: string;
  route: string;
  method: string;
  timestamp: number;
  originIp: string;
  requestedId?: string;
}

export interface GenerateOptions {
  userId?: string;
  route?: string;
  method?: string;
  originIp?: string;
  startTs?: number;
}

const DEFAULTS: Required<GenerateOptions> = {
  userId: 'user-1',
  route: '/orders/:id',
  method: 'GET',
  originIp: '10.0.0.1',
  startTs: 0,
};

/** Regular traffic: `count` requests spaced `intervalMs` apart, with optional +/- jitter. */
export function generateRegularTraffic(
  count: number,
  intervalMs: number,
  jitterMs = 0,
  opts: GenerateOptions = {},
): SyntheticLogEntry[] {
  const { userId, route, method, originIp, startTs } = { ...DEFAULTS, ...opts };
  const entries: SyntheticLogEntry[] = [];
  let ts = startTs;

  for (let i = 0; i < count; i += 1) {
    entries.push({ userId, route, method, timestamp: ts, originIp });
    const jitter = jitterMs === 0 ? 0 : i % 2 === 0 ? jitterMs : -jitterMs;
    ts += intervalMs + jitter;
  }
  return entries;
}

/** A sudden burst: `burstCount` requests spread evenly across `burstDurationMs`, appended after a regular baseline. */
export function generateBurstTraffic(
  baselineCount: number,
  baselineIntervalMs: number,
  burstCount: number,
  burstDurationMs: number,
  opts: GenerateOptions = {},
): SyntheticLogEntry[] {
  const baseline = generateRegularTraffic(baselineCount, baselineIntervalMs, baselineIntervalMs * 0.1, opts);
  const { userId, route, method, originIp } = { ...DEFAULTS, ...opts };
  const lastTs = baseline.length > 0 ? baseline[baseline.length - 1].timestamp : (opts.startTs ?? DEFAULTS.startTs);
  const burstIntervalMs = burstDurationMs / burstCount;

  const burst: SyntheticLogEntry[] = [];
  let ts = lastTs;
  for (let i = 0; i < burstCount; i += 1) {
    ts += burstIntervalMs;
    burst.push({ userId, route, method, timestamp: ts, originIp });
  }
  return [...baseline, ...burst];
}

/** A sequential IDOR-style enumeration: consecutive numeric ids requested `intervalMs` apart. */
export function generateSequentialIdScan(
  startId: number,
  count: number,
  intervalMs: number,
  opts: GenerateOptions = {},
): SyntheticLogEntry[] {
  const { userId, route, method, originIp, startTs } = { ...DEFAULTS, ...opts };
  const entries: SyntheticLogEntry[] = [];
  let ts = startTs;

  for (let i = 0; i < count; i += 1) {
    entries.push({ userId, route, method, timestamp: ts, originIp, requestedId: String(startId + i) });
    ts += intervalMs;
  }
  return entries;
}

/** Traffic that switches origin IP partway through, simulating session hijacking / credential sharing. */
export function generateOriginShiftTraffic(
  count: number,
  intervalMs: number,
  shiftAtIndex: number,
  secondIp: string,
  opts: GenerateOptions = {},
): SyntheticLogEntry[] {
  const { userId, route, method, originIp: firstIp, startTs } = { ...DEFAULTS, ...opts };
  const entries: SyntheticLogEntry[] = [];
  let ts = startTs;

  for (let i = 0; i < count; i += 1) {
    entries.push({ userId, route, method, timestamp: ts, originIp: i < shiftAtIndex ? firstIp : secondIp });
    ts += intervalMs;
  }
  return entries;
}

function main() {
  const dataset = {
    regular: generateRegularTraffic(20, 5000, 500),
    burst: generateBurstTraffic(20, 5000, 10, 1000),
    sequentialIdScan: generateSequentialIdScan(1, 8, 500),
    originShift: generateOriginShiftTraffic(10, 2000, 5, '203.0.113.7'),
  };
  process.stdout.write(`${JSON.stringify(dataset, null, 2)}\n`);
}

if (require.main === module) {
  main();
}
