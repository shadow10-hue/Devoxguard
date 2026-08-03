import { MassAssignmentDetector } from './mass-assignment.detector';
import { RequestContext } from '../request-context';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/users/:id',
    method: 'PATCH',
    params: { id: '1' },
    query: {},
    body: { name: 'Ali' },
    headers: {},
    authenticatedUser: { id: 'user-1' },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('MassAssignmentDetector', () => {
  const detector = new MassAssignmentDetector();

  it('emits a high-severity finding when the body injects "role"', () => {
    const findings = detector.detect(baseContext({ body: { role: 'admin' } }));

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'mass-assignment', severity: 'high', actionTaken: 'blocked' });
  });

  it('emits a finding when the body injects "isAdmin"', () => {
    const findings = detector.detect(baseContext({ body: { isAdmin: true } }));
    expect(findings).toHaveLength(1);
  });

  it('emits nothing when the body only touches allowed fields', () => {
    const findings = detector.detect(baseContext({ body: { name: 'Ali' } }));
    expect(findings).toHaveLength(0);
  });
});
