import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseAnalysisInterceptor } from './response-analysis.interceptor';
import { RequestContext } from './request-context';

function createContext(req: { devoxGuardContext?: RequestContext }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function createHandler(returnValue: unknown): CallHandler {
  return { handle: () => of(returnValue) };
}

function sampleContext(): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/users/:id/profile',
    method: 'GET',
    params: { id: '1' },
    query: {},
    body: null,
    headers: {},
    authenticatedUser: null,
    originIp: '127.0.0.1',
  };
}

describe('ResponseAnalysisInterceptor', () => {
  let interceptor: ResponseAnalysisInterceptor;

  beforeEach(() => {
    interceptor = new ResponseAnalysisInterceptor();
  });

  it('attaches the resolved response body to the RequestContext', (done) => {
    const req = { devoxGuardContext: sampleContext() };
    const responseBody = { id: '1', passwordHash: 'hash-abc' };

    interceptor.intercept(createContext(req), createHandler(responseBody)).subscribe(() => {
      expect(req.devoxGuardContext.responseBody).toEqual(responseBody);
      done();
    });
  });

  it('does nothing when no RequestContext was attached to the request', (done) => {
    const req: { devoxGuardContext?: RequestContext } = {};

    interceptor.intercept(createContext(req), createHandler({ ok: true })).subscribe((result) => {
      expect(req.devoxGuardContext).toBeUndefined();
      expect(result).toEqual({ ok: true });
      done();
    });
  });
});
