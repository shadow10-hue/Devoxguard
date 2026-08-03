import { ExcessiveExposureDetector } from './excessive-exposure.detector';
import { RequestContext } from '../request-context';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/users/:id/profile',
    method: 'GET',
    params: { id: '1' },
    query: {},
    body: null,
    headers: {},
    authenticatedUser: { id: 'user-1' },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('ExcessiveExposureDetector', () => {
  const detector = new ExcessiveExposureDetector();

  it('emits a medium-severity, logged finding when passwordHash is exposed', () => {
    const findings = detector.detect(baseContext(), { id: '1', passwordHash: 'hash-abc' });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'excessive-exposure',
      severity: 'medium',
      actionTaken: 'logged',
    });
  });

  it('emits nothing when the response has no sensitive fields', () => {
    const findings = detector.detect(baseContext(), { id: '1', name: 'Alice' });
    expect(findings).toHaveLength(0);
  });

  it('emits nothing when there is no response body', () => {
    const findings = detector.detect(baseContext());
    expect(findings).toHaveLength(0);
  });
});
