/**
 * Load-tests api-demo with DevoxGuard attached, using autocannon.
 * Requires MongoDB + Elasticsearch reachable (docker compose -f
 * docker-compose.dev.yml up -d) since AppModule wires in DevoxGuardModule.
 *
 * Usage: npm run load-test -w packages/api-demo
 */
import autocannon from 'autocannon';
import { createApp } from '../src/main';

const PORT = 3199;
const BASE_URL = `http://localhost:${PORT}`;

function summarizeStatusCodes(result: autocannon.Result): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [code, stat] of Object.entries(result.statusCodeStats ?? {})) {
    counts[code] = (stat as { count: number }).count;
  }
  return counts;
}

async function runPhase(title: string, opts: autocannon.Options): Promise<autocannon.Result> {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`);
  const result = await autocannon(opts);
  // eslint-disable-next-line no-console
  console.log(autocannon.printResult(result));
  // eslint-disable-next-line no-console
  console.log('Status codes:', summarizeStatusCodes(result));
  return result;
}

async function main() {
  process.env.DEVOXGUARD_API_KEY = process.env.DEVOXGUARD_API_KEY ?? 'dev-api-key';

  const app = await createApp();
  await app.listen(PORT);
  // eslint-disable-next-line no-console
  console.log(`api-demo (with DevoxGuard) listening on ${BASE_URL}`);

  try {
    // Phase 1: legitimate, genuinely slow traffic (throttled to ~2
    // req/sec via connectionRate) to a route the caller owns — should
    // sail through untouched, and establishes a "normal" baseline in
    // the EWMA frequency analyzer's per-user state. Local requests are
    // fast enough that even a handful of unthrottled connections looks
    // like a high rate to the analyzer, so throttling here is what
    // makes Phase 2's burst actually register as a rate change.
    const baseline = await runPhase('Phase 1: baseline (throttled ~2 req/sec, owned resource)', {
      url: `${BASE_URL}/orders/1`,
      headers: { authorization: 'Bearer 1' },
      connections: 1,
      connectionRate: 2,
      duration: 6,
    });

    // Phase 2: sustained high-frequency traffic cycling through 5
    // consecutive owned ids (10-14, all owned by user 1 — see
    // seed-data.ts) at once. This combines two anomaly signals
    // simultaneously: anomaly-frequency (rapid inter-arrival times) and
    // anomaly-sequence (5+ consecutive ids within 10s). Composite score
    // = 0.4*frequency + 0.4*sequence can reach 0.8, crossing the 0.7
    // rate-limit threshold — frequency alone caps at 0.4 and can never
    // cross it (see composite-scorer.ts weights), which is why a
    // single-signal burst against one fixed id (tried first) never
    // produced a 429 in practice.
    const burst = await runPhase('Phase 2: sustained burst (owned ids 10-14, high rate — frequency + sequence signals)', {
      url: BASE_URL,
      headers: { authorization: 'Bearer 1' },
      requests: ['10', '11', '12', '13', '14'].map((id) => ({ method: 'GET', path: `/orders/${id}` })),
      // A single connection cycling the 5 request definitions in a
      // clean round-robin, rather than many concurrent connections: with
      // 20 concurrent connections started together, they tend to stay
      // roughly in phase (similar local round-trip time), so the
      // sequence-scan detector's sliding window often sees only 1-2 of
      // the 5 distinct ids at a time instead of a clean spread across
      // all 5 — discovered while diagnosing why rate-limiting never
      // engaged despite the right ids being hit.
      connections: 1,
      duration: 8,
      pipelining: 1,
    });

    // Phase 3: a clean IDOR attempt — every request should be blocked by
    // the idor-orders DSL rule regardless of load.
    const idor = await runPhase('Phase 3: sustained IDOR attempts (unowned resource)', {
      url: `${BASE_URL}/orders/1`,
      headers: { authorization: 'Bearer 2' },
      connections: 5,
      duration: 3,
    });

    const burstStatusCodes = summarizeStatusCodes(burst);
    const rateLimited = burstStatusCodes['429'] ?? 0;
    const idorStatusCodes = summarizeStatusCodes(idor);
    const blocked = idorStatusCodes['403'] ?? 0;

    // eslint-disable-next-line no-console
    console.log('\n=== Summary ===');
    // eslint-disable-next-line no-console
    console.log(`Baseline requests completed: ${baseline.requests.total}`);
    // eslint-disable-next-line no-console
    console.log(`Burst requests completed: ${burst.requests.total}, 429s: ${rateLimited}`);
    // eslint-disable-next-line no-console
    console.log(`IDOR attempts: ${idor.requests.total}, 403s: ${blocked}`);

    if (rateLimited === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        'WARNING: no 429s observed under sustained burst — rate-limiting may not have engaged. ' +
          'This can happen if the burst duration/rate is too low relative to the token bucket config; ' +
          'not necessarily a bug, but worth a manual look if seen consistently.',
      );
    }
    if (blocked !== idor.requests.total) {
      throw new Error(
        `Expected every IDOR attempt to be blocked (403), got ${blocked}/${idor.requests.total}`,
      );
    }
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
