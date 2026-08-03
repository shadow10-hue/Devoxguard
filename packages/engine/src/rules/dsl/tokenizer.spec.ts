import { DslSyntaxError, tokenize } from './tokenizer';

describe('tokenize', () => {
  it('case 1: "params.id not in user.ownedResourceIds.orders"', () => {
    const tokens = tokenize('params.id not in user.ownedResourceIds.orders');

    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'params.id'],
      ['KEYWORD', 'not'],
      ['KEYWORD', 'in'],
      ['IDENTIFIER', 'user.ownedResourceIds.orders'],
    ]);
  });

  it('case 2: "body.role exists"', () => {
    const tokens = tokenize('body.role exists');

    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'body.role'],
      ['KEYWORD', 'exists'],
    ]);
  });

  it('case 3: \'query.limit == "50"\'', () => {
    const tokens = tokenize('query.limit == "50"');

    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'query.limit'],
      ['OPERATOR', '=='],
      ['STRING', '50'],
    ]);
  });

  it('case 4: "body.age != 18"', () => {
    const tokens = tokenize('body.age != 18');

    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['IDENTIFIER', 'body.age'],
      ['OPERATOR', '!='],
      ['NUMBER', '18'],
    ]);
  });

  it('case 5: "body.@invalid exists" throws DslSyntaxError at the position of "@"', () => {
    expect(() => tokenize('body.@invalid exists')).toThrow(DslSyntaxError);
    try {
      tokenize('body.@invalid exists');
      fail('expected tokenize to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(DslSyntaxError);
      expect((err as DslSyntaxError).position).toBe(5);
    }
  });
});
