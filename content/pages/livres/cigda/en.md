---
title: "Combinatorial Inference in Geometric Data Analysis"
locale: en
slug: "livres/cigda"
description: "Combinatorial Inference in Geometric Data Analysis (Chapman & Hall/CRC, 2019): combinatorial tests, companion R scripts and data, research case studies."
---

## Overview

*Combinatorial Inference in Geometric Data Analysis* provides a combinatorial approach to statistical inference adapted to Euclidean clouds of points arising from Geometric Data Analysis (GDA). The book develops a unified framework for *typicality tests* (comparing a group to a reference population) and *homogeneity tests* (comparing several subclouds), relying on combinatorial permutation rather than parametric distributional assumptions.

## Authors and Publisher

**Brigitte Le Roux, Solène Bienaise, Jean-Luc Durand** — Chapman & Hall/CRC, Computer Science & Data Analysis Series, 2019.  
[Publisher's page](https://www.crcpress.com/Combinatorial-Inference-in-Geometric-Data-Analysis/Roux-Bienaise-Durand/p/book/9781498781619)

## Table of Contents

| | Chapter | Page |
|---|---|---|
| | Preface | vii |
| | Symbols | xi |
| **1** | Introduction | 1 |
| | 1.1 On combinatorial inference | 1 |
| | 1.2 On Geometric Data Analysis | 4 |
| | 1.3 On Inductive Data Analysis | 5 |
| | 1.4 Computational aspects | 6 |
| **2** | Cloud of Points in a Geometric Space | 9 |
| | 2.1 Basic statistics | 10 |
| | 2.2 Covariance structure of a cloud | 14 |
| | 2.3 Mahalanobis distance and principal ellipsoids | 20 |
| | 2.4 Partition of a cloud | 25 |
| **3** | Combinatorial Typicality Tests | 29 |
| | 3.1 The typicality problem | 29 |
| | 3.2 Combinatorial typicality test for mean point | 32 |
| | 3.3 One-dimensional case: typicality test for mean | 45 |
| | 3.4 Combinatorial typicality test for variance | 49 |
| | 3.5 Combinatorial inference in GDA | 51 |
| | 3.6 Computations with R and Coheris SPAD software | 55 |
| **4** | Geometric Typicality Test | 65 |
| | 4.1 Principle of the test | 65 |
| | 4.2 Geometric typicality test for mean point | 69 |
| | 4.3 One-dimensional case: typicality for mean | 86 |
| | 4.4 The case of a design with two repeated measures | 90 |
| | 4.5 Other methods | 92 |
| | 4.6 Computations with R and Coheris SPAD software | 97 |
| **5** | Homogeneity Permutation Tests | 107 |
| | 5.1 The homogeneity problem | 107 |
| | 5.2 Principle of combinatorial homogeneity tests | 108 |
| | 5.3 Homogeneity of independent groups: general case | 109 |
| | 5.4 Homogeneity of two independent groups | 116 |
| | 5.5 The case of a repeated measures design | 133 |
| | 5.6 Other methods | 140 |
| | 5.7 Computations with R and Coheris SPAD software | 141 |
| **6** | Research Case Studies | 153 |
| | 6.1 The Parkinson study | 156 |
| | 6.2 The Members of French Parliament and Globalisation | 170 |
| | 6.3 The European Central Bankers study | 188 |
| | 6.4 Cognitive Tests and Education | 200 |
| | Bibliography | 245 |
| | Author Index | 250 |
| | Subject Index | 252 |

## Companion Materials

### Data and Simplified R Scripts

The simplified R scripts below compute observed significance levels (p-values) and compatibility regions for Chapters 3, 4 and 5.

**Chapter 3 — Combinatorial Typicality Tests**

Typicality tests consist in comparing the observations of a group with the ones of a reference population of which the group may or may not be a subset. Two test statistics are studied: (1) the Mahalanobis distance between points with respect to the covariance structure of the reference cloud; (2) the variance of the cloud.

- *Multidimensional case* (Euclidean clouds, see pp. 55–59) — reference data ("Target" example): [`Target_reference.txt`](/shared/data/livres/CIGDA/Data/Target_reference.txt) ; group data: [`Target_group.txt`](/shared/data/livres/CIGDA/Data/Target_group.txt) ; R script: [`Combinatorial_Typicality.R`](/shared/data/livres/CIGDA/R_scripts/Combinatorial_Typicality.R).
- *One-dimensional case* (numerical variable) — the previous R script applied to a one-dimensional cloud performs the test with the squared calibrated deviation between means as the test statistic; it does not provide the directional test based on the deviation between means.

**Chapter 4 — Geometric Typicality Test**

The geometric typicality test consists in comparing the mean point of a Euclidean cloud to a reference point by taking the squared Mahalanobis distance between points as a test statistic. This test can be applied to a design with two repeated measures, the basic dataset being the individual differences.

- *Multidimensional case* (Euclidean clouds) — "Target" example data: [`Target.txt`](/shared/data/livres/CIGDA/Data/Target.txt) ; R script (pp. 97–101): [`Geometric_Typicality.R`](/shared/data/livres/CIGDA/R_scripts/Geometric_Typicality.R).
- *One-dimensional case* (numerical variable) — the previous R script applied to a one-dimensional cloud provides the results corresponding to a test with the calibrated deviation between the group mean and the reference mean as test statistic.
- *Design with two repeated measures* — Student's example: [`Student.txt`](/shared/data/livres/CIGDA/Data/Student.txt).

**Chapter 5 — Homogeneity Tests**

The homogeneity tests presented in this chapter consist in comparing several subclouds by taking the M-variance between the mean points of subclouds as a test statistic — that is, the variance calculated from the Mahalanobis distance between points. The book studies the case of several *independent groups* and the case of *repeated measures*. In the case of several independent groups, several permutation schemes are studied depending on whether the comparison is *global*, *partial*, or *specific* (see pp. 109–110).

- Data (p. 142): [`Target_4.txt`](/shared/data/livres/CIGDA/Data/Target_4.txt)
- R script (pp. 142–147, partial or specific comparison of two independent groups): [`Homogeneity.R`](/shared/data/livres/CIGDA/R_scripts/Homogeneity.R)

### Full and SPAD-Interfaced R Scripts

The full R scripts implement the methods described in the book. Each ZIP archive contains three scripts ("main", "parameters", "core"), data files and a user's guide.

- Combinatorial typicality tests (Chapter 3): [`CIGDA_combi.zip`](/shared/data/livres/CIGDA/R_scripts/CIGDA_combi.zip)
- Combinatorial typicality tests — SPAD-interfaced script: [`CIGDA_Comb-v1.1.R`](/shared/data/livres/CIGDA/R_scripts/CIGDA_Comb-v1.1.R)
- Geometric typicality test (Chapter 4) — SPAD-interfaced script: [`CIGDA_Geo-v1.R`](/shared/data/livres/CIGDA/R_scripts/CIGDA_Geo-v1.R)
- Homogeneity permutation tests (Chapter 5) — SPAD-interfaced script: [`CIGDA_Homog-v1.R`](/shared/data/livres/CIGDA/R_scripts/CIGDA_Homog-v1.R)

### Research Case Studies (Chapter 6)

For each case study, data are provided in Excel format together with a SPAD project that reproduces the analyses presented in Chapter 6.

1. **The Parkinson Study** — data: [`Parkinson.xls`](/shared/data/Logiciels/Data/Parkinson.xls); SPAD project: [`The Parkinson Study`](/shared/data/livres/CIGDA/Spad_Projects/The%20Parkinson%20Study_2019_03_31.spad)
2. **Members of French Parliament and Globalisation** — data: [`MPs&Globalisation.xls`](/shared/data/livres/CIGDA/Data/MPs%26Globalisation.xls); SPAD project: [`MPs-Globalisation`](/shared/data/livres/CIGDA/Spad_Projects/MPs-Globalisation_2019_03_31.spad)
3. **The European Central Bankers Study** — data and SPAD project available on request from Frédéric Lebaron.
4. **Cognitive Tests and Education** — data: [`CognitiveTests.xls`](/shared/data/livres/CIGDA/Data/CognitiveTests.xls); SPAD project: [`Cognitive Study`](/shared/data/livres/CIGDA/Spad_Projects/Cognitive%20Study_2019_01_01.spad)
