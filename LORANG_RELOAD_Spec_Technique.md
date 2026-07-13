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

### 4.1 Point de référence
Pour un camion en rouge/orange, le point de référence utilisé pour la recherche de rechargement est **la dernière livraison prévue ou en cours du camion** (pas de sélection manuelle en v1).

### 4.2 Filtre grossier (avant géocodage)
1. Pays identique au point de référence (hors Luxembourg)
2. Code postal — 2 premiers chiffres (présélection large, évite de géocoder tout Winsped à chaque requête)

### 4.3 Fenêtre temporelle adaptative
Recherche progressive dans l'historique Winsped, élargie uniquement si nécessaire :

1. **2-3 mois** en premier
2. Si résultats insuffisants (seuil à définir, ex. < 3 clients potentiels) → **élargir à 6 mois**
3. Si toujours insuffisant → **élargir à 12 mois**

L'UI affiche un badge indiquant la fenêtre sur laquelle le résultat a été trouvé (ex. "trouvé sur 3 mois" = zone active/fiable vs "trouvé sur 12 mois" = zone rare, résultat à prendre avec prudence). Pas de classification a priori des zones — l'élargissement progressif s'adapte tout seul à la densité réelle de trafic de chaque zone.

### 4.4 Géocodage
- **Point de livraison du camion** : géocodage à la volée (volume faible, un point par recherche)
- **Historique Winsped** : géocodage en **batch avec cache persistant** (ne pas regéocoder à chaque ouverture d'appli — coût et lenteur inutiles). Cache à stocker en SharePoint (liste ou fichier JSON), rafraîchi de façon incrémentale (uniquement les nouvelles lignes Winsped).
- Réutilisation du pattern déjà en place dans Run & Bike Trainer (Nominatim / ORS) pour la méthode de géocodage.

### 4.5 Calcul de distance
- Distance à vol d'oiseau (haversine) entre point de livraison et candidats géocodés — suffisant pour un rayon de 50km, pas besoin de routing routier en v1.
- Seuil de rétention : **≤ 50 km**

### 4.6 Résultat
- Liste des clients potentiels (issus de `XXAV_CMCCustomer`, croisés sur l'historique Winsped filtré), triés par distance croissante, avec badge de fraîcheur de la fenêtre temporelle
- Clic sur un client → affichage des **10 derniers transports Winsped** dans la zone géographique concernée (date, véhicule, adresse de chargement)

---

## 5. Flux complet (résumé)

```
Camion Lorang Fleet sans chargement (🔴 J / 🟠 J+1...)
   → dernière livraison prévue/en cours = point de référence
   → géocodage du point de livraison (à la volée)
   → recherche Winsped, véhicules Lorang Fleet uniquement (SA + GMBH + tractionnaires)
      → filtre pays (hors LU) + 2 premiers chiffres CP
      → fenêtre 2-3 mois → si insuffisant → 6 mois → si insuffisant → 12 mois
   → géocodage des candidats (cache) + distance haversine
   → ≤ 50 km → liste clients potentiels avec badge fraîcheur
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
