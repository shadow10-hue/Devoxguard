import { CallHandler, ExecutionContext, ForbiddenException, HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { DevoxGuardDeps, DevoxGuardInterceptor, RateLimiter } from './devoxguard.guard';
import { DecisionEngine } from './decision-engine';
import { EwmaFrequencyAnalyzer } from '../anomaly/ewma-frequency.analyzer';
import { SequenceScanDetector } from '../anomaly/sequence-scan.detector';
import { OriginShiftDetector } from '../anomaly/origin-shift.detector';
import { RequestContext } from '../analysis/request-context';
import { SqlInjectionDetector } from '../analysis/detectors/sql-injection.detector';
import { NoSqlInjectionDetector } from '../analysis/detectors/nosql-injection.detector';
import { CompiledRule } from '../rules/rule.types';
import { RuleRegistry } from '../rules/rule-registry';
import { Finding } from '../storage/finding.schema';
import { metricsRegistry } from '../dashboard/metrics';
import { parse } from '../rules/dsl/parser';
import { tokenize } from '../rules/dsl/tokenizer';

/** Mirrors how devoxguard.module.ts wires getRulesFor from a real RuleRegistry, so tests exercise the same request/response-phase partitioning production does. */
function rulesFor(rules: CompiledRule[]): DevoxGuardDeps['getRulesFor'] {
  const registry = new RuleRegistry(rules);
  return (methode, route) => registry.getRulesFor(methode, route);
}

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/orders/:id',
    method: 'GET',
    params: { id: '3' },
    query: {},
    body: null,
    headers: {},
    authenticatedUser: { id: 'user-1', ownedResourceIds: { orders: ['1', '2'] } },
    originIp: '10.0.0.1',
    ...overrides,
  };
}

function compiledRule(overrides: Partial<CompiledRule> & { condition: string }): CompiledRule {
  const { condition, ...rest } = overrides;
  return {
    nom: 'test-rule',
    route: '/orders/:id',
    methode: 'GET',
    conditionAst: parse(tokenize(condition)),
    action: 'bloquer',
    severite: 'high',
    raw: condition,
    ...rest,
  };
}

function mockContext(ctx: RequestContext): ExecutionContext {
  const req: { devoxGuardContext?: RequestContext } = { devoxGuardContext: ctx };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

function mockHandler(returnValue: unknown = { ok: true }): CallHandler {
  return { handle: () => of(returnValue) };
}

function noopAnalyzers() {
  return {
    ewmaAnalyzer: { analyze: jest.fn().mockReturnValue([]), getLastZScore: jest.fn().mockReturnValue(0) } as unknown as EwmaFrequencyAnalyzer,
    sequenceScanDetector: { analyze: jest.fn().mockReturnValue([]) } as unknown as SequenceScanDetector,
    originShiftDetector: { analyze: jest.fn().mockReturnValue([]) } as unknown as OriginShiftDetector,
  };
}

describe('DevoxGuardInterceptor', () => {
  it('blocks the request when a bloquer rule matches, and persists a blocked finding', async () => {
    const persistFindings = jest.fn();
    const rule = compiledRule({ condition: 'params.id not in user.ownedResourceIds.orders' });
    const deps: DevoxGuardDeps = {
      getRules: () => [rule],
      getRulesFor: rulesFor([rule]),
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '99' } }); // not owned -> rule matches

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(persistFindings).toHaveBeenCalledTimes(1);
    const [findings] = persistFindings.mock.calls[0] as [Finding[]];
    expect(findings[0].actionTaken).toBe('blocked');
  });

  it('blocks a SQL-injection payload with no matching rule, via the live injection detector', async () => {
    const persistFindings = jest.fn();
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      injectionDetectors: [new SqlInjectionDetector(), new NoSqlInjectionDetector()],
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    // A route with no rule at all — injection detection is route-agnostic.
    const ctx = baseContext({ route: '/products/search', query: { q: "' OR '1'='1" } });

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(persistFindings).toHaveBeenCalledTimes(1);
    const [findings] = persistFindings.mock.calls[0] as [Finding[]];
    expect(findings[0]).toMatchObject({ type: 'sql-injection', actionTaken: 'blocked', cwe: 'CWE-89' });
  });

  it('blocks a NoSQL operator-injection body via the live injection detector', async () => {
    const persistFindings = jest.fn();
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      injectionDetectors: [new SqlInjectionDetector(), new NoSqlInjectionDetector()],
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ route: '/account/lookup', method: 'POST', body: { email: { $ne: null } } });

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const [findings] = persistFindings.mock.calls[0] as [Finding[]];
    expect(findings[0]).toMatchObject({ type: 'nosql-injection', actionTaken: 'blocked', cwe: 'CWE-943' });
  });

  it('records an offense with Ip containment when an injection is blocked', async () => {
    const ipContainment = { isBanned: jest.fn().mockResolvedValue(false), recordOffense: jest.fn().mockResolvedValue(false) };
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      injectionDetectors: [new SqlInjectionDetector()],
      ipContainment: ipContainment as unknown as DevoxGuardDeps['ipContainment'],
      decisionEngine: new DecisionEngine(),
      persistFindings: jest.fn(),
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ route: '/products/search', query: { q: "' OR '1'='1" } });

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(ipContainment.recordOffense).toHaveBeenCalledWith(ctx.originIp);
  });

  it('pre-blocks a request from a contained IP before any rule or handler runs', async () => {
    const persistFindings = jest.fn();
    const getRulesFor = jest.fn(rulesFor([]));
    const ipContainment = { isBanned: jest.fn().mockResolvedValue(true), recordOffense: jest.fn() };
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor,
      ipContainment: ipContainment as unknown as DevoxGuardDeps['ipContainment'],
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const handler = mockHandler();
    const handleSpy = jest.spyOn(handler, 'handle');

    await expect(lastValueFrom(interceptor.intercept(mockContext(baseContext()), handler))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    // Rejected before rule lookup and before the route handler executed.
    expect(getRulesFor).not.toHaveBeenCalled();
    expect(handleSpy).not.toHaveBeenCalled();
    const [findings] = persistFindings.mock.calls[0] as [Finding[]];
    expect(findings[0]).toMatchObject({ type: 'auto-contained', actionTaken: 'blocked' });
  });

  it('fires the alert notifier alongside persistence', async () => {
    const alertNotifier = { notify: jest.fn() };
    const rule = compiledRule({ condition: 'params.id not in user.ownedResourceIds.orders' });
    const deps: DevoxGuardDeps = {
      getRules: () => [rule],
      getRulesFor: rulesFor([rule]),
      alertNotifier: alertNotifier as unknown as DevoxGuardDeps['alertNotifier'],
      decisionEngine: new DecisionEngine(),
      persistFindings: jest.fn(),
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '99' } });

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(alertNotifier.notify).toHaveBeenCalledTimes(1);
  });

  it('increments the devoxguard_findings_total metric for every persisted finding', async () => {
    metricsRegistry.resetMetrics();
    const rule = compiledRule({ condition: 'params.id not in user.ownedResourceIds.orders' });
    const deps: DevoxGuardDeps = {
      getRules: () => [rule],
      getRulesFor: rulesFor([rule]),
      decisionEngine: new DecisionEngine(),
      persistFindings: jest.fn(),
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '99' } }); // not owned -> rule matches

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    const metricsText = await metricsRegistry.metrics();
    expect(metricsText).toMatch(/devoxguard_findings_total\{actionTaken="blocked"\} 1/);
  });

  it('allows the request when no rule matches and no anomaly is detected', async () => {
    const persistFindings = jest.fn();
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '1' } }); // owned -> no idor rule match

    const result = await lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler({ ok: true })));

    expect(result).toEqual({ ok: true });
    expect(persistFindings).not.toHaveBeenCalled();
  });

  it('rate-limits when composite anomaly score exceeds the threshold and the bucket allows it', async () => {
    const persistFindings = jest.fn();
    const rateLimiter: RateLimiter = { tryConsume: jest.fn().mockReturnValue(true), reduceCapacity: jest.fn() };
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      decisionEngine: new DecisionEngine(),
      persistFindings,
      rateLimiter,
      ewmaAnalyzer: { analyze: jest.fn().mockReturnValue([]), getLastZScore: jest.fn().mockReturnValue(3) } as unknown as EwmaFrequencyAnalyzer,
      sequenceScanDetector: {
        analyze: jest.fn().mockReturnValue([
          {
            id: 'f-seq',
            requestId: 'req-1',
            type: 'anomaly-sequence',
            severity: 'high',
            route: '/orders/:id',
            method: 'GET',
            userId: 'user-1',
            detail: 'seq',
            actionTaken: 'logged',
            timestamp: Date.now(),
          },
        ]),
      } as unknown as SequenceScanDetector,
      originShiftDetector: { analyze: jest.fn().mockReturnValue([]) } as unknown as OriginShiftDetector,
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '1' } });

    const result = await lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler({ ok: true })));

    expect(result).toEqual({ ok: true });
    expect(rateLimiter.reduceCapacity).toHaveBeenCalled();
    expect(persistFindings).toHaveBeenCalledTimes(1);
    const [findings] = persistFindings.mock.calls[0] as [Finding[]];
    expect(findings.every((f) => f.actionTaken === 'rate-limited')).toBe(true);
  });

  it('rejects with 429 when the token bucket is exhausted during a rate-limit decision', async () => {
    const persistFindings = jest.fn();
    const rateLimiter: RateLimiter = { tryConsume: jest.fn().mockReturnValue(false), reduceCapacity: jest.fn() };
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      decisionEngine: new DecisionEngine(),
      persistFindings,
      rateLimiter,
      ewmaAnalyzer: { analyze: jest.fn().mockReturnValue([]), getLastZScore: jest.fn().mockReturnValue(3) } as unknown as EwmaFrequencyAnalyzer,
      sequenceScanDetector: {
        analyze: jest.fn().mockReturnValue([
          {
            id: 'f-seq',
            requestId: 'req-1',
            type: 'anomaly-sequence',
            severity: 'high',
            route: '/orders/:id',
            method: 'GET',
            userId: 'user-1',
            detail: 'seq',
            actionTaken: 'logged',
            timestamp: Date.now(),
          },
        ]),
      } as unknown as SequenceScanDetector,
      originShiftDetector: { analyze: jest.fn().mockReturnValue([]) } as unknown as OriginShiftDetector,
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext({ params: { id: '1' } });

    await expect(lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler()))).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(persistFindings).toHaveBeenCalledTimes(1);
  });

  it('fails open: an internal engine error still lets the request through', async () => {
    const persistFindings = jest.fn();
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: () => {
        throw new Error('boom: simulated engine bug');
      },
      decisionEngine: new DecisionEngine(),
      persistFindings,
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const ctx = baseContext();

    const result = await lastValueFrom(interceptor.intercept(mockContext(ctx), mockHandler({ passedThrough: true })));

    expect(result).toEqual({ passedThrough: true });
  });

  it('fails open when RequestAnalysisInterceptor did not run first (no devoxGuardContext)', async () => {
    const deps: DevoxGuardDeps = {
      getRules: () => [],
      getRulesFor: rulesFor([]),
      decisionEngine: new DecisionEngine(),
      ...noopAnalyzers(),
    };
    const interceptor = new DevoxGuardInterceptor(deps);
    const req: { devoxGuardContext?: RequestContext } = {};
    const context = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;

    const result = await lastValueFrom(interceptor.intercept(context, mockHandler({ passedThrough: true })));
    expect(result).toEqual({ passedThrough: true });
  });
});
