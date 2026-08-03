import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { RequestAnalysisInterceptor } from './request-analysis.interceptor';

interface MockReq {
  route?: { path: string };
  originalUrl?: string;
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  ip: string;
  user?: { id: string; ownedResourceIds?: Record<string, string[]> };
  devoxGuardContext?: unknown;
}

function createContext(req: MockReq): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function createHandler(returnValue: unknown = {}): CallHandler {
  return { handle: () => of(returnValue) };
}

function baseReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    route: { path: '/base' },
    method: 'GET',
    params: {},
    query: {},
    body: null,
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

describe('RequestAnalysisInterceptor', () => {
  let interceptor: RequestAnalysisInterceptor;

  beforeEach(() => {
    interceptor = new RequestAnalysisInterceptor();
  });

  it('case 1: GET /orders/42 -> context.params.id === "42"', (done) => {
    const req = baseReq({ route: { path: '/orders/:id' }, params: { id: '42' } });

    interceptor.intercept(createContext(req), createHandler()).subscribe(() => {
      expect((req.devoxGuardContext as any).params.id).toBe('42');
      done();
    });
  });

  it('case 2: PATCH /users/7 body { name: "Ali" } -> context.body === { name: "Ali" }', (done) => {
    const req = baseReq({
      route: { path: '/users/:id' },
      method: 'PATCH',
      params: { id: '7' },
      body: { name: 'Ali' },
    });

    interceptor.intercept(createContext(req), createHandler()).subscribe(() => {
      expect((req.devoxGuardContext as any).body).toEqual({ name: 'Ali' });
      done();
    });
  });

  it('case 3: POST /reviews without body -> context.body === null', (done) => {
    const req = baseReq({ route: { path: '/reviews' }, method: 'POST', body: undefined });

    interceptor.intercept(createContext(req), createHandler()).subscribe(() => {
      expect((req.devoxGuardContext as any).body).toBeNull();
      done();
    });
  });

  it('case 4: request without authorization header -> context.authenticatedUser === null', (done) => {
    const req = baseReq();

    interceptor.intercept(createContext(req), createHandler()).subscribe(() => {
      expect((req.devoxGuardContext as any).authenticatedUser).toBeNull();
      done();
    });
  });

  it('case 5: 3 successive requests -> 3 distinct context.requestId', (done) => {
    const reqs = [baseReq(), baseReq(), baseReq()];
    let completed = 0;

    reqs.forEach((req) => {
      interceptor.intercept(createContext(req), createHandler()).subscribe(() => {
        completed += 1;
        if (completed === reqs.length) {
          const ids = reqs.map((r) => (r.devoxGuardContext as any).requestId);
          expect(new Set(ids).size).toBe(3);
          done();
        }
      });
    });
  });
});
