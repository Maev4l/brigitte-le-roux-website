---
title: "Combinatorial Inference in Geometric Data Analysis"
locale: fr
slug: "livres/cigda"
description: "Présentation du livre CIGDA (Chapman & Hall/CRC, 2019) : tests combinatoires, données et scripts R, études de cas."
---

## Vue d'ensemble

*Combinatorial Inference in Geometric Data Analysis* propose une approche combinatoire de l'inférence statistique adaptée aux nuages de points euclidiens issus des méthodes d'Analyse Géométrique des Données (AGD). Le livre fournit un cadre unifié pour les *tests de typicalité* (comparer un groupe à une population de référence) et les *tests d'homogénéité* (comparer plusieurs sous-nuages), en s'appuyant sur la permutation combinatoire plutôt que sur des hypothèses distributionnelles paramétriques.

## Auteurs et éditeur

**Brigitte Le Roux, Solène Bienaise, Jean-Luc Durand** — Chapman & Hall/CRC, Computer Science & Data Analysis Series, 2019.  
[Page de l'éditeur](https://www.crcpress.com/Combinatorial-Inference-in-Geometric-Data-Analysis/Roux-Bienaise-Durand/p/book/9781498781619)

## Table des matières

| | Chapitre | Page |
|---|---|---|
| | Préface | vii |
| | Symboles | xi |
| **1** | Introduction | 1 |
| | 1.1 Sur l'inférence combinatoire | 1 |
| | 1.2 Sur l'Analyse Géométrique des Données | 4 |
| | 1.3 Sur l'analyse inductive des données | 5 |
| | 1.4 Aspects computationnels | 6 |
| **2** | Nuage de points dans un espace géométrique | 9 |
| | 2.1 Statistiques de base | 10 |
| | 2.2 Structure de covariance d'un nuage | 14 |
| | 2.3 Distance de Mahalanobis et ellipsoïdes principaux | 20 |
| | 2.4 Partition d'un nuage | 25 |
| **3** | Tests combinatoires de typicalité | 29 |
| | 3.1 Le problème de typicalité | 29 |
| | 3.2 Test combinatoire de typicalité pour le point moyen | 32 |
| | 3.3 Cas unidimensionnel : test de typicalité pour la moyenne | 45 |
| | 3.4 Test combinatoire de typicalité pour la variance | 49 |
| | 3.5 Inférence combinatoire en AGD | 51 |
| | 3.6 Calculs avec R et le logiciel Coheris SPAD | 55 |
| **4** | Test géométrique de typicalité | 65 |
| | 4.1 Principe du test | 65 |
| | 4.2 Test géométrique de typicalité pour le point moyen | 69 |
| | 4.3 Cas unidimensionnel : typicalité pour la moyenne | 86 |
| | 4.4 Cas d'un plan avec deux mesures répétées | 90 |
| | 4.5 Autres méthodes | 92 |
| | 4.6 Calculs avec R et le logiciel Coheris SPAD | 97 |
| **5** | Tests de permutation pour l'homogénéité | 107 |
| | 5.1 Le problème d'homogénéité | 107 |
| | 5.2 Principe des tests combinatoires d'homogénéité | 108 |
| | 5.3 Homogénéité de groupes indépendants : cas général | 109 |
| | 5.4 Homogénéité de deux groupes indépendants | 116 |
| | 5.5 Cas d'un plan avec mesures répétées | 133 |
| | 5.6 Autres méthodes | 140 |
| | 5.7 Calculs avec R et le logiciel Coheris SPAD | 141 |
| **6** | Études de cas | 153 |
| | 6.1 L'étude Parkinson | 156 |
| | 6.2 Les députés et la mondialisation | 170 |
| | 6.3 Les banquiers centraux européens | 188 |
| | 6.4 Tests cognitifs et éducation | 200 |
| | Bibliographie | 245 |
| | Index des auteurs | 250 |
| | Index des sujets | 252 |

## Documents complémentaires

### Données et scripts R simplifiés

Les scripts R simplifiés ci-dessous calculent les seuils observés (p-values) et les régions de compatibilité pour les chapitres 3, 4 et 5.

**Chapitre 3 — Tests combinatoires de typicalité**

Le test combinatoire de typicalité consiste à comparer un groupe d'observations à une population de référence en prenant comme statistique de test soit le carré de la distance de Mahalanobis entre points moyens, soit la variance du nuage.

- *Cas multidimensionnel* (nuages euclidiens) — données de référence (exemple « Cible ») : [`Target_reference.txt`](/data/livres/CIGDA/Data/Target_reference.txt) ; données du groupe : [`Target_group.txt`](/data/livres/CIGDA/Data/Target_group.txt) ; script R des pages 55 à 58 : [`Combinatorial_Typicality.R`](/data/livres/CIGDA/R_scripts/Combinatorial_Typicality.R).
- *Cas unidimensionnel* (variable numérique) — le script R précédent appliqué à un nuage unidimensionnel procède au test avec pour statistique de test le carré de l'écart calibré entre les moyennes, et non au test directionnel basé sur la différence des moyennes.

**Chapitre 4 — Test géométrique de typicalité**

Le test géométrique de typicalité consiste à comparer le point moyen d'un nuage euclidien à un point de référence en prenant comme statistique de test le carré de la distance de Mahalanobis entre points. Ce test s'applique aussi à un plan avec deux mesures répétées, les données de base étant alors le « protocole des différences ».

- *Cas multidimensionnel* (nuages euclidiens) — données de l'exemple « Cible » : [`Target.txt`](/data/livres/CIGDA/Data/Target.txt) ; script R des pages 97 à 101 : [`Geometric_Typicality.R`](/data/livres/CIGDA/R_scripts/Geometric_Typicality.R).
- *Cas unidimensionnel* (variable numérique) — le script R précédent appliqué à un nuage unidimensionnel donne les résultats correspondant à l'écart calibré entre la moyenne du groupe et la moyenne de référence.
- *Plan avec deux mesures répétées* — données de Student : [`Student.txt`](/data/livres/CIGDA/Data/Student.txt).

**Chapitre 5 — Tests d'homogénéité**

Les tests d'homogénéité présentés dans ce chapitre consistent à comparer plusieurs sous-nuages en prenant comme statistique de test la M-variance des points moyens des sous-nuages — c'est-à-dire la variance calculée à partir de la distance de Mahalanobis entre points. Nous étudions le cas d'un plan avec plusieurs *groupes indépendants* et celui avec des *mesures répétées*. Dans le cas de plusieurs groupes indépendants, plusieurs systèmes de permutation des données sont envisagés selon que la comparaison est globale, partielle ou spécifique (voir pages 109-110).

- Données (p. 142) : [`Target_4.txt`](/data/livres/CIGDA/Data/Target_4.txt)
- Script R des pages 142–147 (comparaison partielle ou spécifique de deux groupes indépendants) : [`Homogeneity.R`](/data/livres/CIGDA/R_scripts/Homogeneity.R)

### Scripts R complets et interfacés SPAD

Les scripts R complets permettent la mise en œuvre intégrale des méthodes. Chaque archive ZIP contient trois scripts (« main », « parameters », « core »), des fichiers de données et un mode d'emploi.

- Tests combinatoires de typicalité (chapitre 3) : [`CIGDA_combi.zip`](/data/livres/CIGDA/R_scripts/CIGDA_combi.zip)
- Tests combinatoires de typicalité — script interfacé SPAD : [`CIGDA_Comb-v1.1.R`](/data/livres/CIGDA/R_scripts/CIGDA_Comb-v1.1.R)
- Test géométrique de typicalité (chapitre 4) — script interfacé SPAD : [`CIGDA_Geo-v1.R`](/data/livres/CIGDA/R_scripts/CIGDA_Geo-v1.R)
- Tests d'homogénéité (chapitre 5) — script interfacé SPAD : [`CIGDA_Homog-v1.R`](/data/livres/CIGDA/R_scripts/CIGDA_Homog-v1.R)

### Études de cas (chapitre 6)

Pour chaque étude de cas, les données sont disponibles en format Excel et un projet SPAD permet de reproduire les analyses.

1. **L'étude Parkinson** — données : [`Parkinson.xls`](/data/Logiciels/Data/Parkinson.xls) ; projet SPAD : [`The Parkinson Study`](/data/livres/CIGDA/Spad_Projects/The_Parkinson_Study_2019_03_31.spad)
2. **Les députés et la mondialisation** — données : [`MPs&Globalisation.xls`](/data/livres/CIGDA/Data/MPs%26Globalisation.xls) ; projet SPAD : [`MPs-Globalisation`](/data/livres/CIGDA/Spad_Projects/MPs-Globalisation_2019_03_31.spad)
3. **Les banquiers centraux européens** — données et projet SPAD sur demande auprès de Frédéric Lebaron.
4. **Tests cognitifs et éducation** — données : [`CognitiveTests.xls`](/data/livres/CIGDA/Data/CognitiveTests.xls) ; projet SPAD : [`Cognitive Study`](/data/livres/CIGDA/Spad_Projects/Cognitive_Study_2019_01_01.spad)
