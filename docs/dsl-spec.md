# DevoxGuard — DSL Specification

The rule DSL is hand-rolled (no `eval()`, `new Function()`, or `vm.runInContext`) across four stages: tokenizer → parser → AST → evaluator.

## 1. Rule file format (YAML)

Each YAML file under a rules directory (e.g. `packages/engine/src/rules/default-rules/`) contains an array of rule definitions:

```yaml
- nom: "idor-orders"
  route: "/orders/:id"
  methode: GET
  condition: "params.id not in user.ownedResourceIds.orders"
  action: bloquer
  severite: haute
```

| Field | Type | Notes |
|---|---|---|
| `nom` | string | Rule name, shown in the dashboard and `Finding.ruleName` |
| `route` | string | Route pattern, matched exactly against `RequestContext.route` (e.g. `/orders/:id`, not `/orders/42`) |
| `methode` | string | HTTP method, matched case-insensitively against `RequestContext.method` |
| `condition` | string | A condition expression (grammar below); may combine sub-conditions with `and` / `or` / `not` and parentheses |
| `action` | `bloquer` \| `journaliser` | `bloquer` → decision `block` if triggered; `journaliser` → logged only. Response-phase rules (any `response.*` reference in the condition) can only use `journaliser` — rejected at load time otherwise. |
| `severite` | `basse` \| `moyenne` \| `haute` | Translated to the `Severity` enum (`low`/`medium`/`high`) at compile time |

## 2. Condition grammar

```
expression      := disjonction
disjonction     := conjonction ("or" conjonction)*     // "or" = lowest precedence, left-associative
conjonction     := negation ("and" negation)*          // "and" binds tighter than "or"
negation        := "not" negation | terme              // prefix "not" binds tighter than "and"
terme           := "(" disjonction ")"
                 | comparaison
comparaison     := chemin operateur valeur
                 | chemin ("in" | "not in") liste
                 | chemin "exists"
chemin          := identifiant ("." identifiant)*      // e.g. body.role, params.id
operateur       := "==" | "!="
valeur          := chaine | nombre | booleen
liste           := chemin                              // reference to an array in the context, e.g. user.ownedResourceIds.orders
identifiant     := [a-zA-Z_][a-zA-Z0-9_]*
```

Path roots: `body`, `params`, `query`, `user` (the authenticated user), `response` (the handler's response body, only populated after the route handler resolves).

Boolean composition:

- `or` binds loosest, `and` tighter, prefix `not` tightest; both binary operators are left-associative. Parentheses override precedence. Examples: `body.role exists or body.isAdmin exists`, `(body.role == "admin" or body.role == "root") and not (params.id in user.ownedResourceIds.orders)`.
- `and`, `or` are reserved keywords like `not`/`in`/`exists` — as bare words only. Inside a dotted path they stay part of the identifier (`body.and` is a valid path).
- `not` directly after a path is still the `not in` operator; at the start of a term it is prefix negation.
- Parenthesized nesting is capped at **16 levels** — deeper conditions are rejected at parse time.

Phase splitting: a condition that references `response.*` **anywhere** in its tree (including inside `and`/`or`/`not`) makes the whole rule response-phase — it is evaluated after the handler resolves, when the request buckets (`body`, `params`, …) are still available. Since the response is already sent at that point, such a rule (mixed or not) cannot use `action: bloquer`.

## 3. Tokenizer (`dsl/tokenizer.ts`)

`tokenize(expr: string): Token[]`, token types `IDENTIFIER | DOT | OPERATOR | STRING | NUMBER | KEYWORD | LPAREN | RPAREN`.

- A dotted path (`body.role`, `user.ownedResourceIds.orders`) scans as a **single `IDENTIFIER` token** containing the dots, not separate `IDENTIFIER`/`DOT` tokens — `DOT` stays in the type union for signature completeness but is effectively unused.
- `not`, `in`, `exists`, `and`, `or` scan as separate `KEYWORD` tokens (the tokenizer does not special-case the two-word `not in` sequence).
- `(` and `)` scan as `LPAREN`/`RPAREN` single-character tokens.
- A dot not followed by a valid identifier start throws `DslSyntaxError` at the offending character's exact position (not the dot's position).
- String literals use double quotes (`"50"`); numbers are unquoted digit sequences with an optional decimal part.

## 4. Parser (`dsl/parser.ts`)

`parse(tokens: Token[]): ConditionNode`, throws `DslSyntaxError` on malformed input (wrong token where a path/operator/value is expected, unexpected trailing tokens, a dangling or leading `and`/`or`, unbalanced or empty parentheses, or nesting deeper than 16 levels of parentheses).

Recursive descent following the grammar above: `parseDisjunction` → `parseConjunction` → `parsePrimary` (prefix `not` / parenthesized group / simple comparison). Chains of the same binary operator fold **left-associative** (`a and b and c` = `(a and b) and c`).

The parser fuses the tokenizer's two-token `KEYWORD(not)` + `KEYWORD(in)` sequence *after a path* into a single `InNode { kind: 'not-in' }`; a `not` at the start of a term instead produces a `NotNode` (prefix negation). A bare `in` produces `InNode { kind: 'in' }`.

Boolean literals (`true`/`false`) have no dedicated token type — the parser accepts an `IDENTIFIER` token whose value is exactly `"true"` or `"false"` as a boolean literal in a comparison's right-hand side.

## 5. AST (`dsl/ast.ts`)

```typescript
export type ConditionNode = ComparisonNode | ExistsNode | InNode | LogicalNode | NotNode;

export interface LogicalNode {
  kind: 'and' | 'or';
  left: ConditionNode;
  right: ConditionNode;
}

export interface NotNode {
  kind: 'not';
  operand: ConditionNode;
}

export interface PathNode {
  kind: 'path';
  segments: string[];
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
  right: PathNode;
}
```

## 6. Evaluator (`dsl/evaluator.ts`)

`evaluate(node: ConditionNode, context: RequestContext): boolean`. Path resolution (`resolvePath`) is **manual segment-by-segment property lookup** — never `eval()`/`new Function()`. Missing intermediate values resolve to `undefined` rather than throwing (a path like `user.ownedResourceIds.orders` on an unauthenticated request, where `user` is `null`, resolves cleanly to `undefined`).

`and`/`or` nodes evaluate recursively left-to-right with **short-circuit** semantics (the right subtree is not visited when the left side decides the result); `not` inverts its operand.

## 7. Rule loading and hot-reload (`rule-loader.ts`)

`RuleLoader.loadFromDirectory(dirPath)` reads every `.yml`/`.yaml` file in a directory, parses the YAML structure with `js-yaml` (structural parsing only — the *condition expressions* inside are always parsed by the hand-rolled tokenizer/parser above, never by `js-yaml` or any general-purpose expression evaluator), and compiles each entry into a `CompiledRule` (adds `conditionAst` and keeps the original `condition` string as `raw` for display in the dashboard's Rules view).

`RuleLoader.watch(dirPath, onChange)` uses a debounced `fs.watch` (some platforms fire multiple change events per single file write) to reload the directory and invoke `onChange` with the new `CompiledRule[]`. A malformed rule file during a hot-reload attempt is logged and the previous rule set stays active — hot-reload failures never crash the watcher or leave the app with no rules loaded.

`RuleRegistry` holds the live `CompiledRule[]` as a mutable singleton that both the guard's rule matching and the dashboard's `GET /devoxguard/api/rules` endpoint read from, so a hot-reload takes effect immediately without restarting the host application.
