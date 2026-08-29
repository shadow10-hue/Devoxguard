import { Logger } from '@nestjs/common';
import { RequestContext } from '../analysis/request-context';
import { Finding, Severity } from '../storage/finding.schema';

export interface AlertNotifierConfig {
  /** Generic JSON webhook (Slack-compatible `{ text, ... }`). Unset → alerting disabled. */
  webhookUrl?: string;
  /** Only findings at or above this severity are alerted. Default 'high'. */
  minSeverity?: Severity;
  /** Per-request timeout for the webhook POST. Default 3000ms. */
  timeoutMs?: number;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

/**
 * Fires an outbound alert when DevoxGuard blocks a high-severity finding — the
 * automated first step of the incident-response playbook (docs/incident-response.md).
 *
 * Strictly fire-and-forget and best-effort, mirroring the guard's persist()
 * discipline: it never throws, never rejects, and never delays the request
 * path. A missing `webhookUrl` disables it entirely (the default), so it's
 * inert unless an operator opts in.
 */
export class AlertNotifier {
  private readonly logger = new Logger(AlertNotifier.name);

  constructor(private readonly config: AlertNotifierConfig = {}) {}

  notify(findings: Finding[], ctx: RequestContext): void {
    if (!this.config.webhookUrl) return;

    const min = SEVERITY_RANK[this.config.minSeverity ?? 'high'];
    const alertable = findings.filter((f) => f.actionTaken === 'blocked' && SEVERITY_RANK[f.severity] >= min);
    if (alertable.length === 0) return;

    void this.post(this.config.webhookUrl, alertable, ctx);
  }

  private async post(url: string, findings: Finding[], ctx: RequestContext): Promise<void> {
    const summary = findings.map((f) => `${f.type}${f.cwe ? ` (${f.cwe})` : ''}`).join(', ');
    const payload = {
      text: `🚨 DevoxGuard blocked ${findings.length} finding(s) on ${ctx.method} ${ctx.route}: ${summary}`,
      route: ctx.route,
      method: ctx.method,
      originIp: ctx.originIp,
      requestId: ctx.requestId,
      timestamp: ctx.timestamp,
      // Deliberately no raw payload — matchedPattern is a category id, not the
      // attacker's input, so alerts never re-emit an attack string.
      findings: findings.map((f) => ({
        type: f.type,
        severity: f.severity,
        cwe: f.cwe,
        matchedPattern: f.matchedPattern,
        detail: f.detail,
      })),
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 3000),
      });
      if (!res.ok) {
        this.logger.warn(`Alert webhook returned HTTP ${res.status} — alert dropped`);
      }
    } catch (err) {
      this.logger.warn('Alert webhook POST failed — alert dropped, request unaffected', err as Error);
    }
  }
}
