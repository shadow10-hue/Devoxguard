# DevoxGuard — Spécification technique d'implémentation

> Ce fichier est destiné à être donné à Claude Code comme brief d'exécution. Il contient la structure de dossiers exacte, les interfaces TypeScript, les schémas de données, la grammaire du DSL, les algorithmes détaillés et les critères d'acceptation par tâche. Suivre l'ordre des phases tel quel — chaque phase dépend du code produit par la précédente.

---

## 0. Vue d'ensemble

**Nom du projet :** DevoxGuard
**But :** moteur de sécurité applicative propriétaire (analyse de requêtes REST, moteur de règles DSL, détection d'anomalies comportementales) packagé comme module NestJS réutilisable, avec un tableau de bord Vue.
**Contrainte non négociable :** aucune bibliothèque tierce de sécurité (Semgrep, Gitleaks, helmet pour la logique métier, etc.) ni de bibliothèque de machine learning (scikit-learn, tensorflow, brain.js) pour le cœur logique. Seuls sont autorisés : NestJS, Vue, TypeScript, Node.js standard, un driver MongoDB, un client ElasticSearch, et des outils de test (Jest, autocannon).

---

## 1. Structure du monorepo

```
devoxguard/
├── packages/
│   ├── engine/                     # Cœur du moteur — package NestJS installable
│   │   ├── src/
│   │   │   ├── analysis/
│   │   │   │   ├── request-context.ts
│   │   │   │   ├── request-analysis.interceptor.ts
│   │   │   │   ├── response-analysis.interceptor.ts
│   │   │   │   └── detectors/
│   │   │   │       ├── detector.interface.ts
│   │   │   │       ├── idor.detector.ts
│   │   │   │       ├── mass-assignment.detector.ts
│   │   │   │       └── excessive-exposure.detector.ts
│   │   │   ├── rules/
│   │   │   │   ├── dsl/
│   │   │   │   │   ├── tokenizer.ts
│   │   │   │   │   ├── parser.ts
│   │   │   │   │   ├── ast.ts
│   │   │   │   │   └── evaluator.ts
│   │   │   │   ├── rule-loader.ts
│   │   │   │   ├── rule.types.ts
│   │   │   │   └── default-rules/
│   │   │   │       ├── idor-orders.yml
│   │   │   │       ├── mass-assignment-users.yml
│   │   │   │       └── excessive-exposure-profile.yml
│   │   │   ├── anomaly/
│   │   │   │   ├── behavior-log.schema.ts
│   │   │   │   ├── ewma-frequency.analyzer.ts
│   │   │   │   ├── sequence-scan.detector.ts
│   │   │   │   ├── origin-shift.detector.ts
│   │   │   │   └── composite-scorer.ts
│   │   │   ├── guard/
│   │   │   │   ├── devoxguard.guard.ts
│   │   │   │   ├── decision-engine.ts
│   │   │   │   └── rate-limiter/
│   │   │   │       └── token-bucket.ts
│   │   │   ├── storage/
│   │   │   │   ├── finding.schema.ts
│   │   │   │   ├── mongo.repository.ts
│   │   │   │   └── elasticsearch.indexer.ts
│   │   │   ├── devoxguard.module.ts
│   │   │   └── index.ts               # point d'entrée exporté du package
│   │   ├── test/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api-demo/                   # API NestJS "cobaye" avec failles volontaires
│   │   ├── src/
│   │   │   ├── orders/
│   │   │   ├── users/
│   │   │   ├── reviews/
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── dashboard/                  # Application Vue
│       ├── src/
│       │   ├── views/
│       │   │   ├── OverviewView.vue
│       │   │   ├── FindingsListView.vue
│       │   │   ├── FindingDetailView.vue
│       │   │   └── RulesView.vue
│       │   ├── api/
│       │   │   └── devoxguard-client.ts
│       │   ├── router/
│       │   └── main.ts
│       └── package.json
│
├── docs/
│   ├── dsl-spec.md
│   ├── architecture.md
│   ├── anomaly-engine.md
│   └── semaine{1..5}.md
│
├── scripts/
│   └── generate-logs.ts
│
└── package.json                    # workspace racine (npm/pnpm workspaces)
```

---

## 2. Interfaces et types fondamentaux

### 2.1 `RequestContext` (`packages/engine/src/analysis/request-context.ts`)

```typescript
export interface RequestContext {
  requestId: string;              // uuid v4, généré à la capture
  timestamp: number;              // epoch ms
  route: string;                  // pattern normalisé, ex: "/orders/:id"
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  params: Record<string, string>;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  headers: {
    authorization?: string;
    [key: string]: string | undefined;
  };
  authenticatedUser: {
    id: string;
    ownedResourceIds?: Record<string, string[]>; // ex: { orders: ["1","2"] } pour vérif d'appartenance
  } | null;
  originIp: string;
}
```

### 2.2 `Finding` (`packages/engine/src/storage/finding.schema.ts`)

```typescript
export type FindingType =
  | 'idor'
  | 'mass-assignment'
  | 'excessive-exposure'
  | 'anomaly-frequency'
  | 'anomaly-sequence'
  | 'anomaly-origin'
  | 'rule-triggered';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  id: string;
  requestId: string;
  type: FindingType;
  severity: Severity;
  route: string;
  method: string;
  userId: string | null;
  detail: string;                 // message humain, ex: "Champ 'role' non autorisé injecté dans le body"
  ruleName?: string;               // si déclenché par une règle DSL
  actionTaken: 'blocked' | 'logged' | 'rate-limited';
  timestamp: number;
}
```

### 2.3 `Detector` (interface commune, `detector.interface.ts`)

```typescript
export interface Detector {
  readonly name: string;
  detect(context: RequestContext, responseBody?: unknown): Finding[];
}
```

---

## 3. Grammaire du DSL de règles

### 3.1 Format déclaratif (YAML)

```yaml
- nom: "idor-orders"
  route: "/orders/:id"
  methode: GET
  condition: "params.id not in user.ownedResourceIds.orders"
  action: bloquer
  severite: haute

- nom: "mass-assignment-users"
  route: "/users/:id"
  methode: PATCH
  condition: "body.role exists"
  action: bloquer
  severite: haute
```

### 3.2 Grammaire formelle des expressions de `condition`

```
expression      := comparaison
comparaison     := chemin operateur valeur
                 | chemin ("in" | "not in") liste
                 | chemin "exists"
chemin          := identifiant ("." identifiant)*      // ex: body.role, params.id
operateur       := "==" | "!="
valeur          := chaine | nombre | booleen
liste           := chemin                              // référence à un tableau du contexte, ex: user.ownedResourceIds.orders
identifiant     := [a-zA-Z_][a-zA-Z0-9_]*
```

### 3.3 Fichiers à produire

- `dsl/tokenizer.ts` — fonction `tokenize(expr: string): Token[]`, types de tokens : `IDENTIFIER`, `DOT`, `OPERATOR`, `STRING`, `NUMBER`, `KEYWORD` (`in`, `not`, `exists`)
- `dsl/parser.ts` — fonction `parse(tokens: Token[]): ConditionNode`, doit lever `DslSyntaxError` avec position exacte en cas d'erreur
- `dsl/ast.ts` — types `ConditionNode`, `PathNode`, `ComparisonNode`, `ExistsNode`, `InNode`
- `dsl/evaluator.ts` — fonction `evaluate(node: ConditionNode, context: RequestContext): boolean`, doit résoudre les chemins (`body.role`, `user.ownedResourceIds.orders`) par accès dynamique sécurisé (jamais de `eval()` ou `new Function()` — accès par découpage du chemin et lookup manuel)

### 3.4 `RuleLoader` (`rule-loader.ts`)

```typescript
export interface CompiledRule {
  nom: string;
  route: string;
  methode: string;
  conditionAst: ConditionNode;
  action: 'bloquer' | 'journaliser';
  severite: Severity;
}

export class RuleLoader {
  loadFromDirectory(path: string): CompiledRule[];
  watch(path: string, onChange: (rules: CompiledRule[]) => void): void; // rechargement à chaud via fs.watch
}
```

---

## 4. Algorithmes du moteur d'anomalies (pseudocode détaillé)

### 4.1 EWMA fréquence (`ewma-frequency.analyzer.ts`)

```
état par clé (userId + route):
  ewma: number = 0
  variance: number = 0
  alpha: number = 0.3          // facteur de lissage, ajustable

pour chaque nouvelle requête à t:
  intervalle = t - dernierTimestamp[clé]
  ecart = intervalle - ewma
  ewma = ewma + alpha * ecart
  variance = (1 - alpha) * (variance + alpha * ecart^2)
  zScore = abs(intervalle - ewma) / sqrt(variance + epsilon)
  si zScore > SEUIL_Z (ex: 3):
      émettre Finding(type: 'anomaly-frequency', severity calculée selon zScore)
  dernierTimestamp[clé] = t
```

Implémenter en TypeScript pur, état conservé en `Map<string, {ewma:number; variance:number; lastTs:number}>` en mémoire (persisté périodiquement, pas de dépendance externe de calcul statistique).

### 4.2 Détection de balayage séquentiel (`sequence-scan.detector.ts`)

```
fenêtre glissante par utilisateur : liste des N dernières valeurs de :id extraites de params, avec timestamp

à chaque requête sur une route paramétrée par :id:
  ajouter (id, timestamp) à la fenêtre de l'utilisateur (garder les 20 dernières, purge par ancienneté > 60s)
  si au moins 5 ids consécutifs (numériques, delta == 1) dans la fenêtre sur une durée < 10s:
      émettre Finding(type: 'anomaly-sequence', severity: 'high')
```

### 4.3 Changement d'origine anormal (`origin-shift.detector.ts`)

```
état par utilisateur : dernière IP vue, timestamp du dernier changement

à chaque requête:
  si originIp != dernièreIp[userId] ET (t - dernierChangement[userId]) < SEUIL_TEMPS (ex: 120s):
      émettre Finding(type: 'anomaly-origin', severity: 'medium')
  mettre à jour dernièreIp et dernierChangement
```

### 4.4 Score composite (`composite-scorer.ts`)

```
score = w1 * normaliser(zScoreFrequence) + w2 * (1 si sequenceDetectee sinon 0) + w3 * (1 si originShiftDetecte sinon 0)
poids par défaut : w1=0.4, w2=0.4, w3=0.2 (documentés et ajustables dans un fichier de config `anomaly.config.ts`)
si score > SEUIL_COMPOSITE (ex: 0.7): action = 'rate-limited' ou 'blocked' selon sévérité
```

---

## 5. Guard NestJS et logique de décision

### 5.1 `DevoxGuardMiddleware` (`guard/devoxguard.guard.ts`)

Pipeline exact à implémenter, dans cet ordre, pour chaque requête :

1. `RequestAnalysisInterceptor` construit le `RequestContext`
2. Les 3 détecteurs codés en dur (semaine 1) **ET** les règles DSL chargées (semaine 2) sont exécutés → liste de `Finding[]`
3. Le moteur d'anomalies (semaine 3) est exécuté en parallèle → `Finding[]` additionnels
4. `DecisionEngine.decide(findings: Finding[]): 'allow' | 'block' | 'rate-limit'` :
   - une règle DSL avec `action: bloquer` déclenchée → `block` immédiat (HTTP 403)
   - anomalie composite haute sans règle → `rate-limit` (réduction dynamique du quota du token bucket)
   - sinon → `allow`, mais tous les `Finding` sont journalisés quel que soit le verdict
5. Tous les `Finding` sont persistés via `storage/mongo.repository.ts` et indexés via `storage/elasticsearch.indexer.ts`

### 5.2 Token bucket maison (`rate-limiter/token-bucket.ts`)

```typescript
export class TokenBucket {
  constructor(private capacity: number, private refillRatePerSec: number) {}
  private tokens: number;
  private lastRefill: number;

  tryConsume(cost: number = 1): boolean; // retourne false si pas assez de tokens
  reduceCapacity(factor: number): void;  // appelé par le moteur d'anomalies pour durcir dynamiquement
}
```

---

## 6. Endpoints internes exposés au dashboard

Tous préfixés `/devoxguard/api` dans le module NestJS.

| Méthode | Route | Description |
|---|---|---|
| GET | `/devoxguard/api/findings` | Liste paginée, filtrable par `type`, `severity`, `route`, plage de dates |
| GET | `/devoxguard/api/findings/:id` | Détail complet d'un finding, incluant le `RequestContext` associé |
| GET | `/devoxguard/api/rules` | Liste des règles DSL actuellement chargées (nom, route, condition brute, action) |
| GET | `/devoxguard/api/stats/overview` | Compteurs agrégés : nb requêtes bloquées (24h), top 5 règles déclenchées, tendance du score d'anomalie moyen |

Ces endpoints doivent être protégés par un guard d'authentification minimal séparé (ne pas les exposer publiquement).

---

## 7. Ordre d'exécution pour Claude Code

Exécuter dans cet ordre strict, en committant après chaque étape validée par ses tests :

1. **Scaffolding** : créer la structure de dossiers exacte de la section 1, initialiser les 3 packages (`engine`, `api-demo`, `dashboard`) avec leurs `package.json` respectifs et les dépendances minimales (NestJS, Vue 3 + Vite, Jest, ts-node, driver `mongodb`, client `@elastic/elasticsearch`).
2. **`api-demo`** : implémenter les 4-5 endpoints factices avec failles volontaires décrites en semaine 1 (IDOR, mass assignment, excessive exposure).
3. **`RequestContext` + interceptors** : implémenter section 2.1 et les fichiers `request-analysis.interceptor.ts` / `response-analysis.interceptor.ts`.
4. **Détecteurs codés en dur** : `idor.detector.ts`, `mass-assignment.detector.ts`, `excessive-exposure.detector.ts`, conformes à l'interface `Detector`.
5. **DSL complet** : tokenizer → parser → ast → evaluator → rule-loader, dans cet ordre, chaque fichier testé unitairement avant de passer au suivant.
6. **Migration des détecteurs vers des règles YAML par défaut** (section 3.4), suppression progressive du code en dur équivalent.
7. **Moteur d'anomalies** : implémenter 4.1, 4.2, 4.3 séparément avec tests unitaires sur données synthétiques (`scripts/generate-logs.ts` à écrire en premier), puis 4.4 (composite).
8. **Guard + DecisionEngine + TokenBucket** (section 5), branchés sur `api-demo`.
9. **Storage** : `mongo.repository.ts` et `elasticsearch.indexer.ts`, branchés sur la persistance des `Finding`.
10. **Endpoints internes** (section 6).
11. **Dashboard Vue** : les 4 vues listées en section 1, consommant les endpoints de la section 6.
12. **Tests de charge, durcissement, documentation finale** (`docs/architecture.md`, `docs/dsl-guide.md`, `docs/anomaly-engine.md`).

---

## 8. Critères d'acceptation globaux

- Aucun `eval()`, `new Function()`, ni bibliothèque de sécurité/ML tierce dans `packages/engine/src`.
- Couverture de tests unitaires sur `dsl/` et `anomaly/` : au minimum les cas nominaux et un cas d'erreur par fonction publique.
- Le rechargement à chaud des règles doit être vérifiable par un test d'intégration (modifier un fichier YAML pendant que le serveur tourne, observer le changement de comportement sans redémarrage).
- Le pipeline complet (interception → analyse → décision → persistance) ne doit jamais laisser une exception non gérée remonter jusqu'au client : toute erreur interne du moteur est capturée et journalisée, avec une politique explicite fail-open ou fail-closed documentée dans `docs/architecture.md`.
