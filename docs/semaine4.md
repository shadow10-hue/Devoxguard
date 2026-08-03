# Semaine 4 — Guard, rate limiting, persistance, API interne

## Objectifs
Assembler le pipeline complet (règles + anomalies → décision → persistance) et exposer les endpoints internes consommés par le tableau de bord.

## Réalisations

- **`DecisionEngine`** : implémente la table de vérité du cahier des charges (règle DSL bloquante → `block` ; sinon score composite > 0.7 → `rate-limit` ; sinon `allow`). Normalise `actionTaken` sur tous les findings d'une requête pour qu'il reflète le verdict final.
- **`DevoxGuardInterceptor`** : le "guard" du cahier des charges, implémenté comme `NestInterceptor` (et non un `CanActivate` littéral — voir `docs/architecture.md` §2 pour la justification). Orchestre règles de phase requête, moteur d'anomalies, décision, puis règles de phase réponse et persistance. Politique fail-open documentée pour toute erreur interne non prévue.
- **`TokenBucket`** : seau à jetons fait maison (capacité/taux de remplissage configurables, horloge injectable pour les tests), utilisé pour durcir dynamiquement le quota lors d'une décision `rate-limit`.
- **Persistance MongoDB + Elasticsearch** : `MongoFindingRepository` (driver natif, pas de Mongoose), validateur `$jsonSchema` exact du cahier des charges, `ElasticsearchFindingIndexer` (mapping exact du cahier des charges). Le `RequestContext` associé est stocké aux côtés du `Finding` validé (le validateur n'impose pas `additionalProperties: false`).
- **API interne** (`/devoxguard/api/*`) : `findings` (liste paginée/filtrée + détail avec `RequestContext`), `rules` (règles actuellement chargées, condition brute incluse), `stats/overview` (requêtes bloquées sur 24h, top 5 règles déclenchées, tendance du score d'anomalie moyen). Protégés par `InternalApiKeyGuard` (clé API statique).
- **`DevoxGuardModule.forRoot(config)`** : module dynamique assemblant l'ensemble (chargeur de règles avec rechargement à chaud, analyseurs d'anomalies, moteur de décision, seau à jetons, persistance, contrôleurs).

## Bug découvert plus tard (semaine 5, corrigé rétroactivement ici)

Le module ne enregistrait initialement que `DevoxGuardInterceptor` comme intercepteur global, oubliant `RequestAnalysisInterceptor` et `ResponseAnalysisInterceptor` (semaine 1). Sans eux, `DevoxGuardInterceptor` ne voyait jamais de `RequestContext` peuplé et repassait systématiquement en mode fail-open (aucune protection réelle). Découvert et corrigé lors du test de charge en semaine 5.

## Tests
26 tests supplémentaires (moteur de décision, seau à jetons, persistance avec clients mockés, endpoints internes via `supertest`).
