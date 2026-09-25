# Atelier

L'application terrain des éducateurs, en complément de SportEasy : SportEasy garde le calendrier, les convocations et la messagerie, Atelier sert à **préparer et animer les séances**.

## Fonctionnalités

### V1 : l'éducateur au bord du terrain
- **Éditeur d'exercices visuel** : terrains prédéfinis (foot à 5, à 8, à 11, demi-terrain, carré d'atelier, zone libre), 13 types d'éléments (joueurs par couleur de chasuble, ballons, coupelles, plots, piquets, cerceaux, haies, échelles, mini-buts, buts, mannequins, zones, éducateur), glisser-déposer, aimantation à la grille, sélection multiple, duplication, annuler/rétablir.
- **Flèches reconnues automatiquement** : un trait droit devient une *passe*, un trait sinueux une *conduite*. On peut aussi choisir *course* (pointillés) ou *tir*.
- **Outils rapides** : « Ligne » (répartit N coupelles, plots ou piquets entre deux points) et « Carré » (4 coupelles d'un geste).
- **Animation**
  - *Étapes* : on déplace les joueurs, et les transitions sont calculées automatiquement.
  - *Enregistrement au doigt* : on appuie sur ●, on déplace les joueurs en temps réel, à plusieurs doigts.
  - *Ballon intelligent* : il suit son porteur. Pour faire une passe, on glisse le ballon sur un joueur.
  - Lecture ×0,5, pas à pas et en boucle, avec les positions fantômes de l'étape précédente.
- **Fiche exercice** : objectif, consignes, variantes plus facile / plus difficile, thèmes, et **matériel calculé automatiquement** (dont le nombre de chasubles par couleur).
- **Séances** : échauffement, **ateliers tournants**, jeu, pause, retour au calme. La durée totale est calculée, et le matériel de la séance aussi (les ateliers simultanés s'additionnent).
- **Séance live**
  - Appel en 10 secondes, puis **groupes équilibrés** (par niveau, par année ou au hasard) qu'on peut ajuster au doigt.
  - Chrono en anneau, **rotation automatique des ateliers** avec sifflet (« Bleus → Atelier 2 »), +1 min, écran maintenu allumé.
  - L'état est conservé si on recharge la page.
- **Mode tableau** : l'exercice s'affiche en plein écran pour le montrer aux enfants, et le terrain pivote automatiquement sur un téléphone tenu verticalement.
- **Pages joueurs** : espace de notes libres (*point fort*, *à travailler*, *objectif*, *remarque*), synthèse en 3 colonnes, journal, présence. On peut aussi prendre une remarque rapide pendant la séance.
- **Hors ligne** : l'app est installable (PWA), les données déjà consultées restent disponibles, et les modifications sont mises en file puis envoyées au retour du réseau.

### V2 : le club
- **Bibliothèque du club** : partage des exercices, validation par un dirigeant, duplication. 7 exercices animés sont fournis au démarrage.
- **Administrateur unique** et rôles *Dirigeant*, *Éducateur*, *Joueur/parent* avec une **matrice de permissions** modifiable.
- **Équipes** : la catégorie (U6 à Seniors, Féminines, Futsal…) sert de nom à l'équipe. Chaque équipe a aussi sa saison, sa couleur et ses éducateurs.
- **Paramètres** : le profil et, selon les droits, l'administration (membres, équipes, permissions, club).
- **Invitations par lien** à envoyer par SportEasy, SMS ou WhatsApp (sans e-mail à configurer).
- **Espace parents** : les parents voient uniquement leurs enfants : les séances publiées, les remarques explicitement partagées, le calendrier et l'album.
- **Lien public de séance**, sans compte, à coller dans SportEasy.
- **Calendrier** : un clic sur un jour pour créer un entraînement, un match, un plateau, un tournoi, une réunion… Chaque événement a des horaires, une heure de convocation, un lieu, un adversaire et domicile/extérieur, une couleur et une visibilité parents. Les répétitions possibles : chaque jour, chaque semaine (jours au choix), toutes les 2 semaines, chaque mois ou un rythme personnalisé, avec une fin à une date ou après N fois. On peut annuler une seule date d'une série.
- **Album souvenir** : photos par équipe, redimensionnées dans le navigateur avant l'envoi, classées par mois, avec une visionneuse plein écran. Elles sont stockées dans `data/uploads/`, pensez à les inclure dans la sauvegarde.
- **Export vidéo** (MP4/WebM) d'un exercice animé, avec partage natif sur mobile.
- Impression de la fiche de séance, mode sombre.

## Navigation
Trois cases flottantes, en icônes seules : **Équipe** | **Séances · Exercices · Joueurs** | **Album souvenir**. Sur téléphone, elles passent en bas de l'écran. La page Séances (l'accueil) affiche une salutation, le prochain événement, la séance en une animée en boucle, le calendrier et toutes les séances. À partir de 6 séances, un tri « Date » les range par mois en accordéon. Le bouton Équipe donne accès aux Paramètres.

## Démarrer en local

Il faut Node.js 22.13 ou plus récent. La base SQLite est intégrée à Node, il n'y a rien d'autre à installer.

```bash
npm install
```

```bash
npm run dev
```

Ouvrez http://localhost:5173. Au premier lancement, vous créez le club et votre compte administrateur. La case « équipe d'exemple » ajoute un groupe U8/U9 de 18 joueurs et une séance prête à lancer.

## Production

```bash
npm run build
```

```bash
PORT=3000 npm start
```

Un seul processus sert l'application et l'API. Les données sont dans `data/atelier.db` (modifiable avec `DATABASE_FILE`).

- **HTTPS obligatoire** en production : les cookies de session sont marqués `Secure`. Pour un test sur le réseau local en HTTP, lancez avec `INSECURE_COOKIES=1`.
- **Hébergement gratuit ou presque** :
  - une VM « Always Free » (Oracle Cloud) ;
  - un Raspberry Pi au club avec Cloudflare Tunnel pour le HTTPS ;
  - un petit VPS.

  Évitez les offres sans disque persistant : la base serait effacée à chaque redémarrage.
- **Sauvegarde** : copiez `data/atelier.db*` serveur arrêté, ou utilisez `sqlite3 data/atelier.db ".backup sauvegarde.db"`.
- **Sur téléphone** : dans Safari ou Chrome, faites « Ajouter à l'écran d'accueil » pour obtenir l'app plein écran.

## Architecture

```
server/        API Express + SQLite (node:sqlite)
  auth.js      sessions (cookie httpOnly), mots de passe scrypt, rôles et permissions
  api.js       routes REST, contrôle d'accès par équipe et par rôle
  demo.js      bibliothèque de démarrage et équipe d'exemple
src/
  pitch/       moteur terrain : géométrie, rendu canvas, animation, édition, export vidéo
  pages/       écrans (éditeur, séances, live, joueurs, admin…)
  lib/         API (file d'attente hors-ligne), contexte, types
```

Les identifiants sont générés côté client et les écritures sont des `PUT` idempotents : une modification faite hors ligne peut être rejouée sans risque de doublon.

## Confidentialité (données de mineurs)
- Les parents n'accèdent qu'aux fiches de **leurs** enfants.
- Une remarque reste privée aux éducateurs, sauf si elle est explicitement marquée « Partagée avec les parents ».
- Le niveau d'aisance (qui sert à équilibrer les groupes) n'est jamais envoyé aux parents.
- Le lien public d'une séance ne contient ni présences, ni groupes, ni notes des éducateurs.
