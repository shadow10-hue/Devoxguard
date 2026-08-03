# Semaine 1 — Scaffolding, API vulnérable, détecteurs codés en dur

## Objectifs
Poser la structure du monorepo, construire l'API de démonstration volontairement vulnérable, et implémenter la première version (codée en dur, sans DSL) des trois détecteurs de vulnérabilités.

## Réalisations

- **Scaffolding du monorepo** (npm workspaces) : `packages/engine` (package NestJS installable), `packages/api-demo` (API cobaye), `packages/dashboard` (Vue 3 + Vite). `docker-compose.dev.yml` pour MongoDB + Elasticsearch en local.
- **`packages/api-demo`** : trois failles volontaires implémentées et testées (tests prouvant que la faille existe, non protégée) :
  - IDOR sur `GET /orders/:id` (aucune vérification de propriété).
  - Mass assignment sur `PATCH /users/:id` (accepte `role`/`isAdmin` sans liste blanche).
  - Excessive exposure sur `GET /users/:id/profile` (fuite de `passwordHash`).
  - `FakeAuthMiddleware` : authentification triviale par en-tête `Authorization: Bearer <userId>`, résolue contre un seed statique, pour rendre les scénarios IDOR déterministes sans construire une vraie authentification.
- **`RequestContext` + intercepteurs** : `RequestAnalysisInterceptor` construit un `RequestContext` normalisé (route, params, query, body, headers, utilisateur authentifié, IP d'origine) et l'attache à la requête ; `ResponseAnalysisInterceptor` y ajoute le corps de réponse une fois le contrôleur exécuté.
- **Détecteurs codés en dur** : `IdorDetector`, `MassAssignmentDetector`, `ExcessiveExposureDetector`, conformes à l'interface `Detector` commune. Ces détecteurs seront remplacés par les règles DSL en semaine 2 (semaine 2, étape "migration") mais restent disponibles comme mécanisme d'extensibilité pour une logique trop spécifique pour le DSL.

## Décisions notables

- NestJS 11 (aligné sur ce que `@nestjs/cli` a réellement généré pour `api-demo`) plutôt que 10.4 tel que spécifié initialement, pour éviter une double instance de `@nestjs/core` en mémoire quand `api-demo` importe `@devox/engine`.
- Middleware d'authentification appliqué via `app.use()` plutôt que `NestModule.configure()` : Express 5 (fourni par Nest 11) utilise une version de `path-to-regexp` qui rejette le caractère générique `'*'` historique de Nest pour les routes de middleware.

## Tests
27 tests unitaires/e2e (interception, détecteurs, endpoints vulnérables) — tous verts sans dépendance à Docker.
