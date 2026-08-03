# Semaine 5 — Tableau de bord Vue, tests de charge, durcissement, documentation

## Objectifs
Construire le tableau de bord Vue consommant l'API interne, valider l'ensemble du système sous charge réelle, corriger les problèmes découverts, et finaliser la documentation.

## Réalisations

- **Tableau de bord Vue 3 + Vite** : client API (`devoxguard-client.ts`, axios + en-tête de clé API), routeur (`vue-router`), quatre vues (`OverviewView`, `FindingsListView` avec filtres et pagination, `FindingDetailView` avec le `RequestContext` complet, `RulesView`) — contrats de données conformes au cahier des charges. Tests de composants avec `vitest` + `@vue/test-utils`, chaque vue mockant le client API. Vérifié manuellement via `npm run dev` et un navigateur.
- **Intégration réelle** : `DevoxGuardModule` câblé dans `AppModule` d'`api-demo`, contre des instances Docker réelles de MongoDB et Elasticsearch (`docker-compose.dev.yml up -d`).
- **Test de charge** (`packages/api-demo/scripts/load-test.ts`, `autocannon`) : trois phases — trafic de référence throttlé, rafale combinant les signaux fréquence + balayage séquentiel (seuls capables de dépasser le seuil composite de 0.7), tentatives IDOR soutenues. Résultat final : 100 % des tentatives IDOR bloquées sous charge, le rate-limiting se déclenche effectivement (429) une fois les deux signaux combinés, le trafic légitime n'est jamais affecté.

## Bugs réels découverts et corrigés grâce au test de charge (voir `docs/architecture.md` et `docs/anomaly-engine.md` pour le détail technique)

1. **Intercepteurs globaux manquants** : `DevoxGuardModule` n'enregistrait pas `RequestAnalysisInterceptor`/`ResponseAnalysisInterceptor`, désactivant silencieusement toute protection réelle (repli fail-open systématique).
2. **Sérialisation BSON incorrecte** : le validateur `$jsonSchema` exige `timestamp` en `long`, mais `Date.now()` sérialise en `double` par défaut — chaque insertion échouait la validation. Corrigé à la frontière de persistance uniquement (`mongo.repository.ts`).
3. **Fichiers YAML absents du build publié** : `tsc` ne copie pas les fichiers non-TypeScript ; les règles par défaut n'existaient jamais dans `dist/`. Ajout d'une étape de copie post-build.
4. **Détecteur de balayage séquentiel non-fonctionnel sous charge concurrente** : absence de déduplication des ids dans la fenêtre glissante, cassant la détection de suite consécutive dès qu'un id se répétait (quasi systématique sous charge concurrente réelle).
5. **Régression d'outillage TypeScript** : une dépendance `typescript` ajoutée à la racine du monorepo (semaine 3, pour `scripts/generate-logs.ts`) s'est propagée dans la résolution `ts-jest` d'`api-demo`, déclenchant de nouvelles erreurs strictes contre son `tsconfig.json` généré par Nest CLI. Isolé via un `tsconfig.jest.json` dédié.

Ces cinq bugs n'auraient été détectés par aucun test unitaire mocké — ils n'existent qu'à l'intersection réelle des composants (câblage NestJS, sérialisation BSON réelle, résolution de modules réelle, charge concurrente réelle), ce qui justifie a posteriori l'inclusion d'un test de charge de bout en bout comme étape obligatoire, et pas seulement une formalité de performance.

## Documentation finalisée

`docs/architecture.md` (schéma du pipeline, politique fail-open/fail-closed justifiée, mécanisme `response.*`, calibration des seuils, limites connues), `docs/dsl-spec.md`, `docs/anomaly-engine.md`, `docs/semaine{1..5}.md`, `docs/rapport-de-stage.md`.

## Tests
11 tests de composants Vue supplémentaires. Suite complète du monorepo : 112 tests engine + 16 tests api-demo (unitaires + e2e) + 11 tests dashboard + 4 tests du générateur de logs à la racine, tous verts.
