import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, catchError, mergeMap, tap } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { RequestContext } from '../analysis/request-context';
import { Detector } from '../analysis/detectors/detector.interface';
import { AlertNotifier } from '../alerting/alert-notifier';
import { IpContainment } from '../alerting/ip-containment';
import { behaviorLogEntryFromContext } from '../anomaly/behavior-log.schema';
import { computeCompositeScore } from '../anomaly/composite-scorer';
import { EwmaFrequencyAnalyzer } from '../anomaly/ewma-frequency.analyzer';
import { OriginShiftDetector } from '../anomaly/origin-shift.detector';
import { SequenceScanDetector } from '../anomaly/sequence-scan.detector';
import { evaluateRules } from '../rules/rule-evaluator';
import { CompiledRule } from '../rules/rule.types';
import { RulesForRoute } from '../rules/rule-registry';
import { Finding } from '../storage/finding.schema';
import { findingsByDecisionCounter } from '../dashboard/metrics';
import { Decision, DecisionEngine } from './decision-engine';

/** Structural interface satisfied by TokenBucket (rate-limiter/token-bucket.ts) — kept decoupled so the guard doesn't need that step to exist yet. */
export interface RateLimiter {
  tryConsume(cost?: number): boolean;
  reduceCapacity(factor: number): void;
}

export interface DevoxGuardDeps {
  getRules: () => CompiledRule[];
  /** Route+method-indexed rules, request/response-phase pre-split — see RuleRegistry.getRulesFor. Avoids a full linear scan of every loaded rule on every request. */
  getRulesFor: (methode: string, route: string) => RulesForRoute;
  ewmaAnalyzer: EwmaFrequencyAnalyzer;
  sequenceScanDetector: SequenceScanDetector;
  originShiftDetector: OriginShiftDetector;
  /**
   * Synchronous, route-agnostic content detectors run on every request's
   * inputs (SQLi/NoSQLi). Unlike the anomaly analyzers they can emit a
   * `blocked` finding directly, so an injection attempt is stopped before the
   * handler runs. Optional — an empty/absent list disables content detection.
   */
  injectionDetectors?: Detector[];
  decisionEngine: DecisionEngine;
  rateLimiter?: RateLimiter;
  /**
   * Automated incident response (both optional, opt-in). `alertNotifier`
   * fires an outbound webhook on blocked high-severity findings;
   * `ipContainment` bans IPs that repeatedly trip the injection detectors and
   * pre-blocks their subsequent requests. See docs/incident-response.md.
   */
  alertNotifier?: AlertNotifier;
  ipContainment?: IpContainment;
  persistFindings?: (findings: Finding[], context: RequestContext) => Promise<void> | void;
  /** Sampled with every computed composite score, for the dashboard's stats/overview trend (see anomaly-score-trend.tracker.ts). */
  scoreTrendTracker?: { record(timestamp: number, score: number): void };
}

interface PreDecision {
  ctx: RequestContext;
  findings: Finding[];
  decision: Decision;
}

/**
 * The DevoxGuard pipeline. Named/pathed as "guard" per the spec, but
 * implemented as a NestInterceptor rather than a literal CanActivate:
 * Nest runs guards before any interceptor gets to build the
 * RequestContext, and this needs both request-phase access (to decide)
 * and response-phase access (to run response.* rules and persist).
 * Deliberate deviation, documented in docs/architecture.md.
 *
 * Must be registered *before* ResponseAnalysisInterceptor in the
 * providers list, so ResponseAnalysisInterceptor — being the more
 * deeply nested interceptor — populates ctx.responseBody before this
 * interceptor's own post-handler tap() runs (interceptor post-code
 * unwinds in reverse registration order).
 *
 * Fail-open policy: any uncaught internal error is logged and the
 * request is allowed through unmodified, rather than turning an engine
 * bug into a self-inflicted denial of service on the host app.
 */
@Injectable()
export class DevoxGuardInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DevoxGuardInterceptor.name);

  constructor(private readonly deps: DevoxGuardDeps) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();

    return from(this.beforeHandler(req)).pipe(
      mergeMap((pre) => {
        if (pre.decision === 'block') {
          this.persist(this.deps.decisionEngine.applyDecision(pre.findings, 'block'), pre.ctx);
          throw new ForbiddenException('Request blocked by DevoxGuard');
        }

        if (pre.decision === 'rate-limit') {
          this.deps.rateLimiter?.reduceCapacity(0.5);
          const allowed = this.deps.rateLimiter ? this.deps.rateLimiter.tryConsume() : true;
          if (!allowed) {
            this.persist(this.deps.decisionEngine.applyDecision(pre.findings, 'rate-limit'), pre.ctx);
            throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
          }
        }

        return this.proceed(next, pre);
      }),
      catchError((err) => {
        if (err instanceof HttpException) throw err;
        this.logger.error('DevoxGuard internal error — failing open', err as Error);
        return next.handle();
      }),
    );
  }

  private async beforeHandler(req: { devoxGuardContext?: RequestContext }): Promise<PreDecision> {
    const ctx = req.devoxGuardContext;
    if (!ctx) {
      throw new Error('DevoxGuardInterceptor requires RequestAnalysisInterceptor to run first');
    }

    // Automated containment runs first: a banned origin is rejected before any
    // rule, detector, or handler executes.
    if (this.deps.ipContainment && (await this.deps.ipContainment.isBanned(ctx.originIp))) {
      const finding: Finding = {
        id: uuidv4(),
        requestId: ctx.requestId,
        type: 'auto-contained',
        severity: 'high',
        route: ctx.route,
        method: ctx.method,
        userId: ctx.authenticatedUser?.id ?? null,
        detail: `Request rejected: origin ${ctx.originIp} is temporarily contained after repeated injection attempts`,
        actionTaken: 'blocked',
        timestamp: ctx.timestamp,
      };
      return { ctx, findings: [finding], decision: 'block' };
    }

    const { requestPhase } = this.deps.getRulesFor(ctx.method, ctx.route);
    const ruleFindings = evaluateRules(requestPhase, ctx);

    const injectionFindings = (this.deps.injectionDetectors ?? []).flatMap((detector) => detector.detect(ctx));
    // Repeated injection attempts from an origin escalate to a temporary ban.
    if (injectionFindings.length > 0 && this.deps.ipContainment) {
      await this.deps.ipContainment.recordOffense(ctx.originIp);
    }

    let anomalyFindings: Finding[] = [];
    let compositeScore = 0;

    const behaviorEntry = behaviorLogEntryFromContext(ctx);
    if (behaviorEntry) {
      const [freqFindings, seqFindings, originFindings] = await Promise.all([
        this.deps.ewmaAnalyzer.analyze(behaviorEntry),
        this.deps.sequenceScanDetector.analyze(behaviorEntry),
        this.deps.originShiftDetector.analyze(behaviorEntry),
      ]);
      anomalyFindings = [...freqFindings, ...seqFindings, ...originFindings];

      compositeScore = computeCompositeScore({
        zScoreFrequency: this.deps.ewmaAnalyzer.getLastZScore(behaviorEntry.userId, behaviorEntry.route),
        sequenceDetected: seqFindings.length > 0,
        originShiftDetected: originFindings.length > 0,
      });

      this.deps.scoreTrendTracker?.record(ctx.timestamp, compositeScore);
    }

    const findings = [...ruleFindings, ...injectionFindings, ...anomalyFindings];
    const decision = this.deps.decisionEngine.decide({ findings, compositeScore });

    return { ctx, findings, decision };
  }

  private proceed(next: CallHandler, pre: PreDecision): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const { responsePhase } = this.deps.getRulesFor(pre.ctx.method, pre.ctx.route);
        const responseFindings = evaluateRules(responsePhase, pre.ctx);

        const finalFindings = this.deps.decisionEngine.applyDecision(
          [...pre.findings, ...responseFindings],
          pre.decision,
        );
        this.persist(finalFindings, pre.ctx);
      }),
    );
  }

  private persist(findings: Finding[], ctx: RequestContext): void {
    if (findings.length === 0) return;
    for (const finding of findings) {
      findingsByDecisionCounter.inc({ actionTaken: finding.actionTaken });
    }
    // Fire the outbound alert off the same findings — fully decoupled from
    // storage, and itself fire-and-forget, so neither can delay the other.
    this.deps.alertNotifier?.notify(findings, ctx);
    if (!this.deps.persistFindings) return;
    Promise.resolve(this.deps.persistFindings(findings, ctx)).catch((err) => {
      this.logger.error('DevoxGuard failed to persist findings', err as Error);
    });
  }
}
