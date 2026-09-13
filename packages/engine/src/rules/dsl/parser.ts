import { DslSyntaxError, Token } from './tokenizer';
import { ComparisonNode, ConditionNode, ExistsNode, InNode, NotNode, PathNode } from './ast';

const MAX_PAREN_DEPTH = 16;

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
 * Recursive-descent parser over the condition grammar (spec section 3.2):
 *
 *   expression  := disjonction
 *   disjonction := conjonction ("or" conjonction)*
 *   conjonction := negation ("and" negation)*
 *   negation    := "not" negation | terme
 *   terme       := "(" disjonction ")" | comparaison
 *
 * `or` binds loosest, then `and`, then prefix `not`; both binary operators
 * are left-associative. `not` + `in` after a path (two KEYWORD tokens from
 * the tokenizer) are still fused into a single InNode{kind:'not-in'};
 * `not` at the start of a term is prefix negation. Parenthesized nesting
 * is capped at MAX_PAREN_DEPTH to keep stack depth and errors sane.
 */
export function parse(tokens: Token[]): ConditionNode {
  if (tokens.length === 0) {
    throw new DslSyntaxError('Empty condition', 0);
  }

  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token => tokens[pos++];
  const isKeyword = (token: Token | undefined, value: string): boolean =>
    token !== undefined && token.type === 'KEYWORD' && token.value === value;

  function parseSimple(): ConditionNode {
    const pathToken = next();
    if (pathToken.type !== 'IDENTIFIER') {
      throw new DslSyntaxError(
        `Expected a path at the start of the condition, got '${pathToken.value}'`,
        pathToken.position,
      );
    }
    const left = toPath(pathToken);

    const opToken = peek();
    if (!opToken) {
      throw new DslSyntaxError(
        'Unexpected end of condition after path',
        pathToken.position + pathToken.value.length,
      );
    }

    if (isKeyword(opToken, 'exists')) {
      next();
      return { kind: 'exists', path: left } satisfies ExistsNode;
    }

    if (isKeyword(opToken, 'in')) {
      next();
      const rightToken = peek();
      if (!rightToken || rightToken.type !== 'IDENTIFIER') {
        throw new DslSyntaxError(`Expected a path after 'in'`, rightToken?.position ?? opToken.position + opToken.value.length);
      }
      next();
      return { kind: 'in', left, right: toPath(rightToken) } satisfies InNode;
    }

    if (isKeyword(opToken, 'not')) {
      next();
      const inToken = peek();
      if (!inToken || !isKeyword(inToken, 'in')) {
        throw new DslSyntaxError(`Expected 'in' after 'not'`, inToken?.position ?? opToken.position + opToken.value.length);
      }
      next();
      const rightToken = peek();
      if (!rightToken || rightToken.type !== 'IDENTIFIER') {
        throw new DslSyntaxError(`Expected a path after 'not in'`, rightToken?.position ?? inToken.position + inToken.value.length);
      }
      next();
      return { kind: 'not-in', left, right: toPath(rightToken) } satisfies InNode;
    }

    if (opToken.type === 'OPERATOR' && (opToken.value === '==' || opToken.value === '!=')) {
      next();
      const valueToken = peek();
      if (!valueToken) {
        throw new DslSyntaxError(`Expected a value after '${opToken.value}'`, opToken.position + opToken.value.length);
      }
      next();
      const literal = parseLiteral(valueToken);
      return { kind: 'comparison', left, operator: opToken.value, right: literal } satisfies ComparisonNode;
    }

    throw new DslSyntaxError(`Unexpected token '${opToken.value}'`, opToken.position);
  }

  function parsePrimary(depth: number): ConditionNode {
    const token = peek();

    if (isKeyword(token, 'not')) {
      const notToken = next();
      if (!peek()) {
        throw new DslSyntaxError(
          `Unexpected end of condition after 'not'`,
          notToken.position + notToken.value.length,
        );
      }
      return { kind: 'not', operand: parsePrimary(depth) } satisfies NotNode;
    }

    if (token?.type === 'LPAREN') {
      const openToken = next();
      if (depth + 1 > MAX_PAREN_DEPTH) {
        throw new DslSyntaxError(
          `Condition nesting too deep (max ${MAX_PAREN_DEPTH} levels of parentheses)`,
          openToken.position,
        );
      }
      if (peek()?.type === 'RPAREN') {
        throw new DslSyntaxError(`Empty parentheses`, openToken.position);
      }
      const inner = parseDisjunction(depth + 1);
      const closeToken = peek();
      if (!closeToken || closeToken.type !== 'RPAREN') {
        throw new DslSyntaxError(
          `Expected ')' to close '('`,
          closeToken?.position ?? openToken.position + 1,
        );
      }
      next();
      return inner;
    }

    return parseSimple();
  }

  function parseConjunction(depth: number): ConditionNode {
    let node = parsePrimary(depth);
    while (isKeyword(peek(), 'and')) {
      const opToken = next();
      if (!peek()) {
        throw new DslSyntaxError(
          `Unexpected end of condition after 'and'`,
          opToken.position + opToken.value.length,
        );
      }
      node = { kind: 'and', left: node, right: parsePrimary(depth) };
    }
    return node;
  }

  function parseDisjunction(depth: number): ConditionNode {
    let node = parseConjunction(depth);
    while (isKeyword(peek(), 'or')) {
      const opToken = next();
      if (!peek()) {
        throw new DslSyntaxError(
          `Unexpected end of condition after 'or'`,
          opToken.position + opToken.value.length,
        );
      }
      node = { kind: 'or', left: node, right: parseConjunction(depth) };
    }
    return node;
  }

  const node = parseDisjunction(0);

  const trailing = peek();
  if (trailing) {
    throw new DslSyntaxError(`Unexpected token '${trailing.value}' after expression`, trailing.position);
  }

  return node;
}
