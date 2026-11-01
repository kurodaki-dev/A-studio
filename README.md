# A Studio

Station de création musicale pour Android, construite sur le modèle de FL Studio : channel rack, piano roll, playlist, mixer et navigateur de sons. Les sons sont produits par synthèse en temps réel, sans échantillons.

## Télécharger l'APK

Lien direct vers la dernière version : https://github.com/kurodaki-dev/A-studio/releases/latest/download/A-Studio.apk

Sur le téléphone, autorisez l'installation depuis cette source quand Android le demande. L'application s'affiche en paysage.

### Mises à jour

Chaque modification poussée sur `main` publie automatiquement une nouvelle version (`v1.0.<numéro>`) dans les Releases. Au démarrage, l'application vérifie s'il en existe une plus récente et propose de la télécharger. La nouvelle version s'installe par dessus l'ancienne et garde les projets. Menu : « Rechercher une mise à jour » pour vérifier à la main, « Vérifier au démarrage » pour couper la vérification automatique.

## Fonctions

**Channel rack**
- 16 pas par mesure, groupes de 4 en deux couleurs comme dans FL Studio, glisser le doigt pour remplir ou vider plusieurs pas.
- Par canal : témoin d'activation, panoramique, volume, insert du mixer, menu (piano roll, paramètres, renommer, cloner, déplacer, supprimer).
- Un canal qui contient des notes de piano roll affiche un aperçu à la place des pas.

**Piano roll**
- Outils : dessiner, pinceau, supprimer, sélection, couper, déplacer la vue.
- Dessiner : toucher une case vide pose une note avec la dernière longueur utilisée. Toucher une note reprend sa longueur et sa vélocité pour les notes suivantes. Glisser une note la déplace, glisser son bord droit la redimensionne.
- Appui long sur une note pour la supprimer (équivalent du clic droit, qui fonctionne aussi à la souris).
- Magnétisme de 1/6 de pas à la mesure, ou aucun.
- Notes des autres canaux affichées en fantôme, couloir de vélocité, clavier jouable à gauche, notes nommées comme dans FL Studio (le do central est C5).
- Copier, coller, dupliquer, supprimer la sélection, transposer d'un demi ton ou d'une octave, quantifier.
- Deux doigts : glisser pour faire défiler, pincer pour zoomer (horizontalement ou verticalement selon l'orientation des doigts).

**Playlist**
- Mode PAT (lecture du motif courant) ou SONG (lecture de la playlist).
- 16 pistes, clips de motifs avec aperçu des notes, clips audio avec forme d'onde, magnétisme mesure, temps ou pas, coupure du son par piste.
- Étirer un clip : glisser son bord droit. Un clip de motif étiré répète le motif, un clip audio est coupé ou prolongé.

**Navigateur**
- Panneau à gauche, comme dans FL Studio, à ouvrir ou fermer avec le bouton Navigateur (F8). Recherche par nom.
- Dossiers : Projets, Mes samples, Sons intégrés.
- Import de fichiers audio (WAV, MP3, OGG, FLAC, M4A, AIFF) et de packs ZIP, dont l'arborescence est conservée. Les samples restent sur l'appareil.
- Toucher un élément pour l'écouter. Glisser vers la droite (ou appui long) pour le déposer :
  - sur une piste de la playlist : clip audio ;
  - dans le piano roll : canal Sampler et note à l'endroit du dépôt ;
  - dans le channel rack : canal Sampler.
- Les sons intégrés se déposent de la même façon et créent un canal.

**Mixer**
- Master et 16 inserts : fader, panoramique, réverbération, écho, coupure, solo, vumètre.

**Sons intégrés et sampler**
- Batterie : kick, caisse claire, clap, charleston fermé et ouvert, crash, tom, rimshot, cloche à vache.
- Claviers : piano, piano électrique, orgue.
- Basses : basse synthé, basse 808.
- Synthés : lead, nappe, pluck.
- Cordes : ensemble de cordes, guitare.
- Vents : flûte, cuivres.
- Percussions mélodiques : marimba, cloche.
- Canal Sampler : joue un sample importé, à sa hauteur d'origine sur C5, transposé sur les autres notes.
- Par canal : transposition, attaque, relâchement, filtre et résonance.

**Projets**
- Sauvegarde automatique du projet en cours, projets enregistrés sur l'appareil.
- Export et import de fichiers `.astudio`, export WAV 16 bits 44,1 kHz du motif ou du morceau. Un fichier `.astudio` ne contient pas les samples : sur un autre appareil, importez aussi le pack.
- Annuler et rétablir.

Raccourcis clavier (tablette avec clavier ou navigateur) : espace pour lecture et pause, F5 playlist, F6 channel rack, F7 piano roll, F8 ouvre ou ferme le navigateur, F9 mixer, L pour basculer PAT et SONG, Ctrl+Z et Ctrl+Y. Dans le piano roll : P dessiner, B pinceau, D supprimer, E sélection, C couper, Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+B dupliquer, Ctrl+Q quantifier, flèches pour transposer.

## Données personnelles

L'application ne collecte rien. Pas de compte, pas de publicité, pas de mesure d'audience. Sa seule connexion interroge GitHub pour savoir si une nouvelle version existe, sans rien envoyer sur l'utilisateur, et peut être désactivée. Les projets restent dans le stockage local de l'appareil. Détails dans [la politique de confidentialité](public/legal/confidentialite.html), [les conditions d'utilisation](public/legal/conditions.html) et [la politique des cookies](public/legal/cookies.html). Aucun bandeau cookies n'est nécessaire, car l'application ne dépose aucun cookie et n'utilise que le stockage strictement nécessaire.

## Développement

Prérequis : Node.js 22, JDK 21, Android SDK (plateforme 36).

```bash
npm install
npm run dev          # version web sur http://localhost:5173
npm test             # tests unitaires
npm run build        # construit dist/
npx cap sync android # copie dist/ dans le projet Android
cd android && ./gradlew assembleDebug
```

L'APK se trouve ensuite dans `android/app/build/outputs/apk/debug/`.

### Publication

- Chaque push sur `main` construit l'APK signé et publie une release `v1.0.<numéro du run>` (workflow `.github/workflows/android.yml`). Les notes de version sont générées à partir des commits.
- Les pull requests construisent un APK de test, sans release.
- Le workflow `.github/workflows/pages.yml` publie la version web et les pages légales sur GitHub Pages. À activer une fois dans Settings, Pages, Source : GitHub Actions.

**Clé de signature.** Android n'installe une mise à jour que si elle est signée avec la même clé que la version installée. La clé n'est jamais dans le dépôt : le workflow la lit dans deux secrets (Settings, Secrets and variables, Actions) :

| Secret | Contenu |
|---|---|
| `ANDROID_KEYSTORE` | Le fichier `.jks` encodé en base64 (`base64 -w0 astudio.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | Le mot de passe du fichier et de la clé (alias `astudio`) |

Sans ces secrets, le workflow s'arrête sur `main` au lieu de publier un APK impossible à mettre à jour. Gardez une copie de la clé en lieu sûr : si elle est perdue, les utilisateurs devront désinstaller l'application pour passer à une nouvelle clé.

Build signé en local :

```bash
APP_BUILD=1 APP_VERSION=1.0.1 ANDROID_KEYSTORE_FILE=/chemin/astudio.jks ANDROID_KEYSTORE_PASSWORD=... \
  ./gradlew assembleRelease
```

## Structure

```
src/
  audio/      catalogue, instruments synthétisés, moteur (séquenceur, mixer, export)
  ui/         channel rack, piano roll, playlist, mixer, navigateur, contrôles
  store.js    modèle de projet, annuler et rétablir
public/legal/ confidentialité, conditions, cookies
android/      projet Capacitor
```

## Licence

MIT. Icônes : [Lucide](https://lucide.dev), le jeu d'icônes utilisé par shadcn/ui (licence ISC).

A Studio est un projet indépendant, sans lien avec Image Line Software. FL Studio est une marque de Image Line Software.
