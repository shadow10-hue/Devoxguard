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
});
