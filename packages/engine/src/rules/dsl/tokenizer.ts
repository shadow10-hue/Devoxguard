export type TokenType =
  | 'IDENTIFIER'
  | 'DOT'
  | 'OPERATOR'
  | 'STRING'
  | 'NUMBER'
  | 'KEYWORD'
  | 'LPAREN'
  | 'RPAREN';

export interface Token {
  type: TokenType;
  value: string;
  position: number;
}

export class DslSyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number,
  ) {
    super(message);
    this.name = 'DslSyntaxError';
  }
}

const KEYWORDS = new Set(['not', 'in', 'exists', 'and', 'or']);

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z_]/.test(ch);
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[a-zA-Z0-9_]/.test(ch);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[0-9]/.test(ch);
}

/** Consumes one `[a-zA-Z_][a-zA-Z0-9_]*` segment starting at `start`, returns the index after it. */
function scanSegment(expr: string, start: number): number {
  let i = start + 1;
  while (isIdentChar(expr[i])) i += 1;
  return i;
}

/**
 * Scans a dotted path (`body.role`) or a bare keyword (`not`, `in`,
 * `exists`) as a single token, per the grammar's `chemin := identifiant
 * ("." identifiant)*`. A dot not followed by a valid identifier start
 * throws at the offending character's position.
 */
function scanIdentifierOrKeyword(expr: string, start: number): { token: Token; next: number } {
  let i = scanSegment(expr, start);

  while (expr[i] === '.') {
    const nextStart = i + 1;
    if (!isIdentStart(expr[nextStart])) {
      throw new DslSyntaxError(
        `Unexpected character '${expr[nextStart] ?? '<end of input>'}' in path`,
        nextStart,
      );
    }
    i = scanSegment(expr, nextStart);
  }

  const value = expr.slice(start, i);
  const type: TokenType = KEYWORDS.has(value) ? 'KEYWORD' : 'IDENTIFIER';
  return { token: { type, value, position: start }, next: i };
}

function scanNumber(expr: string, start: number): { token: Token; next: number } {
  let i = start;
  while (isDigit(expr[i])) i += 1;
  if (expr[i] === '.' && isDigit(expr[i + 1])) {
    i += 1;
    while (isDigit(expr[i])) i += 1;
  }
  return { token: { type: 'NUMBER', value: expr.slice(start, i), position: start }, next: i };
}

function scanString(expr: string, start: number): { token: Token; next: number } {
  let i = start + 1;
  while (i < expr.length && expr[i] !== '"') i += 1;
  if (i >= expr.length) {
    throw new DslSyntaxError('Unterminated string literal', start);
  }
  return { token: { type: 'STRING', value: expr.slice(start + 1, i), position: start }, next: i + 1 };
}

export function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (isIdentStart(ch)) {
      const { token, next } = scanIdentifierOrKeyword(expr, i);
      tokens.push(token);
      i = next;
      continue;
    }

    if (isDigit(ch)) {
      const { token, next } = scanNumber(expr, i);
      tokens.push(token);
      i = next;
      continue;
    }

    if (ch === '"') {
      const { token, next } = scanString(expr, i);
      tokens.push(token);
      i = next;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', position: i });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', position: i });
      i += 1;
      continue;
    }

    if (ch === '=' && expr[i + 1] === '=') {
      tokens.push({ type: 'OPERATOR', value: '==', position: i });
      i += 2;
      continue;
    }

    if (ch === '!' && expr[i + 1] === '=') {
      tokens.push({ type: 'OPERATOR', value: '!=', position: i });
      i += 2;
      continue;
    }

    throw new DslSyntaxError(`Unexpected character '${ch}'`, i);
  }

  return tokens;
}
