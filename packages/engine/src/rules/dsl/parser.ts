import { DslSyntaxError, Token } from './tokenizer';
import { ComparisonNode, ConditionNode, ExistsNode, InNode, PathNode } from './ast';

function toPath(token: Token): PathNode {
  return { kind: 'path', segments: token.value.split('.') };
}

function parseLiteral(token: Token): { kind: 'literal'; value: string | number | boolean } {
  if (token.type === 'STRING') return { kind: 'literal', value: token.value };
  if (token.type === 'NUMBER') return { kind: 'literal', value: Number(token.value) };
  if (token.type === 'IDENTIFIER' && (token.value === 'true' || token.value === 'false')) {
    return { kind: 'literal', value: token.value === 'true' };
  }
  throw new DslSyntaxError(`Expected a literal value, got '${token.value}'`, token.position);
}

/**
 * Parses a single `expression := comparaison` per the condition grammar
 * (spec section 3.2). `not` + `in` (two KEYWORD tokens from the
 * tokenizer) are fused here into a single InNode{kind:'not-in'}.
 */
export function parse(tokens: Token[]): ConditionNode {
  if (tokens.length === 0) {
    throw new DslSyntaxError('Empty condition', 0);
  }

  let i = 0;
  const pathToken = tokens[i];
  if (pathToken.type !== 'IDENTIFIER') {
    throw new DslSyntaxError(
      `Expected a path at the start of the condition, got '${pathToken.value}'`,
      pathToken.position,
    );
  }
  const left = toPath(pathToken);
  i += 1;

  const opToken = tokens[i];
  if (!opToken) {
    throw new DslSyntaxError(
      'Unexpected end of condition after path',
      pathToken.position + pathToken.value.length,
    );
  }

  let node: ConditionNode;

  if (opToken.type === 'KEYWORD' && opToken.value === 'exists') {
    node = { kind: 'exists', path: left } satisfies ExistsNode;
    i += 1;
  } else if (opToken.type === 'KEYWORD' && opToken.value === 'in') {
    i += 1;
    const rightToken = tokens[i];
    if (!rightToken || rightToken.type !== 'IDENTIFIER') {
      throw new DslSyntaxError(`Expected a path after 'in'`, rightToken?.position ?? opToken.position + opToken.value.length);
    }
    node = { kind: 'in', left, right: toPath(rightToken) } satisfies InNode;
    i += 1;
  } else if (opToken.type === 'KEYWORD' && opToken.value === 'not') {
    i += 1;
    const inToken = tokens[i];
    if (!inToken || inToken.type !== 'KEYWORD' || inToken.value !== 'in') {
      throw new DslSyntaxError(`Expected 'in' after 'not'`, inToken?.position ?? opToken.position + opToken.value.length);
    }
    i += 1;
    const rightToken = tokens[i];
    if (!rightToken || rightToken.type !== 'IDENTIFIER') {
      throw new DslSyntaxError(`Expected a path after 'not in'`, rightToken?.position ?? inToken.position + inToken.value.length);
    }
    node = { kind: 'not-in', left, right: toPath(rightToken) } satisfies InNode;
    i += 1;
  } else if (opToken.type === 'OPERATOR' && (opToken.value === '==' || opToken.value === '!=')) {
    i += 1;
    const valueToken = tokens[i];
    if (!valueToken) {
      throw new DslSyntaxError(`Expected a value after '${opToken.value}'`, opToken.position + opToken.value.length);
    }
    const literal = parseLiteral(valueToken);
    node = { kind: 'comparison', left, operator: opToken.value, right: literal } satisfies ComparisonNode;
    i += 1;
  } else {
    throw new DslSyntaxError(`Unexpected token '${opToken.value}'`, opToken.position);
  }

  const trailing = tokens[i];
  if (trailing) {
    throw new DslSyntaxError(`Unexpected token '${trailing.value}' after expression`, trailing.position);
  }

  return node;
}
