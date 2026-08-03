# DevoxGuard — Spécification technique d'implémentation (v2 — ultra-détaillée)

> Version enrichie du brief pour Claude Code : commandes exactes, `package.json` complets, squelettes de code par fichier, tables de cas de test (entrée → sortie attendue), fichiers YAML entièrement rédigés, mappings ElasticSearch et schémas MongoDB complets. À utiliser à la place de la v1 — cette version est exécutable sans avoir à deviner un seul paramètre.

---

## 0. Principes non négociables (rappel renforcé)

- Interdiction absolue : `eval()`, `new Function()`, `vm.runInContext`, toute bibliothèque de sécurité (helmet est autorisé uniquement pour les headers HTTP standards, pas pour la logique métier), toute bibliothèque de ML (`scikit-learn`, `tensorflow`, `brain.js`, `ml.js`).
- Autorisé : `@nestjs/*`, `vue`, `mongodb` (driver natif, pas Mongoose sauf si Claude Code juge la validation de schéma utile — dans ce cas documenter le choix), `@elastic/elasticsearch`, `jest`, `ts-jest`, `autocannon`, `uuid`, `js-yaml` (pour le parsing YAML *structurel* uniquement — le parsing des *expressions de condition* doit rester fait main, voir section 4).
- Chaque fichier de code produit doit être accompagné d'au moins un fichier de test dans le même commit.

---

## 1. Commandes de scaffolding exactes

```bash
mkdir devoxguard && cd devoxguard
npm init -y -w packages/engine -w packages/api-demo -w packages/dashboard
# Configurer le champ "workspaces": ["packages/*"] dans le package.json racine

# --- engine ---
cd packages/engine
npm init -y
npm install --save @nestjs/common @nestjs/core @nestjs/platform-express rxjs reflect-metadata uuid js-yaml mongodb @elastic/elasticsearch
npm install --save-dev typescript ts-node @types/node @types/uuid @types/js-yaml jest ts-jest @types/jest
npx tsc --init --target ES2021 --module commonjs --experimentalDecorators --emitDecoratorMetadata --outDir dist --rootDir src

# --- api-demo ---
cd ../api-demo
npx @nestjs/cli new . --skip-git --package-manager npm
npm install --save ../engine   # dépendance locale au package engine (ou via workspace link)

# --- dashboard ---
cd ../dashboard
npm create vite@latest . -- --template vue-ts
npm install
npm install --save vue-router@4 axios
```

---

## 2. `package.json` — `packages/engine` (contenu exact)

```json
{
  "name": "@devox/engine",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest --coverage",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "rxjs": "^7.8.1",
    "reflect-metadata": "^0.2.2",
    "uuid": "^9.0.1",
    "js-yaml": "^4.1.0",
    "mongodb": "^6.8.0",
    "@elastic/elasticsearch": "^8.15.0"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "ts-node": "^10.9.2",
    "ts-jest": "^29.2.4",
    "jest": "^29.7.0",
    "@types/node": "^20.14.0",
    "@types/uuid": "^9.0.8",
    "@types/js-yaml": "^4.0.9",
    "@types/jest": "^29.5.12"
  }
}
```

---

## 3. Module 1 — `RequestContext` et interception

### 3.1 `request-context.ts` (contenu complet, pas un squelette)

```typescript
export interface AuthenticatedUser {
  id: string;
  ownedResourceIds?: Record<string, string[]>;
}

export interface RequestContext {
  requestId: string;
  timestamp: number;
  route: string;
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  headers: Record<string, string | undefined>;
  authenticatedUser: AuthenticatedUser | null;
  originIp: string;
}

export function buildRequestContext(raw: {
  requestId: string;
  route: string;
  method: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | undefined>;
  originIp: string;
  authenticatedUser: AuthenticatedUser | null;
}): RequestContext {
  return {
    requestId: raw.requestId,
    timestamp: Date.now(),
    route: raw.route,
    method: raw.method.toUpperCase() as RequestContext['method'],
    params: raw.params ?? {},
    query: raw.query ?? {},
    body: (raw.body as Record<string, unknown>) ?? null,
    headers: raw.headers ?? {},
    authenticatedUser: raw.authenticatedUser,
    originIp: raw.originIp,
  };
}
```

### 3.2 `request-analysis.interceptor.ts` (squelette avec logique posée)

```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Observable, tap } from 'rxjs';
import { buildRequestContext, RequestContext } from './request-context';

@Injectable()
export class RequestAnalysisInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const requestId = uuidv4();

    const ctx: RequestContext = buildRequestContext({
      requestId,
      route: req.route?.path ?? req.originalUrl,
      method: req.method,
      params: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
      originIp: req.ip,
      authenticatedUser: req.user ?? null, // TODO(claude-code): brancher sur le vrai mécanisme d'auth une fois défini
    });

    req.devoxGuardContext = ctx; // attaché à la requête pour être lu par le Guard en aval

    return next.handle().pipe(
      tap((responseBody) => {
        req.devoxGuardResponseBody = responseBody; // consommé par ResponseAnalysisInterceptor / detectors
      }),
    );
  }
}
```

### 3.3 Table de cas de test — `request-analysis.interceptor.spec.ts`

| # | Entrée (méthode + route + body) | Champ vérifié | Résultat attendu |
|---|---|---|---|
| 1 | `GET /orders/42` | `context.params.id` | `"42"` |
| 2 | `PATCH /users/7` body `{ "name": "Ali" }` | `context.body` | `{ name: "Ali" }` |
| 3 | `POST /reviews` sans body | `context.body` | `null` |
| 4 | Requête sans header `authorization` | `context.authenticatedUser` | `null` |
| 5 | 3 requêtes successives | `context.requestId` | 3 UUID distincts |

---

## 4. Module 2 — DSL de règles (le plus critique, détaillé fichier par fichier)

### 4.1 `dsl/ast.ts` (contenu complet)

```typescript
export type ConditionNode = ComparisonNode | ExistsNode | InNode;

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
```

### 4.2 `dsl/tokenizer.ts` — table de cas de test

| # | Entrée (`condition` brute) | Tokens attendus (types dans l'ordre) |
|---|---|---|
| 1 | `params.id not in user.ownedResourceIds.orders` | `IDENTIFIER(params.id)`, `KEYWORD(not)`, `KEYWORD(in)`, `IDENTIFIER(user.ownedResourceIds.orders)` |
| 2 | `body.role exists` | `IDENTIFIER(body.role)`, `KEYWORD(exists)` |
| 3 | `query.limit == "50"` | `IDENTIFIER(query.limit)`, `OPERATOR(==)`, `STRING(50)` |
| 4 | `body.age != 18` | `IDENTIFIER(body.age)`, `OPERATOR(!=)`, `NUMBER(18)` |
| 5 | `body.@invalid exists` (invalide) | doit lever `DslSyntaxError` avec position du caractère `@` |

Signature exacte :
```typescript
export type TokenType = 'IDENTIFIER' | 'DOT' | 'OPERATOR' | 'STRING' | 'NUMBER' | 'KEYWORD';
export interface Token { type: TokenType; value: string; position: number; }
export function tokenize(expr: string): Token[]; // lève DslSyntaxError si caractère non reconnu
export class DslSyntaxError extends Error {
  constructor(message: string, public readonly position: number) { super(message); }
}
```

### 4.3 `dsl/parser.ts` — table de cas de test

| # | Tokens (issus du tokenizer) | AST attendu (résumé) |
|---|---|---|
| 1 | cas #1 ci-dessus | `{ kind: 'in', left: path(params.id), right: path(user.ownedResourceIds.orders) }` avec négation → en réalité représenté comme `kind: 'not-in'` directement (pas de nœud "not" séparé — le parser doit fusionner `not in` en un seul type de nœud) |
| 2 | cas #2 | `{ kind: 'exists', path: path(body.role) }` |
| 3 | cas #3 | `{ kind: 'comparison', left: path(query.limit), operator: '==', right: { value: "50" } }` |
| 4 | tokens invalides (ex: deux opérateurs à la suite) | lève `DslSyntaxError` |

### 4.4 `dsl/evaluator.ts` (contenu complet — implémentation de référence)

```typescript
import { ConditionNode, PathNode } from './ast';
import { RequestContext } from '../analysis/request-context';

function resolvePath(path: PathNode, context: RequestContext): unknown {
  const root = path.segments[0];
  const source: Record<string, unknown> =
    root === 'body' ? (context.body ?? {}) :
    root === 'params' ? context.params :
    root === 'query' ? context.query :
    root === 'user' ? (context.authenticatedUser as unknown as Record<string, unknown> ?? {}) :
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
```

> Ce fichier peut être livré tel quel par Claude Code — c'est la référence d'implémentation, pas juste une spec. Les tests doivent néanmoins être écrits pour chaque branche du `switch`.

---

## 5. Fichiers YAML des règles par défaut (contenu complet, à créer tels quels)

`packages/engine/src/rules/default-rules/idor-orders.yml`
```yaml
- nom: "idor-orders"
  route: "/orders/:id"
  methode: GET
  condition: "params.id not in user.ownedResourceIds.orders"
  action: bloquer
  severite: haute
```

`packages/engine/src/rules/default-rules/mass-assignment-users.yml`
```yaml
- nom: "mass-assignment-users-role"
  route: "/users/:id"
  methode: PATCH
  condition: "body.role exists"
  action: bloquer
  severite: haute

- nom: "mass-assignment-users-isAdmin"
  route: "/users/:id"
  methode: PATCH
  condition: "body.isAdmin exists"
  action: bloquer
  severite: haute
```

`packages/engine/src/rules/default-rules/excessive-exposure-profile.yml`
```yaml
- nom: "excessive-exposure-passwordHash"
  route: "/users/:id/profile"
  methode: GET
  condition: "response.passwordHash exists"
  action: journaliser
  severite: moyenne
```

> Note pour Claude Code : le champ `response.*` dans les conditions nécessite que `resolvePath` sache aussi lire depuis `context.responseBody` (à étendre en section 4.4 — ajouter un cas `root === 'response'` qui lit depuis un second paramètre passé à `evaluate`, ou étendre `RequestContext` avec un champ optionnel `responseBody` rempli après coup par `ResponseAnalysisInterceptor`. Documenter le choix retenu dans `docs/architecture.md`.)

---

## 6. Schémas de données — MongoDB et ElasticSearch

### 6.1 Collection MongoDB `findings` — schéma de validation

```javascript
{
  $jsonSchema: {
    bsonType: "object",
    required: ["id", "requestId", "type", "severity", "route", "method", "actionTaken", "timestamp"],
    properties: {
      id: { bsonType: "string" },
      requestId: { bsonType: "string" },
      type: { enum: ["idor", "mass-assignment", "excessive-exposure", "anomaly-frequency", "anomaly-sequence", "anomaly-origin", "rule-triggered"] },
      severity: { enum: ["low", "medium", "high"] },
      route: { bsonType: "string" },
      method: { bsonType: "string" },
      userId: { bsonType: ["string", "null"] },
      detail: { bsonType: "string" },
      ruleName: { bsonType: ["string", "null"] },
      actionTaken: { enum: ["blocked", "logged", "rate-limited"] },
      timestamp: { bsonType: "long" }
    }
  }
}
```

Commande de création :
```bash
db.createCollection("findings", { validator: <schéma ci-dessus> })
db.findings.createIndex({ timestamp: -1 })
db.findings.createIndex({ route: 1, severity: 1 })
```

### 6.2 Mapping ElasticSearch `findings-index`

```json
{
  "mappings": {
    "properties": {
      "id": { "type": "keyword" },
      "requestId": { "type": "keyword" },
      "type": { "type": "keyword" },
      "severity": { "type": "keyword" },
      "route": { "type": "keyword" },
      "method": { "type": "keyword" },
      "userId": { "type": "keyword" },
      "detail": { "type": "text" },
      "ruleName": { "type": "keyword" },
      "actionTaken": { "type": "keyword" },
      "timestamp": { "type": "date", "format": "epoch_millis" }
    }
  }
}
```

---

## 7. Moteur d'anomalies — configuration exacte

`packages/engine/src/anomaly/anomaly.config.ts`
```typescript
export const ANOMALY_CONFIG = {
  ewma: {
    alpha: 0.3,
    zScoreThreshold: 3,
  },
  sequenceScan: {
    windowSize: 20,
    minConsecutiveIds: 5,
    maxWindowDurationMs: 10_000,
  },
  originShift: {
    minTimeBetweenShiftsMs: 120_000,
  },
  composite: {
    weights: { frequency: 0.4, sequence: 0.4, origin: 0.2 },
    blockThreshold: 0.7,
  },
};
```

### Table de cas de test — `ewma-frequency.analyzer.spec.ts`

| # | Scénario | Entrée simulée | Résultat attendu |
|---|---|---|---|
| 1 | Trafic régulier | 20 requêtes espacées de 5s ± 0.5s | Aucun `Finding` |
| 2 | Rafale soudaine | 20 requêtes à 5s d'intervalle puis 10 requêtes en 1s | `Finding` de type `anomaly-frequency` émis à partir de la ~3e requête rapprochée |
| 3 | Première requête d'un utilisateur | 1 seule requête | Aucun `Finding` (pas assez d'historique pour calculer un écart) |

### Table de cas de test — `sequence-scan.detector.spec.ts`

| # | Séquence d'IDs demandés (même utilisateur) | Durée totale | Résultat attendu |
|---|---|---|---|
| 1 | `1, 2, 3, 4, 5` | 3s | `Finding` de type `anomaly-sequence` |
| 2 | `1, 5, 12, 3, 8` | 3s | Aucun `Finding` (pas consécutif) |
| 3 | `1, 2, 3, 4, 5` | 45s (au-delà de `maxWindowDurationMs`) | Aucun `Finding` |

---

## 8. Vue d'ensemble des Guards et décision — table de vérité

| Règle DSL déclenchée (action: bloquer) | Score composite anomalie | Décision | `actionTaken` |
|---|---|---|---|
| Oui | peu importe | `block` | `blocked` |
| Non | > 0.7 | `rate-limit` | `rate-limited` |
| Non | ≤ 0.7 | `allow` | `logged` (si un `Finding` de sévérité basse existe malgré tout) |

---

## 9. Dashboard Vue — contrat d'API précis consommé par chaque vue

### `OverviewView.vue`
Appelle `GET /devoxguard/api/stats/overview`, réponse attendue :
```typescript
interface OverviewStats {
  blockedLast24h: number;
  topRulesTriggered: { ruleName: string; count: number }[];
  averageAnomalyScoreTrend: { timestamp: number; score: number }[];
}
```

### `FindingsListView.vue`
Appelle `GET /devoxguard/api/findings?type=&severity=&route=&from=&to=&page=&pageSize=`, réponse :
```typescript
interface FindingsPage {
  items: Finding[];
  total: number;
  page: number;
  pageSize: number;
}
```

### `FindingDetailView.vue`
Appelle `GET /devoxguard/api/findings/:id`, réponse : `Finding & { requestContext: RequestContext }`.

### `RulesView.vue`
Appelle `GET /devoxguard/api/rules`, réponse : `CompiledRule[]` (voir section 3.4 de la v1) sérialisé en JSON, condition affichée sous sa forme YAML brute d'origine (conserver le texte source en plus de l'AST compilé, champ `raw: string` à ajouter à `CompiledRule`).

---

## 10. Ordre d'exécution — version enrichie avec commit messages suggérés

1. `chore: scaffold monorepo structure (engine, api-demo, dashboard)`
2. `feat(api-demo): add vulnerable demo endpoints (orders, users, reviews)`
3. `feat(engine): implement RequestContext + request/response interceptors`
4. `feat(engine): implement hardcoded detectors (idor, mass-assignment, excessive-exposure)`
5. `feat(engine): implement DSL tokenizer`
6. `feat(engine): implement DSL parser + AST`
7. `feat(engine): implement DSL evaluator`
8. `feat(engine): implement rule loader with hot-reload`
9. `refactor(engine): migrate hardcoded detectors to default YAML rules`
10. `feat(engine): implement EWMA frequency analyzer`
11. `feat(engine): implement sequence scan detector`
12. `feat(engine): implement origin shift detector`
13. `feat(engine): implement composite anomaly scorer`
14. `feat(engine): implement DevoxGuard NestJS guard + decision engine`
15. `feat(engine): implement token bucket rate limiter`
16. `feat(engine): implement MongoDB + ElasticSearch persistence`
17. `feat(engine): expose internal dashboard API endpoints`
18. `feat(dashboard): scaffold Vue app + 4 views + API client`
19. `test: load testing + hardening pass`
20. `docs: finalize architecture.md, dsl-guide.md, anomaly-engine.md, rapport de stage`

Chaque commit doit être accompagné de ses tests ; ne pas grouper plusieurs numéros dans un seul commit même si ça semble plus rapide — la traçabilité fine sert directement le rapport de stage.

---

## 11. Ce qui doit apparaître dans `docs/architecture.md` (checklist de contenu)

- [ ] Schéma du pipeline complet (texte ou diagramme ASCII) : requête → interception → détecteurs + règles DSL → moteur d'anomalies → decision engine → persistance → réponse
- [ ] Politique fail-open vs fail-closed en cas d'exception interne du moteur, avec justification
- [ ] Liste des seuils de `anomaly.config.ts` et comment ils ont été calibrés (référence au jeu de données synthétique)
- [ ] Limites connues explicitement énoncées (ex. pas de détection d'IDOR sur des identifiants non numériques sans configuration supplémentaire)
