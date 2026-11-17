# VIGIE · Cartographie géospatiale de l'insécurité – PNH

Application web de la **Direction Centrale de la Police Judiciaire (DCPJ)** de la Police Nationale d'Haïti.

**Adresse du site :** https://payasec.github.io/DCPJ-cartographe-/

## Fonctions

- **Alertes géolocalisées** : viol, drogue, enlèvement, armes à feu, activité de gang. Chaque alerte a une gravité et un statut de traitement.
- **Foyers de gangs armés** et **zones d'insécurité**. Les zones sont dessinées directement sur la carte et classées rouge, orange ou jaune.
- **Détection automatique des foyers de violence** et **indice d'insécurité par département**.
- **Opérations** : fond en relief et topographique, mesures de chaque zone (superficie, périmètre, longueur × largeur, altitude, dénivelé), points de départ (commissariats et bases), **fiche opération** imprimable avec distances et temps estimés, et **vue 3D** du terrain.
- **Mode Commandement** : radar, heure Zulu, coordonnées MGRS, niveau de menace, présentation automatique et SITREP.
- **Exports** : Excel (CSV), sauvegarde complète et SIG (GeoJSON pour QGIS ou ArcGIS).

## Données

Ce dépôt ne contient **aucune donnée opérationnelle** : ni foyers, ni noms, ni numéros. Les données saisies restent **dans le navigateur de chaque utilisateur**. Pour les transférer, utilisez *Synthèse → Sauvegarde complète* puis *Importer*.
Ne publiez jamais de fichiers de sauvegarde ou de foyers dans ce dépôt public.

## Structure

| Dossier | Contenu |
|---|---|
| `index.html` | La page |
| `js/config.js` | Les réglages : nom de l'unité, catégories, couleurs, seuils |
| `js/app.js` | Le moteur : carte, alertes, zones, analyse |
| `js/commandement.js` | Le Mode Commandement et le radar |
| `js/operations.js` | Les mesures, le relief, les points de départ, la fiche opération et la vue 3D. Les hypothèses de calcul sont dans `OPS_DEFAUTS` |
| `css/style.css` | L'apparence |
| `data/` | Les départements et localités d'Haïti |
| `lib/` | Les bibliothèques cartographiques (Leaflet, MarkerCluster, Leaflet.heat) |

## Crédits

Leaflet (BSD-2), Leaflet.markercluster (MIT), Leaflet.heat (BSD-2), MapLibre GL JS (BSD-3). Relief : Mapzen Terrain Tiles (AWS Open Data). Fonds de carte © Esri, HERE, Garmin, OpenStreetMap, Maxar. Limites départementales : Natural Earth. Localités : GeoNames (CC BY 4.0).
