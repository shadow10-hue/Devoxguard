import { DslSyntaxError, tokenize } from './tokenizer';
import { parse } from './parser';

describe('parse', () => {
  it('case 1: "params.id not in user.ownedResourceIds.orders" -> single not-in node', () => {
    const ast = parse(tokenize('params.id not in user.ownedResourceIds.orders'));

    expect(ast).toEqual({
      kind: 'not-in',
      left: { kind: 'path', segments: ['params', 'id'] },
      right: { kind: 'path', segments: ['user', 'ownedResourceIds', 'orders'] },
    });
  });

  it('case 2: "body.role exists"', () => {
    const ast = parse(tokenize('body.role exists'));

    expect(ast).toEqual({
      kind: 'exists',
      path: { kind: 'path', segments: ['body', 'role'] },
    });
  });

  it('case 3: \'query.limit == "50"\'', () => {
    const ast = parse(tokenize('query.limit == "50"'));

    expect(ast).toEqual({
      kind: 'comparison',
      left: { kind: 'path', segments: ['query', 'limit'] },
      operator: '==',
      right: { kind: 'literal', value: '50' },
    });
  });

  it('case 4: two operators in a row throws DslSyntaxError', () => {
    expect(() => parse(tokenize('body.age == != 18'))).toThrow(DslSyntaxError);
  });

  it('plain "in" fuses to an in node (not not-in)', () => {
    const ast = parse(tokenize('params.id in user.ownedResourceIds.orders'));
    expect(ast.kind).toBe('in');
  });

  it('throws when the condition does not start with a path', () => {
    expect(() => parse(tokenize('== "50"'))).toThrow(DslSyntaxError);
  });

  it('throws on trailing tokens after a complete expression', () => {
    expect(() => parse(tokenize('body.role exists exists'))).toThrow(DslSyntaxError);
  });

  describe('boolean composition', () => {
    const cmp = (path: string[], value: number) => ({
      kind: 'comparison',
      left: { kind: 'path', segments: path },
      operator: '==',
      right: { kind: 'literal', value },
    });

    it('"and" binds tighter than "or"', () => {
      const ast = parse(tokenize('body.a == 1 or body.b == 2 and body.c == 3'));

      expect(ast).toEqual({
        kind: 'or',
        left: cmp(['body', 'a'], 1),
        right: {
          kind: 'and',
          left: cmp(['body', 'b'], 2),
          right: cmp(['body', 'c'], 3),
        },
      });
    });

    it('parentheses override precedence', () => {
      const ast = parse(tokenize('(body.a == 1 or body.b == 2) and body.c == 3'));

      expect(ast).toEqual({
        kind: 'and',
        left: {
          kind: 'or',
          left: cmp(['body', 'a'], 1),
          right: cmp(['body', 'b'], 2),
        },
        right: cmp(['body', 'c'], 3),
      });
    });

    it('chains of the same operator fold left-associative', () => {
      const ast = parse(tokenize('body.a == 1 and body.b == 2 and body.c == 3'));

      expect(ast).toEqual({
        kind: 'and',
        left: {
          kind: 'and',
          left: cmp(['body', 'a'], 1),
          right: cmp(['body', 'b'], 2),
        },
        right: cmp(['body', 'c'], 3),
      });
    });

    it('prefix "not" binds tighter than "and"', () => {
      const ast = parse(tokenize('not body.a exists and body.b exists'));

      expect(ast).toEqual({
        kind: 'and',
        left: { kind: 'not', operand: { kind: 'exists', path: { kind: 'path', segments: ['body', 'a'] } } },
        right: { kind: 'exists', path: { kind: 'path', segments: ['body', 'b'] } },
      });
    });

    it('"not" nests ("not not x") and applies to parenthesized groups', () => {
      expect(parse(tokenize('not not body.a exists'))).toEqual({
        kind: 'not',
        operand: { kind: 'not', operand: { kind: 'exists', path: { kind: 'path', segments: ['body', 'a'] } } },
      });
      expect(parse(tokenize('not (body.a exists or body.b exists)'))).toMatchObject({
        kind: 'not',
        operand: { kind: 'or' },
      });
    });

    it('a lone simple condition still parses to a bare node (backward compat)', () => {
      expect(parse(tokenize('body.role exists')).kind).toBe('exists');
      expect(parse(tokenize('body.a not in user.x')).kind).toBe('not-in');
    });

    it('throws on a dangling binary operator', () => {
      expect(() => parse(tokenize('body.a exists and'))).toThrow(DslSyntaxError);
      expect(() => parse(tokenize('body.a exists or'))).toThrow(DslSyntaxError);
    });

    it('throws on a leading binary operator', () => {
      expect(() => parse(tokenize('and body.a exists'))).toThrow(DslSyntaxError);
    });

    it('throws on unbalanced parentheses', () => {
      expect(() => parse(tokenize('(body.a exists'))).toThrow(`Expected ')' to close '('`);
      expect(() => parse(tokenize('body.a exists)'))).toThrow(`Unexpected token ')' after expression`);
    });

    it('throws on empty parentheses', () => {
      expect(() => parse(tokenize('()'))).toThrow(DslSyntaxError);
    });

    it('throws on "not" with nothing after it', () => {
      expect(() => parse(tokenize('not'))).toThrow(`Unexpected end of condition after 'not'`);
    });

    it('throws when parenthesized nesting exceeds 16 levels', () => {
      const deep = (n: number) => '('.repeat(n) + 'body.a exists' + ')'.repeat(n);
      expect(parse(tokenize(deep(16))).kind).toBe('exists');
      expect(() => parse(tokenize(deep(17)))).toThrow('Condition nesting too deep (max 16 levels of parentheses)');
    });
  });
});
