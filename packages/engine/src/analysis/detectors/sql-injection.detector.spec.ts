import { SqlInjectionDetector } from './sql-injection.detector';
import { RequestContext } from '../request-context';

function baseContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: 'req-1',
    timestamp: Date.now(),
    route: '/products/search',
    method: 'GET',
    params: {},
    query: {},
    body: null,
    headers: {},
    authenticatedUser: { id: 'user-1' },
    originIp: '127.0.0.1',
    ...overrides,
  };
}

describe('SqlInjectionDetector', () => {
  const detector = new SqlInjectionDetector();

  const malicious: Array<[string, Partial<RequestContext>]> = [
    ["' OR '1'='1 tautology in query", { query: { q: "' OR '1'='1" } }],
    ['numeric OR 1=1 tautology', { query: { q: 'x OR 1=1' } }],
    ['UNION SELECT exfiltration', { query: { q: "foo' UNION SELECT username, password FROM users --" } }],
    ['UNION ALL SELECT', { query: { q: 'a UNION ALL SELECT 1,2,3' } }],
    ['stacked DROP TABLE', { query: { q: "1; DROP TABLE products" } }],
    ['comment breakout admin\'--', { body: { username: "admin'--", password: 'x' } }],
    ['time-based SLEEP', { query: { q: "1' AND SLEEP(5)--" } }],
    ['information_schema probe', { query: { q: 'UNION SELECT table_name FROM information_schema.tables' } }],
    ['payload nested in body array', { body: { filters: ['ok', "1' OR '1'='1"] } }],
    ['payload in route param', { params: { id: "1 OR 1=1" } }],
  ];

  it.each(malicious)('flags %s', (_label, overrides) => {
    const findings = detector.detect(baseContext(overrides));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'sql-injection',
      severity: 'high',
      actionTaken: 'blocked',
      cwe: 'CWE-89',
    });
    expect(typeof findings[0].matchedPattern).toBe('string');
  });

  const benign: Array<[string, Partial<RequestContext>]> = [
    ['plain search term', { query: { q: 'wireless keyboard' } }],
    ['term containing the word or', { query: { q: 'red or blue mug' } }],
    ['term containing select', { query: { q: 'select edition vinyl' } }],
    ['email in body', { body: { email: 'jane.doe@example.com', name: "O'Brien" } }],
    ['hyphenated words', { query: { q: 'well-known best-seller' } }],
    ['numeric id', { params: { id: '42' } }],
    ['empty request', {}],
  ];

  it.each(benign)('does not flag %s', (_label, overrides) => {
    expect(detector.detect(baseContext(overrides))).toHaveLength(0);
  });

  it('emits nothing when disabled', () => {
    const disabled = new SqlInjectionDetector(false);
    expect(disabled.detect(baseContext({ query: { q: "' OR '1'='1" } }))).toHaveLength(0);
  });

  it('names the offending field and signature in the detail', () => {
    const [finding] = detector.detect(baseContext({ query: { q: 'a UNION SELECT 1' } }));
    expect(finding.detail).toContain('query.q');
    expect(finding.matchedPattern).toBe('union-select');
  });

  it('fails closed: a request padded past the node budget is blocked, not passed through', () => {
    // Historically, ~511 decoy params exhausted the bounded scan so a later
    // `q` payload went unexamined and slipped through. Now truncation blocks.
    const query: Record<string, string> = {};
    for (let i = 0; i < 6000; i += 1) query[`p${i}`] = '1';
    query.q = "' UNION SELECT id, internalNote FROM products --";

    const findings = detector.detect(baseContext({ query }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'scan-truncated', actionTaken: 'blocked', severity: 'high' });
  });

  it('fails closed on excessively deep nesting', () => {
    let nested: Record<string, unknown> = { q: "' OR '1'='1" };
    for (let i = 0; i < 20; i += 1) nested = { child: nested };

    const findings = detector.detect(baseContext({ body: nested }));
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('scan-truncated');
  });
});
