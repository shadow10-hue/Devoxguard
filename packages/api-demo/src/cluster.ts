import cluster from 'node:cluster';
import os from 'node:os';
import { Logger } from '@nestjs/common';
import { bootstrap } from './main';

/**
 * Opt-in multi-process entrypoint (`npm run start:prod:cluster`) — forks
 * one worker per CPU core, each running the app's normal bootstrap()
 * unchanged. `start:prod` (single process, `node dist/main`) stays the
 * default; this is deliberately not wired into it, so nothing that
 * already depends on start:prod (e.g. the Dockerfile's CMD) changes
 * behavior just by this file existing.
 *
 * Known caveat: each worker is a fully independent process, including
 * its own anomaly-detector state (EWMA frequency, sequence-scan,
 * origin-shift) unless DEVOXGUARD_REDIS_URI is configured — see
 * docs/architecture.md §7/§8. Without Redis, a given user's requests
 * landing on different workers fragments anomaly detection (a real
 * detection-evasion risk, not just a correctness nit). Rule-based
 * blocking is stateless per-request and unaffected either way. Don't
 * enable this in production before Redis-backed state is configured and
 * verified, unless that degradation is an accepted, documented tradeoff.
 */
const logger = new Logger('Cluster');

if (cluster.isPrimary) {
  const numWorkers = os.cpus().length;
  logger.log(`Primary ${process.pid} forking ${numWorkers} worker(s)`);

  for (let i = 0; i < numWorkers; i += 1) cluster.fork();

  let shuttingDown = false;

  cluster.on('exit', (worker, code, signal) => {
    // Workers also exit (by design) when the primary forwards
    // SIGTERM/SIGINT below — only respawn on an unexpected exit, or
    // shutdown would turn into an infinite respawn loop that never lets
    // the primary itself terminate.
    if (shuttingDown) return;
    logger.warn(
      `Worker ${worker.process.pid} exited unexpectedly (code=${code}, signal=${signal}) — respawning`,
    );
    cluster.fork();
  });

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      shuttingDown = true;
      logger.log(
        `Primary received ${signal}, forwarding to ${numWorkers} worker(s)`,
      );
      for (const id in cluster.workers) {
        cluster.workers[id]?.process.kill(signal);
      }
    });
  }
} else {
  void bootstrap();
}
