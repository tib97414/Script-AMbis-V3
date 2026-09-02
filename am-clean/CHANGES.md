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
- ✅ **Copié et validé, en attente de branchement UI** : repack demande
  (`demandRepackPass.js`) — logique de swap vérifiée sur cas artificiel
  (Test 2), inactive sur le jeu de référence 27 routes car les circuits
  générés sont déjà homogènes en interne (pas un bug, juste rien à corriger
  sur ce jeu précis).
- ✅ **Copié et validé, en attente de branchement UI** : seconde passe résidus
  (`residualPasses.js`) — testé avec seuil abaissé à 50 (au lieu de 1500
  par défaut) pour forcer le déclenchement : capte +10 684 355,80 $ de
  profit supplémentaire (7 129 218,24 $ en 168h + 3 555 137,56 $ en 24h),
  sans perte ni doublon sur les circuits originaux. Inactif au seuil par
  défaut sur le jeu de référence 27 routes (résiduel max observé = 900,
  bien en dessous du seuil de 1500).
- ✅ **Copié et validé (logique interne), en attente de branchement UI** :
  target coverage pass (`targetCoveragePass.js`) — `buildTargetCoverageRoutes`
  vérifié isolément sur un cas fabriqué (résiduel eco 3500, résiduel bus 155,
  calculs conformes aux cibles 90%/85%). Inactif sur le jeu de référence
  27 routes : une seule route dépasse le seuil interne `TARGET_COVERAGE_MIN_ECO=300`
  (CGK-DUR, résiduel 403), largement sous le minimum requis de 10 routes
  (`TARGET_COVERAGE_MIN_ROUTES`) pour déclencher une passe.
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

  ---

  ## 7. Bug du timeout qui écrasait la sélection sur des jeux de routes larges

**Statut : corrigé.**

**Fichier concerné** : `src/optimizer/profitMaxPaxOptimizer.js`

**Symptôme découvert** : sur un jeu de 44 routes (contre 27 précédemment), avec
`timeoutMs = 15_000` (valeur par défaut d'origine), le calcul dépassait le
budget de temps pendant la génération du pool (~185 circuits candidats
excellents, fillRate 99%+). Le code, une fois le budget dépassé, remplaçait
la sélection entière par un tableau vide (`{ selected: [] }`) au lieu de
l'exécuter en dégradé — jetant tout le travail de génération déjà effectué.
Conséquence : les 44 routes repartaient toutes en `buildSoloRescueCircuits`,
produisant 44 circuits mono-route avec un fillRate de 5-19% au lieu de
quelques circuits groupés à 99%+ de fillRate.

**Preuve chiffrée** (jeu 44 routes) :
- Avec timeout 15s (bug) : `total168 = 515 133 143,10 $`, 44 circuits168,
  tous `routeCount = 1`, `total24 = 0`
- Avec timeout 60s (corrigé) : `total168 = 416 086 461,99 $`,
  `total24 = 85 677 253,47 $`, 6 circuits168 groupés (routeCount 1,5,7,7,8,8)

**Correctif** : en cas de dépassement du budget de temps, le `beamWidth` de
la sélection est réduit à 4 (dégradé) au lieu de vider la sélection —
préserve un résultat réel, moins optimal qu'avec plus de temps, plutôt
qu'un résultat structurellement dégénéré.

**Écart final vs référence (ancien projet)** sur ce jeu de 44 routes,
timeout suffisant (60s) : +0,79 % (total combiné 501 763 715,45 $ vs
497 811 995,85 $) — cohérent avec les bugs #1 et #2 déjà documentés.

**Point de vigilance** : `timeoutMs` par défaut relevé à 60 000 ms
(auparavant 15 000 ms). Cette valeur reste probablement insuffisante à
mesure que le nombre de routes grandit (voir section 8 sur les pools par
catégorie, en cours de traitement pour réduire le temps de calcul plutôt
que d'augmenter le timeout indéfiniment).

## 8. Performance : cache manquant sur `cabinConfig` (goulot d'étranglement majeur)

**Statut : corrigé.**

**Fichier concerné** : `src/cabin/cabinConfig.js`

**Découvert via** : profiling CPU natif du navigateur (Chrome DevTools,
onglet Performance) sur un jeu de 44 routes long-courrier. `cabinConfig`
et ses appels directs représentaient 84% du temps d'exécution total
(cascade de flotte `buildMultiFleetCascade` : 90,2% du temps cumulé).

**Cause** : `cabinConfig` était appelée sans aucun cache, alors que la
cascade de flotte (jusqu'à 100 avions candidats testés par circuit,
répété pour chaque circuit candidat exploré par le beam search) réutilise
en réalité très souvent les mêmes combinaisons `(seats, dEco, dBus, dFirst)`.

**Mesure du taux de doublon** (jeu 44 routes, bandSize=4000, anchorCount=3) :
- Appels totaux à `cabinConfig` : 31 303 633
- Combinaisons uniques réellement calculées : 182 438
- Taux de doublon : **99,42 %**

**Correctif** : ajout d'un cache mémoïsé (`Map`) sur `cabinConfig`, clé
`seats|dEco|dBus|dFirst|prix|seatTolerance`. Fonction `clearCabinConfigCache()`
ajoutée et appelée dans `useRouteImport.js` à chaque nouvel import de routes
(même pattern que `clearSeatConfigCache()` déjà existant sur `seatConfigs.js`).

**Gain mesuré** (jeu 44 routes, bandSize=4000, anchorCount=3, mêmes conditions) :
- Avant : 31,38 secondes
- Après : 7,78 secondes (÷4)
- `total168`/`total24` identiques à la décimale près avant/après — le cache
  n'a introduit aucune divergence de calcul.

**Point de vigilance non résolu** : ce gain a été mesuré sur 44 routes.
Le nombre d'appels à `cabinConfig` croît avec le volume de routes et le
nombre de circuits candidats explorés par le beam search — sur un jeu de
plusieurs centaines ou milliers de routes (l'ancien projet traitait 1894
routes), même avec ce cache, le temps total et le nombre de clés uniques
pourraient redevenir significatifs. À revalider sur un jeu plus large
avant de considérer la performance définitivement réglée.

## 9. Limite connue : routes avec ft entre ~15h et ~22h mal exploitées (à traiter plus tard)

**Statut : identifié et caractérisé, non corrigé — reporté volontairement.**

**Constat** : sur le jeu de référence à 1894 routes, 517 routes (27,3%) finissent
systématiquement en circuit24h à une seule rotation, un usage très en dessous
de leur potentiel réel (fillRate mécaniquement bas, ex: 20h de vol sur 24h
disponibles).

**Cause identifiée** : ces routes ont un temps de vol (`ft`) compris entre
~15h et ~22h. Cette plage est arithmétiquement défavorable des deux côtés :
- En 24h : `Math.floor(24 / ft) = 1`, une seule rotation possible, jamais 2+.
- En 168h : il faut regrouper 7-8 routes de ce calibre dans la même bande
  de demande pour bien remplir le circuit — une combinatoire que le beam
  search (`beamPackCircuitsMultiAnchor`) peine à trouver, contrairement à
  des groupes de 2-3 routes plus complémentaires.

**Ce n'est pas un bug de migration** : ce comportement est probablement déjà
présent dans l'ancien projet (limite structurelle de l'algorithme de
génération de circuits, pas une régression introduite par la réécriture).
Sur les jeux de test plus petits (27 et 44 routes), cette limite était
invisible faute d'un échantillon assez large pour la révéler statistiquement.

**Piste de correction envisagée (non implémentée)** : une passe ciblée,
similaire à `residualPasses.js`/`targetCoveragePass.js`, qui chercherait
spécifiquement à regrouper les routes dans cette plage de `ft` (15-22h)
entre elles après la génération principale, plutôt que de compter sur le
beam search général à les rencontrer par hasard dans la même bande de
demande. À traiter en item séparé du Jalon 4, après stabilisation du
branchement UI.

**Impact chiffré** : contribue à une partie de l'écart de circuits24h
observé (total24 = 7 038 376 202,17 $ sur le jeu de 1894 routes, contre
0 $ dans l'ancien projet référence) — mais cet écart global reste
positif et cohérent avec les corrections des bugs #1 et #2 (écart
combiné total168+84+24 : +3,56% vs référence).

## 10. Correctif intégré : aircraftsForPoolBlock — plafond de catégorie manquant

**Statut : correction validée en zone de test, INTÉGRATION AU FICHIER RÉEL EN ATTENTE.**

**Fichier concerné** : `src/optimizer/fleetFirstCircuitGeneration.js`, fonction `aircraftsForPoolBlock`.

**Constat** : la fonction ne filtrait que par borne basse (`cat >= block.testCatMin`),
jamais par borne haute (`cat <= block.max`). Conséquence : des avions de catégorie
largement supérieure à celle du bloc étaient testés inutilement, alors qu'ils ne
peuvent, par construction, être compatibles avec aucune route du bloc (règle du jeu :
`route.category >= aircraft.cat`, et aucune route du bloc ne dépasse `block.max`).

**Preuve d'équivalence stricte** (zone de test, 1894 routes) :
- Sans plafond : 33,25 s, profit brut cumulé du pool = 362 274 872 445, circuits168 = 4486, circuits24 = 1873
- Avec plafond (`cat >= testCatMin && cat <= block.max`) : 14,87 s, **mêmes valeurs exactes** pour profit et nombre de circuits

**Conclusion** : gain de performance pur, aucune perte économique. Sûr à intégrer.

**Action requise** : appliquer le correctif dans le fichier réel `fleetFirstCircuitGeneration.js`.


## 11. Piste explorée et rejetée : pré-filtre distance/catégorie avant enrichRouteEconomics

**Statut : testé, gain non significatif, PAS DE CHANGEMENT PRÉVU.**

Hypothèse : ajouter un filtre `distance <= range && category >= cat` avant l'appel à
`enrichRouteEconomics`, en gardant le contrôle existant à l'intérieur de cette
dernière comme garde de sécurité.

**Résultat mesuré** : gain de temps de -0,07 s (négatif, dans la marge de bruit).
Le check interne de `enrichRouteEconomics` est déjà quasi gratuit (deux comparaisons
numériques) et s'exécute avant tout calcul coûteux. Le vrai gain du point 10 venait
d'éviter d'entrer dans toute la boucle de bande/beam pour un avion sans aucune
route compatible dans son bloc — pas d'éviter ce check précis.

**Décision** : `enrichRouteEconomics` garde son filtre interne tel quel, sans
duplication en amont.


## 12. Anomalie majeure identifiée : beam de génération de circuits, biais structurel vers un petit noyau de routes

**Statut : caractérisé et quantifié en zone de test. AUCUNE MODIFICATION INTÉGRÉE.
Piste de correction validée en zone de test isolée uniquement (bande unique et
échelle complète), NON intégrée au pipeline réel.**

### Constat initial
Sur le jeu de référence à 1894 routes, un nombre important de routes ne sont jamais
utilisées dans un circuit groupé et finissent soit non couvertes, soit en circuit
solo (168h ou 24h à une seule rotation), malgré des profils économiques
(`profit/heure`) très proches des routes qui, elles, sont bien exploitées.

### Preuve chiffrée (bande de demande 3000-3999, avion A350-900XWB, 430 routes disponibles)
- Réglages actuels du pipeline (`anchorCount=4`, `maxBranchPerStep=12`,
  `maxCandidatesOut=12`) : seulement **14 routes distinctes** utilisées sur 430,
  quel que soit le nombre de circuits produits (les 12 meilleurs circuits par
  profit se recouvrent presque totalement).
- Profil profit/heure : routes utilisées ≈ 119 156, routes jamais utilisées ≈
  116 703 (écart de seulement 2,1 %) — confirme que ce n'est pas un problème de
  qualité des routes ignorées, mais de diversité de la sortie du beam.

### Cause identifiée
La coupe finale du beam (`merged.sort(profit).slice(0, maxCandidatesOut)`) retient
les meilleurs circuits par profit total, qui sont presque tous des variantes du même
petit noyau de routes à très haut profit. Augmenter `anchorCount` ou
`maxCandidatesOut` seuls n'apporte qu'un gain marginal (testé jusqu'à anchorCount=40,
maxBranchPerStep=40 : quasi aucun changement sur le nombre de routes jamais
générées à l'échelle des 1894 routes).

### Piste de correction testée avec succès, en zone de test isolée uniquement
Remplacement de la coupe finale par une **sélection diversifiée** (algorithme
glouton : maximise les nouvelles routes couvertes, profit en critère secondaire),
appliquée sur une exploration élargie en amont (`anchorCount=15`,
`maxCandidatesOut=100` en interne avant la coupe diversifiée finale à 12-30
circuits par bande).

**Résultat sur la bande isolée (3000-3999, A350-900XWB)** :
- Coupe classique (profit pur) : 14 routes couvertes, profit moyen/circuit ≈ 20 445 147
- Coupe diversifiée (12 circuits) : 26 routes couvertes, profit moyen/circuit ≈
  20 456 134 (écart de 0,05 %, négligeable)
- Coupe diversifiée (30 circuits) : 44 routes couvertes, profit moyen/circuit ≈
  20 451 149

**Résultat à l'échelle complète (1894 routes, pipeline dupliqué en zone de test)** :

| Métrique | Réglages actuels (référence) | Exploration élargie + sélection diversifiée |
|---|---|---|
| Routes jamais dans le pool | 288 | 194 |
| Routes perdues à la sélection finale | 186 | 267 |
| Routes finales retenues | 1420 | 1433 |
| Circuits168 solo (mal remplis) dans la sélection finale | présents | **0** |
| Circuits24 solo-rescue dans la sélection finale | INCERTAIN (non mesuré avec cette précision avant) | **0** |
| Temps | ≈ 33 s | ≈ 33 s (identique) |

### Conclusion actuelle — INCONCLUSIF sur le bénéfice net global
Le gain net en routes retenues est modeste (+13 sur 1894) car réduire les pertes
au niveau du pool (génération) déplace une partie du problème vers la sélection
finale (`selectCandidateColumnsBeam`), qui n'a pas encore reçu le même traitement
de diversification. Le résultat le plus solide et non ambigu de cette piste est
l'élimination complète des circuits solo mal remplis dans la sélection finale
(168h et 24h), à temps d'exécution égal.

**Prochaine étape identifiée, non commencée** : appliquer une logique de
diversification équivalente au niveau de `selectCandidateColumnsBeam`
(`beamSearchSelection.js`), dont le contenu exact n'a pas encore été relu/vérifié
dans cette session avant de proposer une modification.

**Aucun changement n'a été appliqué aux fichiers réels du projet sur ce point.**


## 13. Passe de complétion ciblée (Passe 2) — testée, VALIDÉE MAIS NON INTÉGRÉE

**Statut : fonctionnelle en zone de test, non intégrée, probablement supplantée
par la piste du point 12 mais pas formellement comparée entre elles.**

Approche testée : garder la génération standard (Passe 1) inchangée, puis lancer
une passe ciblée uniquement sur les routes jamais couvertes en 168h (orphelines +
routes présentes seulement en 24h), en forçant chacune comme ancre unique du beam.

**Résultat (1894 routes)** :
- Routes ciblées par la passe 2 : 534
- Circuits trouvés pour ces routes : 533/534 (quasi 100 %)
- Mais seulement ~249 routes survivent à la sélection finale une fois les
  circuits de la passe 2 mis en compétition avec ceux de la passe 1
  (285 perdues sur les 534 ciblées)
- Gain net global : +17 routes retenues (1420 → 1437)
- Pas d'effet négatif détecté sur les routes qui étaient déjà bien traitées par
  la passe 1 (149 pertes "pures passe 1" contre 186 en référence — légère
  amélioration, pas de dégradation)
- Temps : +11 s environ par rapport à la passe 1 seule (33 s → 44 s)

**Ce test n'a pas été comparé formellement à la piste du point 12** (exploration
élargie + sélection diversifiée). Les deux approches ciblent le même problème par
des moyens différents ; laquelle est préférable, ou si elles sont combinables,
reste à déterminer.


## 14. Passes optionnelles (repack, résidus, target coverage) — branchement testé en zone de test uniquement

**Statut : toujours VALIDÉES ISOLÉMENT (voir sections précédentes de CHANGES.md),
testées ENSEMBLE en zone de test sur 1894 routes pour la première fois. NON
BRANCHÉES dans le fichier réel `useGlobalOptimization.js`.**

**Résultat du test combiné (1894 routes, réglages par défaut anchorCount=3)** :
- Passe 1 seule : total168 = 14 059 218 976,80 / total24 = 7 038 376 202,17
- Après repack (SANS garde-fou de profit) : total168 chute à 12 730 445 637,49
  (delta : **-1 328 773 339**)
- Après résidus : +67 709 264 (petit gain)
- Après target coverage : aucun changement mesuré dans ce run (seuils internes
  non atteints)

### Anomalie identifiée : conflit d'objectifs entre demandRepackPass et le score
de profit du beam

**Cause** : `demandRepackPass.js` (via `circuitScoring.js`, fonction
`repackSimilarDemandCircuits168`) optimise un score de "fit" (écart au temps
cible 168h + homogénéité de la demande entre routes d'un même circuit), **sans
aucune pondération sur le profit**. Il peut donc accepter un échange de routes
qui améliore le remplissage/l'homogénéité tout en dégradant fortement le
profit total — ce qui a été mesuré (-1,33 milliard sur 1894 routes).

**Piste de correction proposée par l'utilisateur, testée mais résultat NON
CONFIRMÉ** : ajout d'un garde-fou dans `repackSimilarDemandCircuits168` refusant
tout échange où le profit total des deux circuits concernés diminuerait.
Un test de ce garde-fou a été tenté en zone de test mais le résultat obtenu
(`total168` identique au run sans garde-fou, à la décimale près) indique que le
garde-fou n'a probablement pas été réellement exercé par le script de test
(bug de script suspecté, non confirmé, non ré-exécuté avec succès dans cette
session).

**Statut de cette piste : À REVOIR.** Le garde-fou proposé n'a pas été validé
par un test concluant.


## 15. Correction terminologique importante concernant les catégories

**Règle confirmée par l'utilisateur (corrige une erreur de raisonnement de
l'assistant survenue en cours de session)** :

La règle de compatibilité catégorie route/avion est :
`route.category >= aircraft.cat` → avion autorisé sur la route.

Ce n'est **pas** l'inverse. Un avion de catégorie basse peut voler une route de
catégorie élevée ; l'inverse est interdit. `testCatMin` (dans `data/pools.js`)
sert uniquement de borne basse pour élargir la recherche du premier avion
constructeur du circuit vers des catégories inférieures à celle du bloc — il n'y
a jamais eu de plafond haut légitime avant la découverte du point 10 ci-dessus
(où le plafond `block.max` s'est révélé être une pure optimisation de
performance, sans lien avec une règle économique).

**Rappel également confirmé** : cette logique de pool/plafond ne concerne QUE le
premier avion (constructeur) du circuit. Les avions suivants de la cascade de
flotte (`buildMultiFleetCascade`) restent libres de toute catégorie, sous
réserve d'être individuellement compatibles avec les routes et la fenêtre de
temps (168h/24h) du circuit, et sont choisis sur leur résultat financier total,
pas sur leur capacité passagers brute.