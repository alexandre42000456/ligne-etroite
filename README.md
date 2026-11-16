# Ligne Étroite — simulateur de bus urbain

Jeu mobile 2D (vue de dessus) de conduite de bus dans les rues étroites d'une ville européenne.
Application web sans dépendance ni étape de compilation : HTML, CSS et JavaScript (modules ES) servis tels quels,
optimisée pour l'iPhone 17 Pro en paysage et installable sur l'écran d'accueil (PWA, jouable hors ligne).

## Contenu

- **3 bus aux dimensions réelles** et à la cinématique réaliste (modèle bicyclette + remorque) :
  - 12 m : empattement 5,90 m, porte-à-faux 2,75 / 3,35 m, braquage Ø 21,5 m entre murs ;
  - 15 m : 3 essieux, essieu suiveur non directeur, porte-à-faux arrière 4,6 m, braquage Ø 24,3 m ;
  - 18 m articulé : articulation limitée à 52°, la remorque coupe les virages.
- **Conduite réaliste** : moteur à puissance limitée, boîte automatique 6 rapports (bruit de moteur qui suit le régime),
  rampement du convertisseur, freinage dosable jusqu'à l'arrêt d'urgence, rétroviseurs qui accrochent les murs et poteaux,
  roues qui montent sur le trottoir, porte-à-faux qui balaie les potelets.
- **Volant tactile multi-tours** (±450° par défaut, réglable de ±270° à ±720°) : on tourne le pouce autour du centre,
  la rotation est cumulée comme sur un vrai volant ; retour automatique proportionnel à la vitesse.
- **Pédales analogiques** : la position du doigt sur la pédale dose l'effort.
- **5 lignes** (Navette, 1, 2, 3, 4) de difficulté croissante, de 0,7 à 1 km, avec horaires, demandes d'arrêt,
  montée et descente des voyageurs, accostage noté (écart au trottoir, alignement de la porte avant sur le poteau).
- **Ville de 780 × 560 m** : boulevard, avenues, giratoire à cinq branches avec anneau franchissable,
  rues résidentielles avec stationnement, vieille ville pavée (chaussées de 4,2 à 5,6 m) et la Porte Saint-Jean (3,80 m).
- **Circulation** : voitures qui respectent feux et priorités, s'arrêtent devant le bus et laissent place dans les ruelles.
- **Score** : sécurité, service, ponctualité, confort des voyageurs debout ; record par ligne et par bus.

## Jouer en local

```bash
python3 tools/serve.py
```

Puis ouvrir http://localhost:8765. Au clavier (pour tester sur ordinateur) : flèches (ou W/A/S/D), espace = frein,
`F`/`N`/`R` = rapport, `O` = portes, `Q`/`E` = clignotants, `H` = klaxon, `P` = pause.

## Publier sur GitHub Pages

1. Créer un dépôt sur GitHub (par exemple `ligne-etroite`).
2. Depuis ce dossier :
   ```bash
   git init && git add . && git commit -m "Ligne Étroite"
   git branch -M main
   git remote add origin https://github.com/<votre-compte>/ligne-etroite.git
   git push -u origin main
   ```
3. Sur GitHub : **Settings → Pages → Build and deployment → Deploy from a branch**, branche `main`, dossier `/ (root)`.
4. Le jeu est en ligne quelques minutes plus tard sur `https://<votre-compte>.github.io/ligne-etroite/`.

Le fichier `.nojekyll` évite tout traitement Jekyll. Tous les chemins sont relatifs : le jeu fonctionne dans un sous-dossier.

## Installer sur l'iPhone

Ouvrir l'adresse dans **Safari**, puis **Partager → Sur l'écran d'accueil**. Lancé depuis l'icône, le jeu s'ouvre
en plein écran, sans barre d'adresse, et reste jouable hors ligne. Tenir le téléphone en paysage.
Le son passe même avec le commutateur silencieux (réglable dans les réglages du jeu).

## Vérifier la faisabilité après une modification de la carte

La difficulté repose sur des rues étroites : chaque ligne doit rester faisable. Un planificateur A* rejoue la vraie
cinématique de chaque bus (porte-à-faux, rétroviseurs, remorque) pour prouver qu'un passage existe, sans et avec
15 cm de marge de chaque côté :

```bash
node tools/plan.mjs --write   # met aussi à jour js/feasibility.js (bus interdits par ligne)
node tools/e2e.mjs 4          # service complet d'une ligne : accostages, voyageurs, score
node tools/sim.mjs            # pilote automatique naïf (montre où un débutant accroche)
```

Résultat actuel : toutes les lignes sont faisables avec le bus conseillé ; le 15 m est interdit sur la ligne 4
(il ne passe pas la vieille ville, l'articulé si).

## Structure

| Fichier | Rôle |
|---|---|
| `js/city.js` | Données de la ville : nœuds, rues (largeur, trottoirs, sens unique, stationnement), arrêts, lignes |
| `js/world.js` | Géométrie analytique (congés de bordure, giratoire), matériaux, obstacles, voies, itinéraires |
| `js/bus.js` | Gabarits des bus, physique, collisions |
| `js/mapRenderer.js` | Rendu de la ville en tuiles mises en cache (toits, ombres portées, marquages) |
| `js/render.js` | Caméra, bus, trafic, piétons, guidage, aide trajectoire |
| `js/controls.js` | Volant, pédales, boutons, clavier |
| `js/mission.js` | Arrêts, voyageurs, horaire, pénalités, score |
| `js/traffic.js` | Voitures, feux, priorités |
| `js/audio.js` | Sons synthétisés (Web Audio) |
| `js/ui.js`, `js/main.js` | Menus, HUD, boucle de jeu (physique à 120 Hz) |
| `tools/` | Planificateur, tests, génération des icônes, serveur local |
