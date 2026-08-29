import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

/**
 * A dedicated Registry rather than prom-client's process-global default —
 * keeps DevoxGuard's metrics namespaced and avoids collisions if the host
 * app also uses prom-client for its own metrics.
 */
export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

/** Incremented once per finding in guard/devoxguard.guard.ts's persist() — the single chokepoint every finding (rule-triggered or anomaly) already passes through regardless of decision. */
export const findingsByDecisionCounter = new Counter({
  name: 'devoxguard_findings_total',
  help: 'Findings produced by DevoxGuard, labeled by the final action taken',
  labelNames: ['actionTaken'] as const,
  registers: [metricsRegistry],
});
