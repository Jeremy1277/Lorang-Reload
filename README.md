# Lorang Reload

Anticipation et accélération des rechargements retour pour la flotte Lorang (propre + tractionnaires), en croisant l'historique des transports Winsped avec la localisation des livraisons du jour.

## Objectif

Pour chaque camion Lorang Fleet sans chargement prévu, identifier automatiquement les clients ayant historiquement du fret à proximité (≤ 50 km) du point de livraison, afin de limiter les retours à vide vers le Luxembourg.

## Fichiers

- **`LORANG_RELOAD_Spec_Technique.md`** — spec fonctionnelle et technique complète : sources de données, mapping des colonnes réelles (`XXAV_OrderOverview`, `XXAV_Vehicle`, `XXAV_CMCCustomer`), algorithme de matching (fenêtre temporelle adaptative, filtre géographique, calcul de distance), extension Timocom en phase 2.
- **`LORANG_RELOAD_V1.1.html`** — application V1, mode fichier local (upload direct des exports Excel). La connexion SharePoint/Power Automate en direct est en cours de montage.

## Statut

🚧 V1 fonctionnelle en local — migration vers un flux Power Automate/DAX (Power BI → JSON → SharePoint) en cours pour supprimer l'étape d'export manuel, sur le même modèle que Lorang Fleet et Lorang Order.

## Écosystème

Lorang Reload s'inscrit dans la suite d'outils 3PL Lorang, aux côtés de :
- **Lorang Fleet** — suivi de la flotte propre et des tractionnaires
- **Lorang Order** — ensemble des commandes Winsped, affectation des moyens en départ

Objectif cible : un fonctionnement intégré et automatisé entre les trois applications.
