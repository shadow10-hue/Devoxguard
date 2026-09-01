import { evaluate } from './evaluator';
import { RequestContext } from '../../analysis/request-context';
import { parse } from './parser';
import { tokenize } from './tokenizer';

function condition(expr: string) {
  return parse(tokenize(expr));
}

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/orders/:id',
    method: 'GET',
    params: { id: '3' },
    query: { limit: '50' },
    body: { role: 'admin' },
    headers: {},
    authenticatedUser: { id: 'user-1', ownedResourceIds: { orders: ['1', '2'] } },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('evaluate', () => {
  it('exists: true when the path resolves to a defined value', () => {
    expect(evaluate(condition('body.role exists'), baseContext())).toBe(true);
  });

  it('exists: false when the path resolves to undefined', () => {
    expect(evaluate(condition('body.isAdmin exists'), baseContext())).toBe(false);
  });

  it('comparison ==: true when values are equal', () => {
    expect(evaluate(condition('query.limit == "50"'), baseContext())).toBe(true);
  });

  it('comparison !=: true when values differ', () => {
    expect(evaluate(condition('query.limit != "10"'), baseContext())).toBe(true);
  });

  it('in: true when the value is a member of the referenced array', () => {
    expect(
      evaluate(condition('params.id in user.ownedResourceIds.orders'), baseContext({ params: { id: '1' } })),
    ).toBe(true);
  });

  it('not-in: true when the value is not a member of the referenced array', () => {
    expect(evaluate(condition('params.id not in user.ownedResourceIds.orders'), baseContext())).toBe(true);
  });

  it('not-in: false when the value is a member of the referenced array', () => {
    expect(
      evaluate(condition('params.id not in user.ownedResourceIds.orders'), baseContext({ params: { id: '1' } })),
    ).toBe(false);
  });

  it('response.passwordHash exists: reads from context.responseBody', () => {
    const ctx = baseContext({ route: '/users/:id/profile', responseBody: { id: '1', passwordHash: 'hash-abc' } });
    expect(evaluate(condition('response.passwordHash exists'), ctx)).toBe(true);
  });

  it('response.passwordHash exists: false when there is no response body yet', () => {
    const ctx = baseContext({ route: '/users/:id/profile' });
    expect(evaluate(condition('response.passwordHash exists'), ctx)).toBe(false);
  });

  describe('boolean composition', () => {
    it('and: true only when both sides hold', () => {
      expect(evaluate(condition('body.role exists and query.limit == "50"'), baseContext())).toBe(true);
      expect(evaluate(condition('body.role exists and query.limit == "10"'), baseContext())).toBe(false);
      expect(evaluate(condition('body.isAdmin exists and query.limit == "50"'), baseContext())).toBe(false);
    });

    it('or: true when either side holds', () => {
      expect(evaluate(condition('body.isAdmin exists or body.role exists'), baseContext())).toBe(true);
      expect(evaluate(condition('body.role exists or body.isAdmin exists'), baseContext())).toBe(true);
      expect(evaluate(condition('body.isAdmin exists or body.missing exists'), baseContext())).toBe(false);
    });

    it('not: inverts its operand', () => {
      expect(evaluate(condition('not body.isAdmin exists'), baseContext())).toBe(true);
      expect(evaluate(condition('not body.role exists'), baseContext())).toBe(false);
    });

    it('nested tree with parentheses', () => {
      const expr = '(body.role == "admin" or body.role == "root") and not query.limit == "10"';
      expect(evaluate(condition(expr), baseContext())).toBe(true);
      expect(evaluate(condition(expr), baseContext({ body: { role: 'user' } }))).toBe(false);
    });

    it('short-circuits: the right side is not evaluated when the left decides', () => {
      // A deliberately broken node that would throw inside resolvePath if visited.
      const broken = { kind: 'exists', path: undefined } as never;

      expect(evaluate({ kind: 'or', left: condition('body.role exists'), right: broken }, baseContext())).toBe(true);
      expect(evaluate({ kind: 'and', left: condition('body.isAdmin exists'), right: broken }, baseContext())).toBe(false);
    });
  });
});
