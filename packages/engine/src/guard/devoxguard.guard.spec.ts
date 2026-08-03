import { CallHandler, ExecutionContext, ForbiddenException, HttpException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { DevoxGuardDeps, DevoxGuardInterceptor, RateLimiter } from './devoxguard.guard';
import { DecisionEngine } from './decision-engine';
import { EwmaFrequencyAnalyzer } from '../anomaly/ewma-frequency.analyzer';
import { SequenceScanDetector } from '../anomaly/sequence-scan.detector';
import { OriginShiftDetector } from '../anomaly/origin-shift.detector';
import { RequestContext } from '../analysis/request-context';
import { CompiledRule } from '../rules/rule.types';
import { Finding } from '../storage/finding.schema';
import { parse } from '../rules/dsl/parser';
import { tokenize } from '../rules/dsl/tokenizer';

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

  it('allows the request when no rule matches and no anomaly is detected', async () => {
    const persistFindings = jest.fn();
    const deps: DevoxGuardDeps = {
      getRules: () => [],
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
      getRules: () => {
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
