import { IdorDetector } from './idor.detector';
import { RequestContext } from '../request-context';

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
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('IdorDetector', () => {
  const detector = new IdorDetector();

  it('emits a high-severity finding when the requested order is not owned by the caller', () => {
    const findings = detector.detect(baseContext());

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'idor', severity: 'high', actionTaken: 'blocked' });
  });

  it('emits nothing when the requested order is owned by the caller', () => {
    const findings = detector.detect(baseContext({ params: { id: '1' } }));
    expect(findings).toHaveLength(0);
  });

  it('emits nothing for unrelated routes', () => {
    const findings = detector.detect(baseContext({ route: '/reviews', params: {} }));
    expect(findings).toHaveLength(0);
  });
});
