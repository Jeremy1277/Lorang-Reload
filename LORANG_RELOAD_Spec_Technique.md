# LORANG RELOAD — Spec technique

**Statut** : Draft v1 — à valider avant développement
**Périmètre** : Tous pays sauf Luxembourg
**Auteur** : Jeremy Ducrot / Cellule 3PL – Lorang & Portmann

---

## 1. Objectif

Anticiper le rechargement des camions Lorang Fleet en croisant :
- la **disponibilité du jour** de chaque camion (livraison prévue ou pas)
- l'**historique Winsped** des transports déjà réalisés pour compte de tiers, pour repérer des clients ayant chargé près du point de livraison prévu

But : proposer à l'exploitant une liste de clients potentiels à solliciter pour un rechargement, plutôt que de laisser un camion rentrer à vide.

---

## 2. Sources de données

| Source | Rôle | Contenu utile |
|---|---|---|
| `XXAV_OrderOverview` | Historique Winsped | Chargements/livraisons passés : véhicule, client, adresses, dates |
| `XXAV_Vehicle` | Référentiel camions Lorang | Immatriculations, rattachement Lorang SA / GMBH / tractionnaire |
| `XXAV_CMCCustomer` | Référentiel clients | Coordonnées complètes (adresse, contact) |
| SharePoint `PROJECT SALES & DEV` — `CODE TRANSPORTEURS` | Codes transporteurs gérés en exploitation | **Non utilisé pour le filtre véhicule** (ne couvre pas les affrétés/tractionnaires) — conservé comme référence secondaire uniquement |
| LORANG FLEET (`FLOWFLEET_V48.html`) | Appli existante | Logique de statut/rechargement déjà en place, à réutiliser telle quelle plutôt qu'à recoder |

**Décision actée** : le filtre "véhicule Lorang" se fait via **XXAV_Vehicle / LORANG FLEET**, sur le périmètre complet : Lorang SA, Lorang GMBH, et tous les tractionnaires actifs dans Lorang Fleet (AT Trading, Bortrans, Ekrany, etc.). Le fichier CODE TRANSPORTEURS n'est pas la source de filtrage car il ne couvre que les codes exploitation, pas les affrétés/tractionnaires.

---

## 3. Statuts journaliers (réutilisation logique LORANG FLEET)

Pour chaque camion Lorang Fleet, par jour :

| Statut | Condition | Couleur |
|---|---|---|
| Livraison prévue | Une livraison existe pour le jour J | 🟢 Vert |
| Rien de prévu — jour même | Aucune livraison pour le jour J | 🔴 Rouge |
| Rien de prévu — jours suivants | Aucune livraison pour J+1, J+2... | 🟠 Orange |

Affichage : pays, code postal, ville de livraison (pour les camions en vert), ou dernier point de livraison connu (pour les rouges/oranges, cf. §4).

---

## 4. Algorithme de matching (cœur de l'appli)

### 4.0 Mapping des tables réelles (confirmé sur échantillon)

**Filtre "véhicule Lorang Fleet"** — `XXAV_Vehicle.KreNr` croisé avec `XXAV_CMCCustomer.KundenNr` donne **36 `KreNr` distincts** = le périmètre exact Lorang Fleet (Lorang S.A., Lorang GmbH, + tous les tractionnaires actifs : AT Trading, Ekrany, Vanost, Nostrada, Truck Aftan, Di Egidio, etc.). C'est cette liste de 36 `KreNr` qui sert de filtre, **pas** le champ `FremdLKW` (ne discrimine pas correctement Lorang vs affrétés).

Dans `XXAV_OrderOverview`, le rattachement au véhicule/transporteur se fait via :
- `KfzZugID` → matche `XXAV_Vehicle.LKW` (immatriculation tracteur)
- `FFNr` → matche `KundenNr`/`KreNr` (code transporteur, doit être dans la liste des 36)

**Adresses — deux blocs redondants pour chaque point, à ne retenir qu'une fois :**
- Pickup : `AbgLKZ/AbgPLZ/AbgOrt` = `BeladestelleLKZ/PLZ/Ort` (valeurs identiques)
- Livraison : `EmgLKZ/EmgPLZ/EmgOrt` = `EntladestelleLKZ/PLZ/Ort` (valeurs identiques)

**Dates** : `BelVonDat/BelBisDat` = fenêtre de **chargement** · `EntVonDat/EntBisDat` = fenêtre de **livraison**

**⚠️ Distinction clé — deux rôles différents pour le rechargement :**

| Champ | Rôle | Usage dans l'algo |
|---|---|---|
| `AbsNr` / `AbsenderName1` / `AbsenderLKZ` / `AbsenderPLZ` / `AbsenderOrt` | **Expéditeur physique** — localisation réelle du chargement | Géocodage + calcul de distance |
| `AufgeberNr` / `AuftraggeberName1` | **Donneur d'ordre** — le décideur commercial à contacter, pas forcément sur place | Identité du "client potentiel" affiché, croisé avec `XXAV_CMCCustomer` (`KundenNr` = `AufgeberNr`) pour récupérer Tel/eMail/Sachbearb |

Les deux coïncident souvent (le même acteur expédie et commande), mais pas toujours (ex. observé : expéditeur = Deufol Waremme SA en Belgique, donneur d'ordre = Mölnlycke Health Care AB en Suède — c'est Mölnlycke qu'on démarche, pas l'entrepôt Deufol).

### 4.1 Point de référence
Pour un camion en rouge/orange, le point de référence utilisé pour la recherche de rechargement est **la dernière livraison prévue ou en cours du camion** (champs `EntladestelleLKZ/PLZ/Ort`, pas de sélection manuelle en v1).

### 4.2 Filtre grossier (avant géocodage)
1. Pays identique au point de référence, sur `AbsenderLKZ` (hors Luxembourg)
2. Code postal `AbsenderPLZ` — présélection large

⚠️ Les codes postaux ne sont pas tous numériques purs (ex. NL : `"7463 PH"`, espace + lettres). Le filtre "2 premiers caractères" ne peut pas être un simple substring uniforme — il faut une normalisation par pays (LU/FR/DE/BE : 2 premiers chiffres numériques ; NL/PL et autres formats alphanumériques : règle dédiée à définir pays par pays).

### 4.3 Fenêtre temporelle adaptative
Recherche progressive dans l'historique Winsped (sur `BelVonDat`, date de chargement), élargie uniquement si nécessaire :

1. **2-3 mois** en premier
2. Si résultats insuffisants (seuil à définir, ex. < 3 clients potentiels) → **élargir à 6 mois**
3. Si toujours insuffisant → **élargir à 12 mois**

L'UI affiche un badge indiquant la fenêtre sur laquelle le résultat a été trouvé (ex. "trouvé sur 3 mois" = zone active/fiable vs "trouvé sur 12 mois" = zone rare, résultat à prendre avec prudence). Pas de classification a priori des zones — l'élargissement progressif s'adapte tout seul à la densité réelle de trafic de chaque zone.

### 4.4 Géocodage
- **Point de livraison du camion** : géocodage à la volée de `EntladestelleLKZ/PLZ/Ort` (volume faible, un point par recherche)
- **Historique Winsped** : géocodage en **batch avec cache persistant** des adresses `AbsenderLKZ/PLZ/Ort` (ne pas regéocoder à chaque ouverture d'appli — coût et lenteur inutiles). Cache à stocker en SharePoint (liste ou fichier JSON), rafraîchi de façon incrémentale (uniquement les nouvelles lignes Winsped).
- Réutilisation du pattern déjà en place dans Run & Bike Trainer (Nominatim / ORS) pour la méthode de géocodage.

### 4.5 Calcul de distance
- Distance à vol d'oiseau (haversine) entre point de livraison du camion et adresses **Absender** géocodées — suffisant pour un rayon de 50km, pas besoin de routing routier en v1.
- Seuil de rétention : **≤ 50 km**

### 4.6 Résultat
- Liste des **clients potentiels** = donneurs d'ordre (`AufgeberNr`/`AuftraggeberName1`, croisés avec `XXAV_CMCCustomer` pour contact), triés par distance de leur point de chargement (`Absender`), avec badge de fraîcheur de la fenêtre temporelle
- Clic sur un client → affichage des **10 derniers transports Winsped** de ce donneur d'ordre dans la zone géographique concernée, avec le détail complet du trajet :
  - Date de chargement (`BelVonDat`)
  - Adresse de chargement réelle (`AbsenderLKZ/PLZ/Ort`)
  - Adresse de livraison réelle (`EntladestelleLKZ/PLZ/Ort`)
  - Véhicule utilisé (`KfzZugID`)
  - **Destinataire affiché en simple libellé** (`EmpfangerName1` + `EmpfangerLKZ`/ville) — pas de croisement avec `XXAV_CMCCustomer` pour ses coordonnées complètes ; seul le donneur d'ordre (le client démarché) a droit à la fiche contact enrichie

### 4.7 Deux périmètres de données distincts (important pour le dimensionnement de l'import)

L'appli combine deux types de résultats qui ne s'appuient **pas sur les mêmes données** :

| Type de résultat | Ce que c'est | Données nécessaires |
|---|---|---|
| **Clients probables** (§4.1 à 4.6, déjà spécifié) | Prédiction basée sur les habitudes passées d'un client dans la zone | Historique **Lorang Fleet uniquement**, fenêtre 3-12 mois en arrière (`BelVonDat` < aujourd'hui) |
| **Rechargements déjà réservés, pas encore affectés** | Commandes réellement saisies dans Winsped, toutes flottes confondues, mais qui n'ont pas encore de camion assigné | Commandes **toutes flottes** (pas de filtre `KfzZugID`/`FFNr` sur les 36 `KreNr`), mais uniquement à partir d'**aujourd'hui** (`BelVonDat >= TODAY()`) et où `KfzZugID` est **vide/non renseigné** |

Point important : le deuxième cas **ne nécessite aucune profondeur d'historique** — uniquement du présent/futur. Donc pas d'import massif de tout Winsped à prévoir ; une requête DAX supplémentaire ciblée sur les commandes non affectées à partir d'aujourd'hui suffit, en plus de la requête historique déjà prévue pour les clients probables.

⚠️ Ce deuxième volet n'est pas encore implémenté dans l'appli (V1.2) — actuellement seuls les "clients probables" sont affichés, avec un encart explicite dans l'UI signalant l'absence de ce second périmètre.

---

## 5. Flux complet (résumé)

```
Camion Lorang Fleet sans chargement (🔴 J / 🟠 J+1...)
   → dernière livraison prévue/en cours = point de référence
   → géocodage du point de livraison (à la volée)
   → DEUX RECHERCHES EN PARALLÈLE :
      A) Clients probables : historique Lorang Fleet (3-12 mois), filtre pays+CP, distance ≤50km
      B) Rechargements déjà réservés non affectés : commandes toutes flottes, BelVonDat >= aujourd'hui, KfzZugID vide, distance ≤50km
   → affichage combiné, avec distinction claire entre les deux (l'un est une prédiction, l'autre une donnée réelle)
   → clic client → 10 derniers transports Winsped dans la zone
```

---

## 6. Architecture applicative envisagée

Cohérent avec le stack habituel des apps 3PL :

- **Frontend** : single-file HTML/JS vanilla, pas de framework (cohérent avec Lorang Fleet, Lorang Order, Lorang Analyse)
- **Auth** : MSAL via app registration Topo3PL existante (clientId `56ae2586-8bb0-48a9-afd5-cb7a6bf12cc3`, tenant `luxportlu.onmicrosoft.com`)
- **Data source** : SharePoint site `PROJECTSALESDEV` — dataflow vers `XXAV_OrderOverview`, `XXAV_Vehicle`, `XXAV_CMCCustomer`
- **Cache géocodage** : liste SharePoint dédiée ou fichier JSON dans le même site, avec un job de rafraîchissement incrémental (uniquement les nouvelles lignes Winsped depuis le dernier passage)
- **Déploiement** : Azure Static Web Apps, `swa deploy --env production` (même méthode que Fleet/Order/Analyse)
- **Réutilisation** : reprendre directement la logique de statut/rechargement de `FLOWFLEET_V48.html` plutôt que la redévelopper

---

## 7. Points à valider / risques

- **Seuil de "résultats insuffisants"** déclenchant l'élargissement de fenêtre temporelle (proposition : < 3 clients potentiels — à confirmer)
- **Fréquence de rafraîchissement du cache géocodage** — à caler sur la fréquence d'alimentation de `XXAV_OrderOverview`
- **Volumétrie Winsped** sur 12 mois — à vérifier avant de dimensionner le filtre grossier (pays + CP) pour éviter un géocodage trop lourd en fenêtre max
- **Qualité des adresses** dans `XXAV_OrderOverview` et `XXAV_CMCCustomer` — un géocodage fiable suppose des champs pays/CP/ville propres ; à vérifier sur un échantillon avant de se lancer dans le batch
- **Cas des clients ayant déménagé/changé de coordonnées entre-temps** — l'historique Winsped reflète l'adresse au moment du transport, pas forcément l'adresse actuelle du client dans `XXAV_CMCCustomer` ; à trancher lequel des deux jeux de coordonnées fait foi pour le matching

---

## 8. Prochaines étapes proposées

1. Explorer la structure réelle des 3 tables (`XXAV_OrderOverview`, `XXAV_Vehicle`, `XXAV_CMCCustomer`) pour confirmer les champs disponibles et leur qualité
2. Valider le seuil d'élargissement de fenêtre temporelle et la source de coordonnées à privilégier (Winsped historique vs fiche client actuelle)
3. Prototyper l'algo de matching sur un extrait de données réel
4. Construire le squelette applicatif en réutilisant la structure Lorang Fleet

---

## 9. Phase 2 — Extension Timocom

**Statut** : hors périmètre v1, à traiter après la mise en production du matching interne Winsped.

### 9.1 Principe
Timocom expose une API REST (Freight Exchange, v3 JSON) avec deux modules pertinents pour Reload :

| Module | Usage envisagé |
|---|---|
| **Search API** | Interroger en direct la bourse de fret Timocom sur la zone + dates du camion 🔴/🟠, en complément de l'historique Winsped interne — remonte des offres réelles et actuelles, pas seulement des clients historiques |
| **Offer API** (vehicle space offers) | Publier automatiquement la disponibilité d'un camion resté vide trop longtemps sur la bourse Timocom, pour élargir la recherche au-delà des clients connus |

### 9.2 Intégration dans le flux
```
Camion 🔴/🟠
   → matching interne (historique Winsped — v1, déjà spécifié en §4)
   → EN PARALLÈLE (phase 2) : appel Search API Timocom sur zone + dates du camion
   → affichage combiné : "clients historiques probables" + "offres marché Timocom en direct"
   → option : publication auto d'une vehicle space offer si camion vide au-delà d'un seuil (à définir)
```

### 9.3 Prérequis
- **Compte Timocom** : déjà en place côté Lorang ✅
- **Accès API activé** sur ce compte — à confirmer/demander auprès du contact commercial Timocom (l'accès API n'est pas automatiquement inclus dans un compte utilisateur standard)
- **Identifiants API** (Basic Auth ou OAuth2) fournis par Timocom une fois l'accès activé
- **Process d'approbation applicative** Timocom (guidelines de design, favicon obligatoire, etc.) — délai d'intégration annoncé de 1 à 4 jours selon le TMS
- Doc de référence : https://developer.timocom.com

### 9.4 Points à valider avant de lancer cette phase
- Confirmer si le compte Timocom Lorang inclut déjà l'accès API ou s'il faut l'ouvrir (coût éventuel à vérifier)
- Définir le seuil de vide au-delà duquel on publie automatiquement une vehicle space offer (éviter de spammer le marché pour un camion vide 2h)
- Décider si les offres Timocom en direct viennent en complément visuel de l'historique interne, ou si elles priment dessus en cas de conflit d'affichage
