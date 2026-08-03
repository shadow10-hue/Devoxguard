# Semaine 3 — Moteur de détection d'anomalies comportementales

## Objectifs
Implémenter les trois détecteurs comportementaux (fréquence EWMA, balayage séquentiel, changement d'origine) et le score composite qui les combine.

## Réalisations

- **`scripts/generate-logs.ts`** (écrit en premier, à la racine du monorepo, sans dépendance à `@devox/engine`) : générateur de trafic synthétique — régulier, rafale, balayage séquentiel d'ids, changement d'origine — utilisé pour calibrer et valider les seuils.
- **`EwmaFrequencyAnalyzer`** : moyenne mobile exponentielle et variance des intervalles entre requêtes, par clé `(userId, route)`.
- **`SequenceScanDetector`** : détecte 5+ ids numériques consécutifs demandés par un même utilisateur en moins de 10 secondes (fenêtre glissante des 20 dernières entrées, purgées après 60s).
- **`OriginShiftDetector`** : détecte des changements d'IP rapprochés (moins de 120s entre deux changements) pour un même utilisateur.
- **`composite-scorer.ts`** : score pondéré (fréquence 0.4, séquence 0.4, origine 0.2), seuil de blocage strict à 0.7.

## Décision notable — écart déclaré par rapport au pseudocode du cahier des charges

Le pseudocode du z-score EWMA, lu littéralement, calcule le score à partir de l'état du modèle **après** intégration de l'intervalle courant. Cette formulation est mathématiquement auto-limitante : le même écart qui produit le numérateur du z-score gonfle aussi la variance qui le normalise, plafonnant le z-score à `sqrt((1-alpha)/alpha) ≈ 1.53` pour `alpha=0.3`, quelle que soit l'ampleur de l'anomalie (démontré par simulation directe avant l'implémentation). Avec un seuil de 3, le détecteur ne pourrait alors jamais se déclencher, ce qui contredit le propre scénario de test du cahier des charges ("une rafale soudaine doit être détectée"). L'implémentation calcule donc le z-score contre l'état **avant** mise à jour, avec une courte période de préchauffage (les deux premiers intervalles observés ne font qu'amorcer le modèle, sans vérification de z-score) pour éviter une division par une variance quasi nulle juste après la première requête d'une clé. Documenté en détail dans `docs/anomaly-engine.md`.

## Bug découvert plus tard (semaine 5, corrigé rétroactivement ici)

Le détecteur de balayage séquentiel ne dédupliquait pas les ids de sa fenêtre avant de chercher une suite consécutive : un id répété casse la chaîne (écart de 0, pas de +1). Sous charge concurrente réelle, les répétitions sont courantes, ce qui empêchait silencieusement le détecteur de se déclencher. Corrigé en semaine 5 après l'avoir découvert via le test de charge — voir `docs/anomaly-engine.md` §2.

## Tests
19 tests supplémentaires + le générateur de logs testé isolément.
