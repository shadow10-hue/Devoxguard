export type ConditionNode = ComparisonNode | ExistsNode | InNode | LogicalNode | NotNode;

export interface PathNode {
  kind: 'path';
  segments: string[]; // ex: ["body", "role"]
}

export interface ComparisonNode {
  kind: 'comparison';
  left: PathNode;
  operator: '==' | '!=';
  right: { kind: 'literal'; value: string | number | boolean };
}

export interface ExistsNode {
  kind: 'exists';
  path: PathNode;
}

export interface InNode {
  kind: 'in' | 'not-in';
  left: PathNode;
  right: PathNode; // référence à un tableau du contexte
}

export interface LogicalNode {
  kind: 'and' | 'or';
  left: ConditionNode;
  right: ConditionNode;
}

export interface NotNode {
  kind: 'not';
  operand: ConditionNode;
}
