# TEST_HISTORY.md — Historique des tests de la zone de test am-clean

Ce document recense les tests effectués en zone de test (jamais dans les fichiers
réels du projet, sauf mention explicite d'intégration confirmée). Statuts utilisés :
**VALIDÉ** / **ÉCHEC** / **INCONCLUSIF** / **VALIDÉ MAIS NON INTÉGRÉ** / **À REVOIR**.

Sauf mention contraire, tous les tests utilisent le jeu de référence à 1894 routes
(`ROUTES_1894`, extrait du fichier `CGK_BON`) et la flotte complète `AIRCRAFTS_RAW`
(95 avions).


## Bloc A — Bugs de fond du noyau (contexte antérieur à cette session de tests
d'architecture, déjà présents dans CHANGES.md sections 1 à 9, résumés ici pour
mémoire)

Ces six points sont considérés **VALIDÉ ET INTÉGRÉ** dans le code réel :
1. `ft` non recalculé pour l'avion final
2. Taxe appliquée deux fois
3. Timeout qui vidait la sélection au lieu de dégrader
4. Absence de cache sur `cabinConfig`/`buildMultiFleetCascade`
5. Rescue 168h sans calcul de rotations
6. Champs `route.profit/rev/tax/cabin` figés sur l'avion-sonde dans
   `finalizeCircuitObject`

Voir CHANGES.md sections 1 à 6 pour le détail complet (déjà rédigé, non repris ici).


## Test 1 — Régénération et vérification du jeu de données ROUTES_1894 (correction)

- **Sujet** : le premier fichier `ROUTES_1894` généré par l'assistant contenait des
  catégories et pays incohérents (ex. CGK-MPM catégorie 3 au lieu de 10, pays
  "Afghanistan" pour une route vers le Mozambique).
- **Hypothèse** : erreur de transcription ou fichier XLSX source corrompu côté
  utilisateur.
- **Résultat** : l'utilisateur a fourni un nouveau CSV corrigé (`CGK_BON`), régénéré,
  vérifié (répartition de catégories cohérente, CGK-MPM confirmé catégorie 10,
  Mozambique).
- **Statut** : **VALIDÉ**. Fichier `routes1894.js` régénéré et utilisé pour tous les
  tests suivants de cette session.


## Test 2 — Reproduction du bug ft historique sur circuit isolé (rappel, hors
session actuelle mais réutilisé comme référence)

Non détaillé ici, déjà couvert par CHANGES.md section 1.


## Bloc B — Diagnostic du timeout/performance sur gros volumes

### Test B1 — Chronométrage initial 1894 routes, timeout par défaut
- **Résultat** : script se "tue" (crash navigateur/onglet), causé par un
  `timeoutMs` de 15 000 ms par défaut qui, une fois dépassé, remplaçait la
  sélection déjà calculée par un tableau vide au lieu de dégrader.
- **Statut** : **VALIDÉ ET INTÉGRÉ** (CHANGES.md section 3).

### Test B2 — Profiling CPU natif (Chrome DevTools) sur 44 puis 1894 routes
- **Résultat** : `cabinConfig` et `buildMultiFleetCascade` concentrent 84-90 % du
  temps d'exécution total. Taux de redondance d'appels mesuré : 99,4 % sur
  `cabinConfig` (44 routes), 99,06 % sur `buildMultiFleetCascade`.
- **Statut** : **VALIDÉ ET INTÉGRÉ** — ajout de caches (Map imbriquée pour
  `cabinConfig`, clé composite avion+routes pour `buildMultiFleetCascade`).
  Gain mesuré : 31 s → 1,67 s sur 44 routes (÷18) ; sur 1894 routes, passage
  d'un état non fonctionnel (crash) à environ 33-50 s selon réglages
  (CHANGES.md section 4).


## Bloc C — Recherche de la cause de la sur-représentation de circuits solo/rescue
sur grands volumes de routes

### Test C1 — Comparaison total168/total24 vs snapshot de référence (1894 routes)
- **Hypothèse initiale (erronée)** : écart de -31 % vs référence dû à un bug de
  régression.
- **Résultat** : l'écart réel, une fois corrigé pour un artefact de comparaison
  (comparaison total168 seul contre total168+total24 combinés), était de **+3,56 %**,
  cohérent avec les corrections des bugs #1 et #2. **Aucune régression réelle.**
- **Statut** : **VALIDÉ** (erreur de méthode de comparaison identifiée et corrigée
  par l'assistant en cours de test).

### Test C2 — Origine des ~474-517+ circuits solo/rescue à grande échelle
- **Hypothèse successivement testées et éliminées** :
  1. Double-comptage de taxe qui ferait basculer les circuits groupés en profit
     négatif → **ÉCHEC**, testé sur 10 vrais circuits groupés, tous largement
     positifs même sous simulation du bug.
  2. Ratio capacité/demande de l'avion-sonde comme facteur de corrélation
     proxy/réel → **ÉCHEC**, deux avions (A220-100 et Tu-154M) au ratio quasi
     identique donnent des corrélations opposées (+0,999 vs -0,961).
  3. Largeur d'exploration du beam insuffisante (`anchorCount`,
     `maxBranchPerStep`, `maxCandidatesPerAircraftPerBand` trop bas) →
     **INCONCLUSIF / EFFET FAIBLE**. Testé jusqu'à anchorCount=40 avec les
     autres paramètres à 40 également : nombre de circuits solo passé de 991
     à 987 seulement (quasi aucun effet à l'échelle complète), malgré un effet
     positif fort observé sur des cas isolés (voir Test C4).
- **Statut global de ce bloc de recherche** : voir Tests C3 et C4 pour la
  conclusion positive obtenue ensuite.

### Test C3 — Corrélation entre score proxy du beam (profit brut par route,
avion-sonde unique) et profit réel final
- **Méthode** : génération d'un échantillon de 50 états candidats par le beam
  pour plusieurs avions-sondes différents sur une même bande de demande,
  comparaison du classement proxy (`state.totalProfit`) au classement réel
  (après passage dans `buildEvaluatedCircuit` avec la vraie cascade
  multi-avions).
- **Résultat** : corrélation de Pearson variable de +0,999 (A220-100) à -0,961
  (Tu-154M) selon l'avion-sonde utilisé. Cas concret : route CGK-JUJ classée
  15e/271 par profit (excellent rang, top 5,5 %) mais jamais retenue par le beam
  car hors du top 3 (`anchorCount` par défaut) et jamais choisie non plus comme
  extension à aucune étape.
- **Statut** : **VALIDÉ** — la variance de corrélation selon l'avion-sonde est
  un fait établi. Cependant, le lien de causalité direct "mauvaise corrélation
  ⇒ routes en rescue" a nécessité les tests suivants pour être confirmé
  précisément (voir C4).

### Test C4 — Localisation exacte du point de perte pour les routes "NEVER"
(jamais générées dans aucun pool)
- **Méthode** : traçage route par route à travers chaque étape du pipeline
  (pool brut → dédup → candidats → sélection finale), sur un échantillon de
  288 routes identifiées comme n'apparaissant dans aucun circuit168 ni
  circuit24 du pool brut.
- **Résultat** :
  - Toutes les 288 routes ont un `ft > 24h` (min 24,25h, max 41h) — exclusion
    automatique du pool 24h par construction (`Math.floor(24/ft) < 1`).
  - Sur un échantillon de 30 de ces routes, rang moyen relatif par profit
    dans leur propre bande de demande : **25,8 %** (bien classées, PAS mal
    classées comme l'hypothèse initiale le supposait). 5/30 étaient même dans
    le top 10 % de leur bande.
  - Cas CGK-JUJ (rang 15/271, top 5,5 %) : forcée comme ancre unique du beam
    → 5 circuits trouvés, profit ≈ 20,5 M chacun, remplissage 168h exact.
  - Testé en ancrage alternatif (30 ancres triées par `ft` décroissant puis
    `dEco` décroissant, au lieu de 3 ancres par profit décroissant) sur la
    bande complète de JUJ (bonne bande, 2000-2999) : JUJ retrouvée, ET le
    meilleur circuit trouvé toutes ancres confondues (rang 1/157 après tri
    global) contient JUJ.
  - Testé : changer uniquement le tri d'extension à chaque étape du beam
    (proximité au temps restant au lieu de profit) sans changer les ancres
    → **ÉCHEC**, JUJ toujours absente.
  - Testé : changer aussi le critère d'élagage du beam en plus du tri
    d'extension → **ÉCHEC**, JUJ toujours absente.
- **Conclusion** : le facteur décisif est le **choix des ancres** (points de
  départ forcés du beam), pas le tri interne d'extension/élagage. Le mécanisme
  actuel (`anchorCount` routes au plus haut profit brut comme seuls points de
  départ possibles) exclut structurellement toute route hors de ce petit
  groupe, même individuellement excellente.
- **Statut** : **VALIDÉ** — cause identifiée avec un niveau de preuve élevé
  (plusieurs expériences convergentes, contre-expériences qui échouent comme
  prévu si l'hypothèse est vraie).

### Test C5 — Ancrage alternatif (ft décroissant puis dEco décroissant, 30
ancres) à l'échelle complète (1894 routes)
- **Résultat** : gain sur "routes jamais dans le pool" faible et non
  monotone selon `anchorCount` testé (3, 10, 20, 30) : 286 → 281 → 275 → non
  testé jusqu'au bout (crash navigateur à 30). Gain sur "routes retenues à la
  sélection finale" également faible et non monotone (1420 → 1434 → 1404).
  L'utilisateur a testé en parallèle d'autres réglages (beamWidth=100,
  maxBranchPerStep illimité) : aucun n'a produit de gain significatif ou
  stable.
- **Conclusion** : l'ancrage alternatif seul, à l'échelle complète, ne suffit
  pas à reproduire le succès observé sur le cas isolé JUJ. Un autre facteur
  limite le système à cette échelle.
- **Statut** : **INCONCLUSIF** sur le bénéfice net à l'échelle complète,
  bien que **VALIDÉ** sur le principe (cas isolé JUJ).

### Test C6 — Caractérisation systématique du taux d'utilisation des routes
par bande (avion A350-900XWB, toutes bandes testables)
- **Résultat** : sur la bande 3000-3999 (430 routes disponibles), seulement
  **14 routes distinctes** utilisées dans les 12 circuits produits par le
  beam avec réglages par défaut (`anchorCount=4`, `maxBranchPerStep=12`,
  `maxCandidatesOut=12`). Passage à `maxCandidatesOut=50` : seulement 15-28
  routes distinctes selon la bande (gain marginal). Profil profit/heure des
  routes utilisées vs jamais utilisées quasi identique (119 156 vs 116 703,
  écart 2,1 %) — confirme que ce n'est pas un problème de qualité mais de
  diversité de la sortie du beam.
- **Statut** : **VALIDÉ** — quantifie précisément et systématiquement (pas
  seulement sur des cas isolés comme JUJ/AZR) l'ampleur du problème de
  couverture.

### Test C7 — Sélection diversifiée en sortie du beam (algorithme glouton :
maximise les nouvelles routes couvertes, profit en critère secondaire)
- **Première tentative** : bug de calcul dans le script de test de l'assistant
  a fait croire à un effondrement du profit (2 043 940 au lieu de ~20,4 M) —
  **erreur de script identifiée et corrigée**, pas un vrai résultat.
- **Résultat corrigé, bande isolée (3000-3999, A350-900XWB)** :
  - Coupe classique (12 meilleurs par profit) : 14 routes couvertes, profit
    moyen/circuit ≈ 20 445 147
  - Coupe diversifiée (12 circuits, depuis exploration élargie
    anchorCount=15/maxCandidatesOut=100) : 26 routes couvertes, profit moyen
    ≈ 20 456 134 (écart de 0,05 % avec la version classique, négligeable)
  - Coupe diversifiée (30 circuits) : 44 routes couvertes, profit moyen ≈
    20 451 149
  - Temps : 26 ms pour l'exploration élargie contre 6 ms pour les réglages
    par défaut — négligeable à l'échelle du pipeline complet.
- **Résultat à l'échelle complète (1894 routes)** :
  - Routes jamais dans le pool : 288 → **194**
  - Routes perdues à la sélection finale : 186 → **267** (augmentation)
  - Routes finales retenues : 1420 → **1433** (+13 net)
  - Circuits168 solo mal remplis dans la sélection finale : **0** (élimination
    complète)
  - Circuits24 solo-rescue dans la sélection finale : **0**
  - Temps : ≈ 33 s (identique à la référence)
- **Statut** : **VALIDÉ MAIS NON INTÉGRÉ**. Résultat solide et non ambigu sur
  l'élimination des circuits solo mal remplis, à temps égal. Gain net en
  nombre de routes retenues modeste (+13/1894) car le problème se déplace
  vers la sélection finale (`selectCandidateColumnsBeam`), qui n'a pas reçu
  le même traitement. Piste de prolongement identifiée mais non commencée :
  appliquer une logique de diversification équivalente à
  `beamSearchSelection.js` — le contenu exact et à jour de ce fichier n'a
  pas encore été relu dans cette session avant de proposer une modification.


## Bloc D — Passe de complétion ciblée (approche alternative à C7)

### Test D1 — Passe 2 ciblée sur routes jamais couvertes en 168h
- **Méthode** : garder la génération standard (Passe 1) inchangée ; identifier
  les routes jamais présentes dans un circuit168 (orphelines totales + routes
  seulement en 24h) ; pour chacune, forcer un beam avec cette route comme
  ancre unique, sur tous les avions éligibles.
- **Résultat (1894 routes)** :
  - Routes ciblées : 534
  - Circuits trouvés pour ces routes : 533/534
  - Routes survivant à la sélection finale parmi les 534 ciblées : 249
    (285 perdues)
  - Gain net global : 1420 → 1437 (+17)
  - Effet sur les routes qui étaient déjà bien traitées par la Passe 1 seule :
    légère amélioration (149 pertes "pures Passe 1" contre 186 en référence),
    pas de dégradation détectée
  - Temps : +11 s environ (33 s → 44 s)
- **Statut** : **VALIDÉ MAIS NON INTÉGRÉ**. N'a pas été comparé formellement
  au résultat du Test C7 (approche différente, ordre de grandeur de gain net
  similaire : +17 ici contre +13 en C7, mais méthodes non directement
  comparables en l'état — bandes/paramètres différents entre les deux tests).


## Bloc E — Passes optionnelles (repack, résidus, target coverage) branchées
ensemble pour la première fois à grande échelle

### Test E1 — Pipeline complet avec repack + résidus + target coverage
branchés, réglages par défaut (1894 routes)
- **Résultat** :
  - Passe 1 seule : total168 = 14 059 218 976,80 / total24 = 7 038 376 202,17
  - Après repack : total168 chute à 12 730 445 637,49 (**delta -1 328 773 339**)
  - Après résidus : +67 709 264
  - Après target coverage : delta = 0 (seuils internes non atteints dans ce
    run)
  - Gain net global vs Passe 1 seule : **-1 249 979 779** (négatif)
- **Diagnostic** : `demandRepackPass.js` optimise un score de fit
  temps/demande sans aucune pondération sur le profit, et peut donc accepter
  des échanges de routes qui dégradent fortement le profit total.
- **Statut** : **VALIDÉ** (le problème est réel et quantifié), mais la
  correction proposée (garde-fou refusant tout échange faisant baisser le
  profit total) n'a pas été validée avec succès : le test censé le vérifier a
  produit un `total168` identique au run sans garde-fou à la décimale près,
  ce qui indique que le garde-fou n'a probablement pas été réellement exercé
  par le script (bug de test suspecté, non confirmé, non corrigé dans cette
  session). **Statut de la correction : À REVOIR.**


## Bloc F — Audit architectural étape par étape (méthode adoptée après le
constat de dispersion des correctifs ponctuels)

### Test F1 — Étape 1 : dispersion des routes vers les blocs de pool
(`groupRoutesByPoolBlock`)
- **Résultat** : 1894 routes en entrée, 1894 réparties, aucune perte.
- **Statut** : **VALIDÉ**, aucune anomalie.

### Test F2 — Étape 2 : éligibilité avions par bloc (`aircraftsForPoolBlock`)
- **Résultat initial** : anomalie apparente (avions de catégorie supérieure au
  plafond du bloc visibles comme candidats).
- **Clarification** : ce n'est pas un bug mais un rôle attendu de
  `testCatMin` (borne basse uniquement) — CEPENDANT la vérification a mené à
  la découverte du point 10 (voir CHANGES_ADDITIONS.md), une vraie
  optimisation de performance sans lien avec une erreur de règle.
- **Statut** : **VALIDÉ ET CORRECTION IDENTIFIÉE** (plafond `block.max`),
  voir Bloc G.

### Test F3 — Étape "avions éligibles par route" — vérification distance/range
- **Résultat** : confirmé que `enrichRouteEconomics` applique bien le filtre
  distance/catégorie ; le pré-filtre en amont testé séparément (Bloc G,
  Test G2) n'apporte pas de gain.
- **Statut** : **VALIDÉ**, aucune anomalie réelle, terminologie clarifiée
  (voir CHANGES_ADDITIONS.md section 15).

### Test F4 (= Test C6 renuméroté dans l'ordre chronologique de l'audit) —
Étape "construction de circuit" : voir Bloc C, Test C6 et C7 ci-dessus pour
le détail complet.

### Test F5 — Étape 3 : répartition en bandes de demande (`makeDemandBands`)
- **Résultat** : 1064 routes éligibles pour l'avion test, réparties dans les
  bandes sans perte (1064 = 1064). Bandes bien contiguës et sans trou, de
  0-999 à 20000+.
- **Statut** : **VALIDÉ**, aucune anomalie.


## Bloc G — Tests d'optimisation de performance ciblée (plafond catégorie,
pré-filtre)

### Test G1 — Plafond catégorie seul (`cat <= block.max`)
- Voir CHANGES_ADDITIONS.md section 10. **VALIDÉ**, équivalence stricte
  prouvée (profit et nombre de circuits identiques au chiffre près),
  gain de temps réel (33,25 s → 14,87 s sur ce test précis).
- **Statut : VALIDÉ MAIS NON INTÉGRÉ au fichier réel.**

### Test G2 — Pré-filtre distance/catégorie en amont d'`enrichRouteEconomics`,
garde de sécurité conservée
- Voir CHANGES_ADDITIONS.md section 11. **ÉCHEC** (gain non significatif,
  -0,07 s).
- **Statut : testé, rejeté. Aucune intégration prévue.**


## Récapitulatif des statuts par grand sujet

| Sujet | Statut | Intégré au code réel ? |
|---|---|---|
| Bugs #1 à #6 (ft, taxe, timeout, cache, rotations rescue, champs figés) | VALIDÉ | ✅ OUI |
| Régénération ROUTES_1894 depuis CGK_BON | VALIDÉ | ✅ OUI (fichier de données) |
| Plafond catégorie `aircraftsForPoolBlock` | VALIDÉ | ❌ NON — action requise |
| Pré-filtre distance/catégorie | ÉCHEC | ❌ Non prévu |
| Corrélation proxy/réel du beam (constat) | VALIDÉ | — (constat, pas une modif) |
| Cause exacte des routes NEVER (choix des ancres) | VALIDÉ | — (constat) |
| Ancrage alternatif (ft/dEco, 30 ancres) à l'échelle | INCONCLUSIF | ❌ NON |
| Sélection diversifiée en sortie du beam | VALIDÉ MAIS NON INTÉGRÉ | ❌ NON |
| Passe 2 ciblée (complétion des orphelines) | VALIDÉ MAIS NON INTÉGRÉ | ❌ NON |
| Repack/résidus/target coverage branchés ensemble | VALIDÉ (problème identifié) | ❌ NON branchés |
| Garde-fou de profit sur demandRepackPass | À REVOIR | ❌ NON (test non concluant) |


## Points explicitement marqués INCERTAIN (à ne pas traiter comme acquis)

- L'effet exact du garde-fou de profit sur `repackSimilarDemandCircuits168` —
  le test réalisé n'a probablement pas exercé le garde-fou (résultat
  identique au run sans garde-fou), donc son efficacité réelle reste
  **INCERTAINE**.
- La comparaison directe entre la piste "sélection diversifiée" (Bloc C,
  Test C7) et la piste "passe 2 ciblée" (Bloc D, Test D1) n'a pas été faite
  sur un même jeu de paramètres strictement comparable — lequel est
  supérieur, ou s'ils sont combinables, est **INCERTAIN**.
- Le comportement de `selectCandidateColumnsBeam`/`beamSearchSelection.js`
  face à une logique de diversification n'a pas été testé — son contenu
  exact et à jour n'a pas été relu dans cette session avant la pause sur ce
  sujet.
- Le nombre de circuits24 solo-rescue dans la configuration de référence
  (réglages actuels, sans les modifications testées) n'a pas été mesuré avec
  la même précision que dans le Test C7 — seule la configuration "après
  modifications" a ce chiffre exact (0). La comparaison avant/après sur ce
  point précis est donc **INCERTAINE** faute de mesure de référence
  équivalente.