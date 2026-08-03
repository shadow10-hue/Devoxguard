import { ConditionNode, PathNode } from './ast';
import { RequestContext } from '../../analysis/request-context';

function resolvePath(path: PathNode, context: RequestContext): unknown {
  const root = path.segments[0];
  const source: Record<string, unknown> =
    root === 'body' ? (context.body ?? {}) :
    root === 'params' ? context.params :
    root === 'query' ? context.query :
    root === 'user' ? ((context.authenticatedUser as unknown as Record<string, unknown>) ?? {}) :
    root === 'response' ? ((context.responseBody as Record<string, unknown>) ?? {}) :
    {};

  let current: unknown = source;
  for (const segment of path.segments.slice(1)) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function evaluate(node: ConditionNode, context: RequestContext): boolean {
  switch (node.kind) {
    case 'exists':
      return resolvePath(node.path, context) !== undefined;
    case 'comparison': {
      const actual = resolvePath(node.left, context);
      const expected = node.right.value;
      return node.operator === '==' ? actual == expected : actual != expected;
    }
    case 'in':
    case 'not-in': {
      const value = resolvePath(node.left, context);
      const list = resolvePath(node.right, context);
      const isIn = Array.isArray(list) && list.includes(value);
      return node.kind === 'in' ? isIn : !isIn;
    }
  }
}
