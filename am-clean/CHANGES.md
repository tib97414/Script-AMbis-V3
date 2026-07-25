# CHANGES.md — Divergences connues vs l'ancien projet (Script-AMbis)

Ce fichier documente les écarts volontaires entre ce projet (am-clean) et
l'ancien projet, découverts et corrigés pendant la migration. Chaque écart
est chiffré et expliqué — aucune divergence silencieuse n'est acceptée ici.

Référence de validation utilisée : `references/reference-snapshot__1_.json`
(27 routes, jeu CGK), généré depuis l'ancien projet le 2026-07-23.

---

## 1. Bug du temps de vol (`ft`) non recalculé pour l'avion final retenu

**Statut : corrigé.**

**Fichier concerné** : `src/optimizer/economics/circuitEconomics.js`
- `enrichRouteEconomics()` : ne réécrit plus `route.ft`... *(voir détail ci-dessous, en réalité c'est `finalizeCircuitObject` qui a été corrigé)*
- `finalizeCircuitObject()` : `ft` est maintenant **toujours** recalculé avec
  `flightTime(route.distance, ac.speed)` pour l'avion réellement choisi,
  au lieu de garder l'ancien `route.ft || flightTime(...)` qui gardait la
  valeur calculée pendant la génération du pool (avec un avion parfois différent).

**Pourquoi c'est un bug dans l'ancien projet** : `generateFleetFirstCircuitPool`
enrichit chaque route avec un avion "candidat" pour trier le pool, puis
`buildEvaluatedCircuit` choisit le meilleur avion final (potentiellement
différent). L'ancien code gardait le `ft` calculé avec le premier avion,
même si l'avion final avait une vitesse différente.

**Preuve chiffrée** (circuit CGK-UTN, référence) :
- Ancien (buggé) : `ft = 24.5` (calculé avec un avion à 828 km/h)
- Nouveau (corrigé) : `ft = 23.75` (calculé avec le 767-200ER réellement retenu, 850 km/h)
- Impact sur le circuit complet (7 routes) : `totalTime` passe de `161h` à `157.25h`

---

## 2. Bug de la taxe appliquée deux fois

**Statut : corrigé.**

**Fichier concerné** : `src/optimizer/economics/circuitEconomics.js`
- `enrichRouteEconomics()` : ne réécrit plus `route.tax` (ligne `tax: plane.tax`
  supprimée). La taxe brute de la route reste intacte jusqu'à l'évaluation finale.

**Pourquoi c'est un bug dans l'ancien projet** : `enrichRouteEconomics` était
appelé une première fois pendant la génération du pool, transformant
`route.tax` en `(taxBrute × cat) / 2`. Ces routes déjà transformées étaient
ensuite passées à `buildEvaluatedCircuit`, qui réappliquait la même formule
une seconde fois via `evaluateCircuitEconomics` → `evaluatePlaneOnRoute`.
Résultat : la taxe finale était égale à `taxBrute × (cat/2)²` au lieu de
`taxBrute × cat/2`.

**Preuve chiffrée** (circuit CGK-UTN, 7 routes, avion 767-200ER, cat=4) :
- Ancien (buggé) : `economics.tax = 2 866 332`
- Nouveau (corrigé) : `economics.tax = 1 433 166` (exactement la moitié)
- Impact sur `totalProfit` du circuit : `72 045 663,94` → `73 478 829,94` (+1 433 166)

---

## 3. Conséquence des deux corrections : le choix d'avion optimal peut différer

**Statut : conséquence attendue, pas un bug séparé.**

Avec les deux bugs ci-dessus corrigés, la comparaison entre avions candidats
n'est plus biaisée. Sur le circuit CGK 7-routes, l'ancien projet choisissait
le 767-200ER ; le nouveau choisit l'A319-100LR (cascade à 8 avions), car ce
choix sert mieux la demande affaires (`unsatisfied.bus = 0` contre `2` pour
le 767) pour un gain net de 234 618 $ sur ce circuit précis.

**Vérifié** : les deux résultats (ancien et nouveau choix d'avion) ont été
recalculés indépendamment avec `evaluateCircuitEconomics` et matchent
exactement les valeurs obtenues par le pipeline complet — ce n'est pas une
anomalie, c'est un arbitrage économique différent, rendu possible par des
chiffres non biaisés.

---

## 4. Écart global mesuré sur le jeu de référence (27 routes, CGK)

| Métrique      | Ancien (buggé)  | Nouveau (corrigé) | Écart          |
|----------------|----------------:|-------------------:|---------------:|
| total168       | 177 475 107,73  | 179 685 063,69      | +1,25 %        |
| total84        | 0               | 0                   | —              |
| total24        | 62 762 622,56   | 66 721 787,76       | +6,31 %        |
| **Total combiné** | **240 237 730,29** | **246 406 851,44** | **+2,57 %**  |
| routesUsed     | 27 / 27         | 27 / 27             | identique ✅   |

Cargo (aucune divergence attendue sur ce chemin) :
| Métrique      | Ancien          | Nouveau            | Écart |
|----------------|----------------:|-------------------:|------:|
| total168 cargo | 11 058 772,13   | 11 058 772,13       | 0,00 %|
| routesUsed     | 14 / 27         | 14 / 27             | identique ✅ |

**Interprétation** : l'écart de +2,57% sur le PAX est cohérent avec l'ampleur
combinée des deux bugs corrigés (moins de taxe déduite, temps de vol plus
courts). Le match exact à 0,00% sur le cargo confirme que ce chemin de calcul
n'était pas affecté par ces bugs (pas de re-sélection d'avion sur ce chemin).

---

## 5. Fonctionnalités volontairement absentes de ce projet (pour l'instant)

Ces éléments existaient dans l'ancien projet mais n'ont **pas** été migrés
— soit parce qu'ils étaient du diagnostic mort (jamais utilisé pour le
résultat officiel), soit parce qu'ils sont prévus pour une réintégration
propre plus tard (Jalon 4) :

- ❌ **Supprimé définitivement** : tout `diagnostics/*` labo/shadow
  (routeSwap*, columnPaxSafe*, columnBeamBaseline*, columnBaseline*,
  postFleetReroute*) — n'a jamais piloté le résultat officiel dans l'ancien
  projet, confirmé par les commentaires du code lui-même.
- ❌ **Supprimé définitivement** : `fleetAlternatives.js` et tout le
  mécanisme `fleetReplacement` — fonctionnalité commencée mais jamais finie
  dans l'ancien projet. Sera refaite de zéro si besoin, proprement.
- ⏳ **Pas encore réintégré, prévu** : passe 84h (`useTrue84`)
- ⏳ **Pas encore réintégré, prévu** : repack demande (`demandRepackPass`)
- ⏳ **Pas encore réintégré, prévu** : seconde passe résidus (`residualPasses`)
- ⏳ **Pas encore réintégré, prévu** : target coverage pass
- ⏳ **Pas encore réintégré, prévu** : timeout / Web Worker sur le calcul
- ⏳ **Pas encore réintégré, prévu** : mode simulation bonus demande (fichier
  `bonus/demandBonus.js` copié, mais non branché à l'UI)

---

## 6. Historique des jalons de migration

- **Jalon 0** : snapshots de référence générés depuis l'ancien projet
  (`reference-snapshot.json`, `reference-snapshot__1_.json`,
  `reference-single-circuit.json`)
- **Jalon 1** : squelette Vite + données statiques (`data/*`)
- **Jalon 2** : migration couche par couche avec validation chiffrée à
  chaque étape (math → core → cabin → revenue → cargo → circuitEconomics →
  génération de circuits → candidats → sélection → assemblage final → export)
- **Jalon 3** : interface minimale (upload → calcul PAX/cargo → affichage →
  export), validée à l'identique de la console — **terminé et validé**
- **Jalon 4** : réintégration progressive des fonctionnalités optionnelles,
  une par une, testée isolément avant intégration — **en cours**