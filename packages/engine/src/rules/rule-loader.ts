import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ConditionNode } from './dsl/ast';
import { parse } from './dsl/parser';
import { tokenize } from './dsl/tokenizer';
import { CompiledRule, RawRuleDefinition } from './rule.types';

export class RuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleValidationError';
  }
}

const SEVERITY_MAP: Record<RawRuleDefinition['severite'], CompiledRule['severite']> = {
  basse: 'low',
  moyenne: 'medium',
  haute: 'high',
};

/** Whether a compiled condition reads from the response.* root — used to split rules into request-phase vs response-phase (see guard/devoxguard.guard.ts). */
export function referencesResponse(node: ConditionNode): boolean {
  switch (node.kind) {
    case 'exists':
      return node.path.segments[0] === 'response';
    case 'comparison':
      return node.left.segments[0] === 'response';
    case 'in':
    case 'not-in':
      return node.left.segments[0] === 'response' || node.right.segments[0] === 'response';
  }
}

function compileRule(raw: RawRuleDefinition, sourceFile: string): CompiledRule {
  if (!raw || typeof raw.condition !== 'string') {
    throw new RuleValidationError(`Malformed rule entry in '${sourceFile}': missing 'condition'`);
  }

  const conditionAst = parse(tokenize(raw.condition));

  // Response-phase rules evaluate after the handler already sent the
  // response body, so they can never block — only 'journaliser' is valid.
  if (raw.action === 'bloquer' && referencesResponse(conditionAst)) {
    throw new RuleValidationError(
      `Rule '${raw.nom}' in '${sourceFile}' references response.* with action 'bloquer'; ` +
        `response-phase rules can only use action 'journaliser'`,
    );
  }

  return {
    nom: raw.nom,
    route: raw.route,
    methode: raw.methode,
    conditionAst,
    action: raw.action,
    severite: SEVERITY_MAP[raw.severite],
    raw: raw.condition,
  };
}

export class RuleLoader {
  private watcher: fs.FSWatcher | null = null;

  loadFromDirectory(dirPath: string): CompiledRule[] {
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
      .sort();

    const rules: CompiledRule[] = [];
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const parsed = yaml.load(content);

      if (!Array.isArray(parsed)) {
        throw new RuleValidationError(`Rule file '${file}' must contain a YAML array of rules`);
      }

      for (const entry of parsed as RawRuleDefinition[]) {
        rules.push(compileRule(entry, file));
      }
    }
    return rules;
  }

  /**
   * Watches `dirPath` for changes and re-runs loadFromDirectory on each
   * change, debounced since fs.watch can fire multiple events for a
   * single file write. A malformed rule file during hot-reload is
   * logged and ignored rather than crashing the watcher.
   */
  watch(dirPath: string, onChange: (rules: CompiledRule[]) => void): void {
    let debounceTimer: NodeJS.Timeout | null = null;

    this.watcher = fs.watch(dirPath, { persistent: false }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        try {
          onChange(this.loadFromDirectory(dirPath));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[DevoxGuard] Failed to hot-reload rules:', err);
        }
      }, 50);
    });
  }

  close(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
