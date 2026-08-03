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
import { RequestContext } from '../analysis/request-context';
import { behaviorLogEntryFromContext } from '../anomaly/behavior-log.schema';
import { computeCompositeScore } from '../anomaly/composite-scorer';
import { EwmaFrequencyAnalyzer } from '../anomaly/ewma-frequency.analyzer';
import { OriginShiftDetector } from '../anomaly/origin-shift.detector';
import { SequenceScanDetector } from '../anomaly/sequence-scan.detector';
import { referencesResponse } from '../rules/rule-loader';
import { evaluateRules } from '../rules/rule-evaluator';
import { CompiledRule } from '../rules/rule.types';
import { Finding } from '../storage/finding.schema';
import { Decision, DecisionEngine } from './decision-engine';

/** Structural interface satisfied by TokenBucket (rate-limiter/token-bucket.ts) — kept decoupled so the guard doesn't need that step to exist yet. */
export interface RateLimiter {
  tryConsume(cost?: number): boolean;
  reduceCapacity(factor: number): void;
}

export interface DevoxGuardDeps {
  getRules: () => CompiledRule[];
  ewmaAnalyzer: EwmaFrequencyAnalyzer;
  sequenceScanDetector: SequenceScanDetector;
  originShiftDetector: OriginShiftDetector;
  decisionEngine: DecisionEngine;
  rateLimiter?: RateLimiter;
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

    const rules = this.deps.getRules();
    const requestPhaseRules = rules.filter((r) => !referencesResponse(r.conditionAst));
    const ruleFindings = evaluateRules(requestPhaseRules, ctx);

    let anomalyFindings: Finding[] = [];
    let compositeScore = 0;

    const behaviorEntry = behaviorLogEntryFromContext(ctx);
    if (behaviorEntry) {
      const freqFindings = this.deps.ewmaAnalyzer.analyze(behaviorEntry);
      const seqFindings = this.deps.sequenceScanDetector.analyze(behaviorEntry);
      const originFindings = this.deps.originShiftDetector.analyze(behaviorEntry);
      anomalyFindings = [...freqFindings, ...seqFindings, ...originFindings];

      compositeScore = computeCompositeScore({
        zScoreFrequency: this.deps.ewmaAnalyzer.getLastZScore(behaviorEntry.userId, behaviorEntry.route),
        sequenceDetected: seqFindings.length > 0,
        originShiftDetected: originFindings.length > 0,
      });

      this.deps.scoreTrendTracker?.record(ctx.timestamp, compositeScore);
    }

    const findings = [...ruleFindings, ...anomalyFindings];
    const decision = this.deps.decisionEngine.decide({ findings, compositeScore });

    return { ctx, findings, decision };
  }

  private proceed(next: CallHandler, pre: PreDecision): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        const rules = this.deps.getRules();
        const responsePhaseRules = rules.filter((r) => referencesResponse(r.conditionAst));
        const responseFindings = evaluateRules(responsePhaseRules, pre.ctx);

        const finalFindings = this.deps.decisionEngine.applyDecision(
          [...pre.findings, ...responseFindings],
          pre.decision,
        );
        this.persist(finalFindings, pre.ctx);
      }),
    );
  }

  private persist(findings: Finding[], ctx: RequestContext): void {
    if (findings.length === 0 || !this.deps.persistFindings) return;
    Promise.resolve(this.deps.persistFindings(findings, ctx)).catch((err) => {
      this.logger.error('DevoxGuard failed to persist findings', err as Error);
    });
  }
}
