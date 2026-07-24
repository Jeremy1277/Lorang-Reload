# Flux DataFlow — LORANG RELOAD

L'app charge automatiquement 3 fichiers JSON à l'ouverture, via Microsoft Graph
(app registration Topo3PL, comme Lorang Fleet / Order / Analyse).

## Fichiers attendus

À la **racine de la bibliothèque Documents** du site SharePoint `PROJECTSALESDEV` :

| Fichier | Table source | Rafraîchissement conseillé |
|---|---|---|
| `reload_vehicle.json` | XXAV_Vehicle | 1×/jour suffit |
| `reload_customer.json` | XXAV_CMCCustomer | 1×/jour suffit |
| `reload_orders.json` | XXAV_OrderOverview | plusieurs fois/jour (même cadence que floworder_data.json) |

Format accepté : tableau JSON de lignes directement, ou objet `{"rows":[...]}` /
`{"results":[...]}` / `{"value":[...]}`. Les clés peuvent être au format DAX
(`[LKW]` ou `XXAV_Vehicle[LKW]`) — l'app les normalise. Les dates peuvent être
ISO (`2026-07-22T00:00:00`) ou `JJ/MM/AAAA`.

## Requêtes DAX (Power Automate → "Run a query against a dataset")

### reload_vehicle.json
```dax
EVALUATE
SELECTCOLUMNS(
    XXAV_Vehicle,
    "LKW",   XXAV_Vehicle[LKW],
    "KreNr", XXAV_Vehicle[KreNr],
    "Bez",   XXAV_Vehicle[Bez]
)
```

### reload_customer.json
```dax
EVALUATE
SELECTCOLUMNS(
    XXAV_CMCCustomer,
    "KundenNr",  XXAV_CMCCustomer[KundenNr],
    "Name1",     XXAV_CMCCustomer[Name1],
    "LKZ",       XXAV_CMCCustomer[LKZ],
    "PLZ",       XXAV_CMCCustomer[PLZ],
    "Ort",       XXAV_CMCCustomer[Ort],
    "Tel",       XXAV_CMCCustomer[Tel],
    "eMail",     XXAV_CMCCustomer[eMail],
    "Sachbearb", XXAV_CMCCustomer[Sachbearb]
)
```

### reload_orders.json
Historique 12 mois (fenêtre max de l'algo), uniquement les lignes avec véhicule affecté :
```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(
        XXAV_OrderOverview,
        NOT ( ISBLANK ( XXAV_OrderOverview[KfzZugID] ) )
            && XXAV_OrderOverview[BelVonDat] >= TODAY() - 370
    ),
    "AufNr",             XXAV_OrderOverview[AufNr],
    "KfzZugID",          XXAV_OrderOverview[KfzZugID],
    "FFNr",              XXAV_OrderOverview[FFNr],
    "EntladestelleLKZ",  XXAV_OrderOverview[EntladestelleLKZ],
    "EntladestellePLZ",  XXAV_OrderOverview[EntladestellePLZ],
    "EntladestelleOrt",  XXAV_OrderOverview[EntladestelleOrt],
    "EntVonDat",         XXAV_OrderOverview[EntVonDat],
    "EntBisDat",         XXAV_OrderOverview[EntBisDat],
    "BelVonDat",         XXAV_OrderOverview[BelVonDat],
    "AbsenderLKZ",       XXAV_OrderOverview[AbsenderLKZ],
    "AbsenderPLZ",       XXAV_OrderOverview[AbsenderPLZ],
    "AbsenderOrt",       XXAV_OrderOverview[AbsenderOrt],
    "AufgeberNr",        XXAV_OrderOverview[AufgeberNr],
    "AuftraggeberName1", XXAV_OrderOverview[AuftraggeberName1],
    "EmpfangerName1",    XXAV_OrderOverview[EmpfangerName1],
    "EmpfangerLKZ",      XXAV_OrderOverview[EmpfangerLKZ]
)
```

> Note : le volet "rechargements réservés non affectés" (spec §4.7) demandera plus tard
> une 4e requête (toutes flottes, `BelVonDat >= TODAY()`, `KfzZugID` vide) — pas encore branchée dans l'app.

## Comportement de l'app

- **1re visite** : message invitant à cliquer sur ⚡ DataFlow → popup de connexion Microsoft (une seule fois).
- **Visites suivantes** : connexion silencieuse (cache localStorage) + chargement auto des 3 flux, zéro clic.
- **Secours** : l'upload manuel des 3 exports Excel reste disponible (bouton « Fichiers »).
- En cas de flux manquant/en erreur : statut affiché, détail en console, l'app reste utilisable en mode manuel.


## ⚠️ Limite 15 Mo — architecture v2 des exports orders (2026-07-24)

L'API Power BI (ExecuteQueries) plafonne chaque réponse à **15 Mo** et l'action Power
Automate **tronque silencieusement** au-delà (le run reste vert). Avec 370 jours × toutes
colonnes, `reload_orders.json` atteignait exactement 15,00 Mo → dossiers récents manquants.

Nouvelle architecture (4 requêtes orders au lieu d'1) :

| Fichier | Rôle | Fenêtre | Colonnes |
|---|---|---|---|
| `reload_orders.json` | Statuts & tours des camions | `TODAY()-30` → futur | complètes (17) |
| `reload_history1.json` | Matching clients probables | `TODAY()-370` → `TODAY()-180` | réduites (12) |
| `reload_history2.json` | Matching clients probables | `TODAY()-180` → aujourd'hui | réduites (12) |

L'app fusionne history1+history2 pour le matching ; si absents, elle retombe sur
`reload_orders.json` (mode dégradé 30 jours).

### reload_orders.json — filtre mis à jour (30 jours)
Remplacer dans la requête existante : `>= TODAY() - 370` → `>= TODAY() - 30`

### reload_history1.json
```dax
EVALUATE
SELECTCOLUMNS(
    FILTER(
        XXAV__OrderOverview,
        NOT ( ISBLANK ( XXAV__OrderOverview[KfzZugID] ) )
            && XXAV__OrderOverview[BelVonDat] >= TODAY() - 370
            && XXAV__OrderOverview[BelVonDat] <  TODAY() - 180
    ),
    "KfzZugID",          XXAV__OrderOverview[KfzZugID],
    "BelVonDat",         XXAV__OrderOverview[BelVonDat],
    "AbsenderLKZ",       XXAV__OrderOverview[AbsenderLKZ],
    "AbsenderPLZ",       XXAV__OrderOverview[AbsenderPLZ],
    "AbsenderOrt",       XXAV__OrderOverview[AbsenderOrt],
    "AufgeberNr",        XXAV__OrderOverview[AufgeberNr],
    "AuftraggeberName1", XXAV__OrderOverview[AuftraggeberName1],
    "EntladestelleLKZ",  XXAV__OrderOverview[EntladestelleLKZ],
    "EntladestellePLZ",  XXAV__OrderOverview[EntladestellePLZ],
    "EntladestelleOrt",  XXAV__OrderOverview[EntladestelleOrt],
    "EmpfangerName1",    XXAV__OrderOverview[EmpfangerName1],
    "EmpfangerLKZ",      XXAV__OrderOverview[EmpfangerLKZ]
)
```

### reload_history2.json
Même requête que history1 avec le filtre :
```dax
        NOT ( ISBLANK ( XXAV__OrderOverview[KfzZugID] ) )
            && XXAV__OrderOverview[BelVonDat] >= TODAY() - 180
```

Contrôle de santé : si un des fichiers `reload_*.json` approche 14 Mo, resserrer les
fenêtres ou re-découper — ne jamais laisser un export atteindre 15,00 Mo pile (= troncature).
