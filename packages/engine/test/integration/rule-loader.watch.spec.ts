import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RuleLoader } from '../../src/rules/rule-loader';
import { CompiledRule } from '../../src/rules/rule.types';

const SEED_RULE = [
  '- nom: "seed-rule"',
  '  route: "/orders/:id"',
  '  methode: GET',
  '  condition: "params.id not in user.ownedResourceIds.orders"',
  '  action: bloquer',
  '  severite: haute',
  '',
].join('\n');

const UPDATED_RULE = [
  '- nom: "seed-rule"',
  '  route: "/orders/:id"',
  '  methode: GET',
  '  condition: "params.id not in user.ownedResourceIds.orders"',
  '  action: bloquer',
  '  severite: haute',
  '',
  '- nom: "added-rule"',
  '  route: "/reviews"',
  '  methode: POST',
  '  condition: "body.rating exists"',
  '  action: journaliser',
  '  severite: basse',
  '',
].join('\n');

describe('RuleLoader hot reload (fs.watch integration)', () => {
  jest.setTimeout(10_000);

  let tmpDir: string;
  let ruleFile: string;
  let loader: RuleLoader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devoxguard-watch-'));
    ruleFile = path.join(tmpDir, 'rules.yml');
    fs.writeFileSync(ruleFile, SEED_RULE);
    loader = new RuleLoader();
  });

  afterEach(() => {
    loader.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reflects a rule file change without restarting the process', async () => {
    const initial = loader.loadFromDirectory(tmpDir);
    expect(initial.map((r) => r.nom)).toEqual(['seed-rule']);

    const onChange = new Promise<CompiledRule[]>((resolve) => {
      loader.watch(tmpDir, (rules) => resolve(rules));
    });

    // Give fs.watch a moment to attach before mutating the file.
    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.writeFileSync(ruleFile, UPDATED_RULE);

    const reloaded = await onChange;
    expect(reloaded.map((r) => r.nom).sort()).toEqual(['added-rule', 'seed-rule']);
  });
});
