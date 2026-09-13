import { AlertNotifier } from './alert-notifier';
import { RequestContext } from '../analysis/request-context';
import { Finding } from '../storage/finding.schema';

function ctx(): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: 1_700_000_000_000,
    route: '/products/search',
    method: 'GET',
    params: {},
    query: {},
    body: null,
    headers: {},
    authenticatedUser: null,
    originIp: '10.0.0.9',
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f-1',
    requestId: 'req-1',
    type: 'sql-injection',
    severity: 'high',
    route: '/products/search',
    method: 'GET',
    userId: null,
    detail: 'Possible SQL injection in query.q',
    matchedPattern: 'union-select',
    cwe: 'CWE-89',
    actionTaken: 'blocked',
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe('AlertNotifier', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('does nothing when no webhook URL is configured', () => {
    new AlertNotifier({}).notify([finding()], ctx());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts to the webhook for a blocked high-severity finding', async () => {
    new AlertNotifier({ webhookUrl: 'https://hook.example/x' }).notify([finding()], ctx());
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook.example/x');
    const body = JSON.parse((init as { body: string }).body);
    expect(body.findings[0]).toMatchObject({ type: 'sql-injection', cwe: 'CWE-89' });
    // Never re-emit the attacker's raw payload.
    expect(JSON.stringify(body)).not.toContain('UNION');
  });

  it('ignores logged findings and those below the severity floor', () => {
    const notifier = new AlertNotifier({ webhookUrl: 'https://hook.example/x' });
    notifier.notify([finding({ actionTaken: 'logged' })], ctx());
    notifier.notify([finding({ type: 'anomaly-origin', severity: 'medium', cwe: undefined })], ctx());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects a lowered minSeverity', async () => {
    new AlertNotifier({ webhookUrl: 'https://hook.example/x', minSeverity: 'medium' }).notify(
      [finding({ severity: 'medium' })],
      ctx(),
    );
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never throws when the webhook rejects', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    expect(() => new AlertNotifier({ webhookUrl: 'https://hook.example/x' }).notify([finding()], ctx())).not.toThrow();
    await Promise.resolve();
  });
});
