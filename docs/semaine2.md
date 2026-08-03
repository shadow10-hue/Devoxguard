# Semaine 2 — Moteur de règles DSL

## Objectifs
Concevoir et implémenter un DSL de règles déclaratives (fait main, sans `eval()`/`new Function()`), puis migrer les détecteurs codés en dur de la semaine 1 vers des règles YAML par défaut.

## Réalisations

- **Tokenizer** (`dsl/tokenizer.ts`) : chemins pointés (`body.role`) scannés comme un seul token `IDENTIFIER` ; `not`/`in`/`exists` comme tokens `KEYWORD` séparés ; erreurs de syntaxe (`DslSyntaxError`) avec position exacte du caractère fautif.
- **Parser + AST** (`dsl/parser.ts`, `dsl/ast.ts`) : fusion de la séquence `not` + `in` en un seul nœud `InNode{kind:'not-in'}` ; littéraux booléens acceptés via un token `IDENTIFIER` de valeur `true`/`false` (aucun type de token dédié).
- **Évaluateur** (`dsl/evaluator.ts`) : implémentation de référence donnée par le cahier des charges, étendue avec une racine `response.*` lisant `context.responseBody`, pour permettre aux règles de phase réponse (ex. excessive-exposure) d'évaluer des conditions sur le corps de réponse.
- **`RuleLoader`** : chargement d'un répertoire de fichiers YAML, compilation en `CompiledRule[]`, rechargement à chaud via `fs.watch` (avec anti-rebond, car certains systèmes de fichiers déclenchent plusieurs événements par écriture). Une règle mal formée pendant un rechargement à chaud est journalisée et ignorée — l'ancien jeu de règles reste actif plutôt que de faire planter le watcher.
- **Règles par défaut** : `idor-orders.yml`, `mass-assignment-users.yml` (2 règles), `excessive-exposure-profile.yml` — contenu exact du cahier des charges.
- **Migration** : le pipeline standard (semaine 4) utilise désormais exclusivement le chemin DSL pour les trois catégories de vulnérabilités par défaut ; les détecteurs codés en dur restent dans le code comme exemple d'extensibilité, avec un test de parité (`pipeline-parity.spec.ts`) prouvant que les deux chemins produisent la même sévérité et la même décision pour les mêmes scénarios.

## Décision notable

Le grammaire du DSL interdit toute règle de phase réponse (`response.*`) avec `action: bloquer` — rejetée au chargement — puisque bloquer après que la réponse a déjà été produite par le contrôleur n'a pas de sens architectural.

## Tests
28 tests supplémentaires (tokenizer, parser, évaluateur, chargeur de règles y compris un test d'intégration réel de rechargement à chaud via `fs.watch`).
