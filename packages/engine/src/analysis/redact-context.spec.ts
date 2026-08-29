import { redactRequestContext } from './redact-context';
import { RequestContext } from './request-context';

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: 1000,
    route: '/account/login',
    method: 'POST',
    params: {},
    query: {},
    body: null,
    headers: {},
    authenticatedUser: null,
    originIp: '10.0.0.1',
    ...overrides,
  };
}

describe('redactRequestContext', () => {
  it('redacts credential-bearing headers but keeps the rest', () => {
    const out = redactRequestContext(
      ctx({
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'session=abc',
          'x-devoxguard-api-key': 'the-real-key',
          'content-type': 'application/json',
          'user-agent': 'curl/8',
        },
      }),
    );

    expect(out.headers.authorization).toBe('[REDACTED]');
    expect(out.headers.cookie).toBe('[REDACTED]');
    expect(out.headers['x-devoxguard-api-key']).toBe('[REDACTED]');
    expect(out.headers['content-type']).toBe('application/json');
    expect(out.headers['user-agent']).toBe('curl/8');
  });

  it('masks secret-looking body fields at any depth, preserving structure', () => {
    const out = redactRequestContext(
      ctx({
        body: {
          email: 'jane@example.com',
          password: 'correct-horse',
          nested: { apiToken: 'tok_123', label: 'ok' },
        },
      }),
    );

    expect(out.body).toEqual({
      email: 'jane@example.com',
      password: '[REDACTED]',
      nested: { apiToken: '[REDACTED]', label: 'ok' },
    });
  });

  it('leaves a null body and non-sensitive query/params untouched', () => {
    const out = redactRequestContext(ctx({ body: null, query: { q: 'keyboard' }, params: { id: '42' } }));
    expect(out.body).toBeNull();
    expect(out.query).toEqual({ q: 'keyboard' });
    expect(out.params).toEqual({ id: '42' });
  });

  it('masks a secret-looking query parameter', () => {
    const out = redactRequestContext(ctx({ query: { token: 'abc', q: 'ok' } }));
    expect(out.query.token).toBe('[REDACTED]');
    expect(out.query.q).toBe('ok');
  });

  it('does not mutate the original context', () => {
    const original = ctx({ headers: { authorization: 'Bearer x' }, body: { password: 'p' } });
    redactRequestContext(original);
    expect(original.headers.authorization).toBe('Bearer x');
    expect((original.body as Record<string, unknown>).password).toBe('p');
  });
});
