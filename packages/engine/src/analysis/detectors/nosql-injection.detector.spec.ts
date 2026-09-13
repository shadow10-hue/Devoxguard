import { NoSqlInjectionDetector } from './nosql-injection.detector';
import { RequestContext } from '../request-context';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/account/lookup',
    method: 'POST',
    params: {},
    query: {},
    body: null,
    headers: {},
    authenticatedUser: { id: 'user-1' },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('NoSqlInjectionDetector', () => {
  const detector = new NoSqlInjectionDetector();

  it('flags a $ne operator smuggled into a body field', () => {
    const findings = detector.detect(baseContext({ body: { email: { $ne: null } } }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'nosql-injection',
      severity: 'high',
      actionTaken: 'blocked',
      cwe: 'CWE-943',
      matchedPattern: '$ne',
    });
    expect(findings[0].detail).toContain('body.email.$ne');
  });

  it('flags an operator that arrived through a query string (?email[$gt]=)', () => {
    // Express' extended query parser turns email[$gt]= into { email: { $gt: '' } }.
    const findings = detector.detect(baseContext({ method: 'GET', query: { email: { $gt: '' } } as never }));
    expect(findings).toHaveLength(1);
    expect(findings[0].matchedPattern).toBe('$gt');
  });

  it('prefers a $where (JS execution) operator over a lower-risk one in the same request', () => {
    const findings = detector.detect(
      baseContext({ body: { email: { $ne: null }, filter: { $where: 'sleep(1000)' } } }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].matchedPattern).toBe('$where');
  });

  it('does not flag a normal scalar lookup', () => {
    expect(detector.detect(baseContext({ body: { email: 'jane@example.com' } }))).toHaveLength(0);
  });

  it('does not flag ordinary nested objects without operator keys', () => {
    const findings = detector.detect(
      baseContext({ body: { profile: { name: 'Jane', address: { city: 'Rabat' } } } }),
    );
    expect(findings).toHaveLength(0);
  });

  it('emits nothing when disabled', () => {
    const disabled = new NoSqlInjectionDetector(false);
    expect(disabled.detect(baseContext({ body: { email: { $ne: null } } }))).toHaveLength(0);
  });

  it('fails closed: a body padded past the node budget is blocked, not passed through', () => {
    const body: Record<string, unknown> = {};
    for (let i = 0; i < 6000; i += 1) body[`p${i}`] = '1';
    body.email = { $ne: null };

    const findings = detector.detect(baseContext({ body }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'scan-truncated', actionTaken: 'blocked', cwe: 'CWE-943' });
  });
});
