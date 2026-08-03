import { ConditionNode } from './dsl/ast';
import { Severity } from '../storage/finding.schema';

export interface CompiledRule {
  nom: string;
  route: string;
  methode: string;
  conditionAst: ConditionNode;
  action: 'bloquer' | 'journaliser';
  severite: Severity;
  /** Original condition text as written in the YAML source, for display in the dashboard's RulesView. */
  raw: string;
}

export interface RawRuleDefinition {
  nom: string;
  route: string;
  methode: string;
  condition: string;
  action: 'bloquer' | 'journaliser';
  severite: 'basse' | 'moyenne' | 'haute';
}
