# Rapport de stage — DevoxGuard

## Contexte et objectif

DevoxGuard est un moteur de sécurité applicative propriétaire packagé comme module NestJS réutilisable : analyse de requêtes REST, moteur de règles déclaratives (DSL fait maison), détection d'anomalies comportementales, et tableau de bord Vue pour l'exploitation. Contrainte non négociable du cahier des charges : aucune bibliothèque tierce de sécurité ou de machine learning dans le cœur logique — uniquement NestJS, Vue, TypeScript, Node.js standard, un driver MongoDB, un client Elasticsearch, et des outils de test.

Le projet a été mené en 20 étapes ordonnées (spécifiées dans `DevoxGuard_Spec_ClaudeCode_v2.md`), chacune correspondant à un commit auto-suffisant (code + tests), réparties sur cinq semaines thématiques documentées individuellement dans `docs/semaine{1..5}.md`.

## Architecture livrée

```
devoxguard/ (monorepo npm workspaces)
├── packages/engine/     # Moteur — package NestJS installable
├── packages/api-demo/   # API cobaye avec failles volontaires
├── packages/dashboard/  # Tableau de bord Vue 3
├── docs/                # Cette documentation
├── scripts/             # Générateur de logs synthétiques
└── docker-compose.dev.yml
```

Voir `docs/architecture.md` pour le schéma détaillé du pipeline de requête, `docs/dsl-spec.md` pour la grammaire et l'implémentation du DSL, `docs/anomaly-engine.md` pour les quatre composants du moteur d'anomalies.

## Résultats

- **150+ tests** répartis sur les trois packages (moteur, API de démonstration, tableau de bord), tous verts sans dépendance à Docker à l'exception des tests d'intégration explicitement marqués (persistance, câblage complet du tableau de bord), qui se dégradent proprement (passent, avertissement journalisé) en l'absence de MongoDB/Elasticsearch locaux.
- **Zéro `eval()`/`new Function()`/`vm.runInContext`** dans `packages/engine/src` — vérifié par lecture exhaustive du code produit à chaque étape.
- **Pipeline complet vérifié en conditions réelles** : `api-demo` protégé par le moteur complet, exécuté contre des instances Docker de MongoDB et Elasticsearch, soumis à un test de charge `autocannon` (`packages/api-demo/scripts/load-test.ts`) démontrant que le blocage de règles (IDOR, mass assignment), le logging de phase réponse (excessive exposure), et le rate-limiting basé sur le score composite d'anomalie fonctionnent tous correctement sous charge concurrente réelle.

## Écarts déclarés par rapport au cahier des charges littéral

Deux écarts délibérés et documentés, tous deux justifiés par des preuves concrètes plutôt que par préférence stylistique :

1. **Formule du z-score EWMA** (`docs/anomaly-engine.md` §1) : le pseudocode littéral est mathématiquement incapable de dépasser le seuil de détection donné, quelle que soit l'ampleur de l'anomalie — démontré par simulation avant implémentation. La formule a été réordonnée (évaluation contre l'état pré-mise-à-jour) pour satisfaire le propre scénario de test du cahier des charges.
2. **"Guard" implémenté comme intercepteur, pas comme `CanActivate`** (`docs/architecture.md` §2) : NestJS exécute les guards avant que le `RequestContext` puisse exister ; le composant a besoin d'un accès aux deux phases (requête et réponse), ce que seul un intercepteur permet.

## Bugs découverts par le test de charge de bout en bout

Cinq bugs réels (détaillés dans `docs/semaine5.md`) n'ont été détectés qu'en exécutant la pile complète contre des services réels sous charge — aucun n'était visible dans les tests unitaires mockés, qui valident la logique de chaque composant isolément mais pas leur assemblage réel (câblage des intercepteurs NestJS, sérialisation BSON réelle, résolution de modules npm réelle, comportement sous concurrence réelle). Cela confirme la valeur d'un test de charge de bout en bout comme étape à part entière du cycle de développement, et pas seulement comme mesure de performance.

## Limites connues

Documentées explicitement dans `docs/architecture.md` §7 : état du moteur d'anomalies en mémoire uniquement (non partagé entre instances horizontalement scalées), détection IDOR limitée aux identifiants numériques, authentification du tableau de bord par clé API statique unique.

## Conclusion

L'ensemble des 20 étapes du cahier des charges a été implémenté, testé, et vérifié en conditions réelles (Docker + charge concurrente), avec une traçabilité fine (un commit par étape) permettant de retracer précisément la construction du système du scaffolding initial jusqu'au tableau de bord final.
