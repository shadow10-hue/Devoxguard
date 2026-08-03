import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuleLoader, RuleValidationError } from './rule-loader';

const DEFAULT_RULES_DIR = path.join(__dirname, 'default-rules');

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'devoxguard-rules-'));
}

describe('RuleLoader.loadFromDirectory', () => {
  it('loads and compiles the default rule set (happy path)', () => {
    const loader = new RuleLoader();
    const rules = loader.loadFromDirectory(DEFAULT_RULES_DIR);

    expect(rules).toHaveLength(4);
    expect(rules.map((r) => r.nom)).toEqual(
      expect.arrayContaining([
        'idor-orders',
        'mass-assignment-users-role',
        'mass-assignment-users-isAdmin',
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
});
