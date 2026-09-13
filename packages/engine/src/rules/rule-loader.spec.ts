import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { referencesResponse, RuleLoader, RuleValidationError } from './rule-loader';

const DEFAULT_RULES_DIR = path.join(__dirname, 'default-rules');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devoxguard-rules-'));
}

describe('RuleLoader.loadFromDirectory', () => {
  it('loads and compiles the default rule set (happy path)', () => {
    const loader = new RuleLoader();
    const rules = loader.loadFromDirectory(DEFAULT_RULES_DIR);

    expect(rules).toHaveLength(3);
    expect(rules.map((r) => r.nom)).toEqual(
      expect.arrayContaining([
        'idor-orders',
        'mass-assignment-users',
        'excessive-exposure-passwordHash',
      ]),
    );

    const idorRule = rules.find((r) => r.nom === 'idor-orders')!;
    expect(idorRule.severite).toBe('high');
    expect(idorRule.action).toBe('bloquer');
    expect(idorRule.raw).toBe('params.id not in user.ownedResourceIds.orders');
    expect(idorRule.conditionAst.kind).toBe('not-in');
  });

  it('throws when a rule file does not contain a YAML array', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'bad.yml'), 'nom: not-an-array\n');

    const loader = new RuleLoader();
    expect(() => loader.loadFromDirectory(tmpDir)).toThrow(RuleValidationError);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a rule that references response.* with action bloquer', () => {
    const tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'invalid.yml'),
      [
        '- nom: "bad-rule"',
        '  route: "/users/:id/profile"',
        '  methode: GET',
        '  condition: "response.passwordHash exists"',
        '  action: bloquer',
        '  severite: haute',
        '',
      ].join('\n'),
    );

    const loader = new RuleLoader();
    expect(() => loader.loadFromDirectory(tmpDir)).toThrow(RuleValidationError);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeRule(dir: string, fields: { condition: string; action: string }): void {
    fs.writeFileSync(
      path.join(dir, 'rule.yml'),
      [
        '- nom: "composed-rule"',
        '  route: "/users/:id"',
        '  methode: PATCH',
        `  condition: '${fields.condition}'`,
        `  action: ${fields.action}`,
        '  severite: haute',
        '',
      ].join('\n'),
    );
  }

  it('rejects a mixed request/response condition with action bloquer', () => {
    const tmpDir = makeTmpDir();
    writeRule(tmpDir, { condition: 'body.role exists and response.passwordHash exists', action: 'bloquer' });

    expect(() => new RuleLoader().loadFromDirectory(tmpDir)).toThrow(RuleValidationError);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a mixed request/response condition with action journaliser (response-phase)', () => {
    const tmpDir = makeTmpDir();
    writeRule(tmpDir, { condition: 'body.role exists and response.passwordHash exists', action: 'journaliser' });

    const rules = new RuleLoader().loadFromDirectory(tmpDir);
    expect(rules).toHaveLength(1);
    expect(referencesResponse(rules[0].conditionAst)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('treats a negated response condition as response-phase', () => {
    const tmpDir = makeTmpDir();
    writeRule(tmpDir, { condition: 'not (response.passwordHash exists)', action: 'journaliser' });

    const rules = new RuleLoader().loadFromDirectory(tmpDir);
    expect(referencesResponse(rules[0].conditionAst)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('accepts a pure request-phase or-condition with action bloquer', () => {
    const tmpDir = makeTmpDir();
    writeRule(tmpDir, { condition: 'body.role exists or body.isAdmin exists', action: 'bloquer' });

    const rules = new RuleLoader().loadFromDirectory(tmpDir);
    expect(rules).toHaveLength(1);
    expect(rules[0].conditionAst.kind).toBe('or');
    expect(referencesResponse(rules[0].conditionAst)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
