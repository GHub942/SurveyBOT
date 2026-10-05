# 🤖 Enquête Bot — Bot Discord d'enquêtes paramétrable

Bot Discord (discord.js v14) permettant de créer et gérer des enquêtes
entièrement paramétrables via un tableau de bord interactif, avec un système
de permissions strict, sans base de données externe (SQLite local intégré à
Node.js).

## ⚠️ Mise à jour depuis une version antérieure

- Si `src/commands/config.js` existe encore, supprime-le (remplacé par
  `dashboard.js`).
- `deploy-commands.js` et `clear-commands.js` à la racine ont été fusionnés
  dans `src/scripts/commands.js`. Supprime les deux anciens fichiers s'ils
  traînent encore à la racine.
- La base de données a déménagé de `data.sqlite` (racine) vers
  `databases/data.sqlite`. Si tu as une base existante, déplace-la toi-même
  dans le nouveau dossier `databases/` avant de relancer le bot (sinon il en
  recrée une vide au nouvel emplacement).
- Relance `node src/scripts/commands.js clear` puis `npm run deploy` pour
  nettoyer d'éventuelles commandes dupliquées.

## ✨ Fonctionnalités

### `/dashboard enquete` — Tableau de bord
`/dashboard` est un **groupe de commande** : `enquete` (le tableau de bord) et
`restaurer` (restauration d'une sauvegarde, voir plus bas) — d'autres
sous-commandes pourront s'ajouter plus tard sans rien casser.

Deux modes, à la manière de Bivouac/BivouacBOT_PreProd :
- Si tu as une permission déléguée (ou si tu es **propriétaire du serveur**),
  `/dashboard enquete` ouvre d'abord un **écran de choix** entre les deux
  modes. Un membre sans aucune permission est envoyé **directement** en mode
  utilisateur, sans jamais voir le mode gestion.
- **Mode gestion** : organisé en 3 lignes (Enquêtes / Communication /
  Administration, Statistiques juste après "Gérer les données") et ne montre
  que les sections auxquelles l'utilisateur a accès.
- **Mode utilisateur** : permet à **n'importe quel membre** de retrouver les
  enquêtes auxquelles il a répondu (de façon non-anonyme) et de :
  - 👁️ **voir** sa réponse, toujours ;
  - ✏️ **modifier** sa réponse (si autorisé par l'enquête, et si elle est
    toujours active) — reprend directement ses réponses actuelles ;
  - 🗑️ **supprimer** sa réponse (si autorisé par l'enquête) ;

  sans jamais passer par un admin — sauf si l'enquête a désactivé l'option
  concernée, si l'enquête est **archivée** (lecture seule), ou si le membre a
  été **bloqué** (bouton "Bloquer" dans 🗄️ Gérer les données), auquel cas la
  permission **Gérer la base de données** est requise.

- **📋 Gestion des enquêtes** : création, liste paginée, et deux sous-listes
  séparées accessibles par bouton — **🗄️ Archivées** et **📑 Modèles**.
  - **Nouvelle enquête** : à partir d'un **modèle de questions pré-rempli** ou
    vierge, ajout de questions par un flux de boutons (type → obligatoire →
    réglages → intitulé) : 📝 Texte (une/plusieurs lignes), 🔢 Nombre
    (min/max optionnels), 🔘 Choix (nombre min/max d'options sélectionnables).
  - Chaque question peut être **réordonnée**, modifiée, supprimée, ou rendue
    **conditionnelle** 🔀 : affichée uniquement si la réponse à une question à
    choix précédente correspond à une valeur donnée (logique de saut).
  - **Aperçu interactif**, publication (avec vérification préalable des
    permissions du bot dans le salon cible), puis depuis le tableau de bord
    d'une enquête : renommer/modifier, changer la **confidentialité**,
    programmer une clôture automatique, autoriser ou non la **suppression**
    et la **modification en libre-service** par le membre, clôturer/rouvrir,
    dupliquer, exporter en **HTML** ou **CSV**, voir des **graphiques**.
  - **🔧 Avancé** (sous-panneau dédié) : 🏆 rôle Discord attribué
    automatiquement à l'envoi d'une réponse (retiré si la réponse est
    supprimée), ⏰ rappel automatique par MP aux membres n'ayant pas encore
    répondu (X minutes avant la clôture programmée), 🎲 tirage au sort parmi
    les répondants identifiés, 📑 marquer l'enquête comme **modèle
    réutilisable**, 💾 export/**restauration** d'une sauvegarde JSON complète.
  - **🗄️ Archivage** : une enquête peut être archivée au lieu d'être
    supprimée directement. Une fois archivée : exclue des statistiques
    globales, réponses toujours lisibles (export HTML/CSV/graphiques), plus
    aucune modification possible (ni sur l'enquête, ni sur les réponses des
    membres) tant qu'elle n'est pas désarchivée. La **suppression définitive**
    n'est possible qu'une fois l'enquête archivée.
  - **📑 Modèles réutilisables** : une enquête marquée "modèle" ne peut pas
    être publiée telle quelle ; elle sert de base à dupliquer (bouton dédié)
    pour créer de vraies enquêtes à partir d'elle (ex : sondage mensuel
    récurrent). Exclue de la liste active et des statistiques.
- **📨 Salons** : salon d'annonce des enquêtes et salon de réception des
  réponses, chacun désactivable indépendamment.
- **🗄️ Gérer les données** : choisis un **utilisateur** (avec bouton
  **Bloquer/Débloquer** le mode utilisateur) ou une **enquête**, puis consulte
  ses réponses (export HTML) ou supprime-les.
- **📜 Journal** : filtrable par **plusieurs membres et plusieurs types
  d'action à la fois** (menus à sélection multiple ; il suffit de
  désélectionner pour retirer un filtre). Les actions automatiques (clôture,
  rappel...) sont attribuées à la **mention du bot**, pas à "Système".
- **📊 Statistiques** : vue d'ensemble avec filtre par statut — nombre
  d'enquêtes, total de réponses, classement des plus répondues (modèles et
  enquêtes archivées toujours exclus).
- **📢 Envoyer un MP** : à tous les membres, à un rôle, ou à des utilisateurs
  précis, avec variables substituées par destinataire et aperçu avant envoi.
- **👋 MP de bienvenue** : envoyé automatiquement à chaque nouveau membre.
- **🔑 Permissions** : voir plus bas.

Le message public d'une enquête affiche son statut, sa date de clôture, le
mode de confidentialité, le nombre de questions et le nombre de réponses
reçues en direct.

### `/dashboard restaurer <fichier>` — Restaurer une sauvegarde
Recrée une enquête (questions, logique conditionnelle, réponses) en brouillon
à partir d'un fichier `.json` généré par le bouton **💾 Sauvegarde JSON** du
panneau Avancé. Réservé à **Gérer les enquêtes**.

### `/enquete <nom>` — Répondre à une enquête
Flux de réponse avec bouton **◀️ Précédent**, questions conditionnelles
(certaines questions n'apparaissent que selon une réponse précédente),
récapitulatif avant envoi définitif, choix du mode de confidentialité si
l'enquête en propose plusieurs, détection de clôture en cours de route, et
session persistée en base (survit à un redémarrage du bot).

## 🔒 Confidentialité des réponses

À la création d'une enquête (ou modifiable ensuite dans "Anonymat"), un
`<select>` à choix multiple permet d'activer un ou plusieurs des 3 modes :

| Mode | Comportement |
|---|---|
| 🌐 **Publique** | Le nom du répondant est visible dans les stats/exports |
| 🛡️ **Semi-privé** | Le nom n'est visible que du staff (limite les doublons) |
| 🙈 **Privé** | Aucune identité conservée → réponses illimitées |

- **1 seul mode coché** → comportement figé, comme avant.
- **Plusieurs cochés** → chaque membre choisit, au moment de répondre, parmi
  exactement les modes activés (n'importe quelle combinaison, Privé inclus).
- Dès que **Privé** est l'une des options proposées, la limite de réponses
  par utilisateur est forcée à illimité (elle ne peut plus être garantie).

## 🔑 Système de permissions

**Aucune permission Discord ne donne accès au bot.** Seul le **propriétaire
réel du serveur** a un accès total, automatique et permanent (vérifié en
direct auprès de Discord, jamais stocké, jamais modifiable). Tout autre
membre — y compris un administrateur Discord — doit recevoir ses permissions
explicitement via `/dashboard enquete` → 🔑 Permissions.

| Permission | Donne accès à |
|---|---|
| 📋 Gérer les enquêtes | Créer/modifier/supprimer/archiver des enquêtes et leurs questions |
| 📢 MP à tous les membres | Envoyer un MP à l'ensemble du serveur |
| ✉️ Gérer les MP ciblés | Envoyer un MP à un rôle ou des membres précis (limitable) |
| 👋 Gérer les MP de bienvenue | Activer/désactiver/modifier le message de bienvenue |
| 📜 Voir les logs | Consulter le journal d'audit |
| 🗄️ Gérer la base de données | Supprimer des données de membres/enquêtes, bloquer/débloquer un membre |
| 🔑 Gérer les permissions | Accorder/retirer les permissions ci-dessus à d'autres membres |

Dans le panneau Permissions, le propriétaire du serveur apparaît avec toutes
les permissions cochées et **verrouillées** (non modifiables). Pour "Gérer
les MP ciblés", un responsable peut restreindre les rôles/membres qu'un
utilisateur a le droit de cibler ; sans restriction définie, l'accès est
libre.

## 📦 Installation

```bash
npm install
cp .env.example .env
```

Remplis `.env` avec `DISCORD_TOKEN`, `CLIENT_ID`, et optionnellement
`GUILD_ID` pour un déploiement instantané sur un serveur de test.

### Créer l'application Discord

1. https://discord.com/developers/applications → crée une application.
2. Onglet **Bot** : crée le bot, copie le token dans `DISCORD_TOKEN`, active
   l'intent privilégié **SERVER MEMBERS INTENT**.
3. Onglet **OAuth2 > URL Generator** : coche `bot` et `applications.commands`,
   permissions minimum : `Send Messages`, `Embed Links`, `Attach Files`,
   `Use Slash Commands`, `Manage Roles` (si tu utilises le rôle de
   récompense — le rôle du bot doit être placé au-dessus du rôle à attribuer).

### Lancer le bot

Sous Windows, double-clique sur `start.bat` ; sous Linux/Mac, lance
`./start.sh` (`chmod +x start.sh` la première fois). Les deux scripts
vérifient la configuration, installent les dépendances si besoin, proposent
d'activer les **logs détaillés**, déploient les commandes puis démarrent le
bot.

Manuellement :
```bash
npm run deploy   # enregistre /dashboard et /enquete
npm start        # démarre le bot (LOG_LEVEL=warn par défaut)
LOG_LEVEL=debug npm start   # pour des logs détaillés
npm run clear    # nettoie toutes les commandes enregistrées (dépannage)
```

## 🗂️ Structure du projet

```
enquete-bot/
├── .claude/                # réservé (Claude Code)
├── .devin/                 # réservé (Devin)
├── databases/
│   └── data.sqlite         # créé automatiquement au premier lancement
├── start.bat                # lancement rapide (Windows)
├── start.sh                 # lancement rapide (Linux/Mac)
├── .env / .env.example
├── LICENSE.md / SECURITY.md / CONTRIBUTING.md
└── src/
    ├── index.js             # point d'entrée, connexion du client, gestion d'erreurs globale
    ├── database.js          # schéma SQLite (node:sqlite) + migrations + index
    ├── logger.js            # logging simple par niveau (error/warn/info/debug)
    ├── permissions.js       # permissions : propriétaire + permissions déléguées
    ├── logs.js              # journal d'audit (filtres multi-sélection)
    ├── messages.js          # message public d'enquête + vérification des permissions du salon
    ├── scheduler.js         # clôture automatique + rappels automatiques (vérifie chaque minute)
    ├── utils.js             # sessions en mémoire, presets, confidentialité, helpers CSV
    ├── panels.js            # tableau de bord, builder, dashboard avancé, RGPD, logs
    ├── responseFlow.js      # flux de réponse (questions conditionnelles, anonymat, recap)
    ├── interactions.js      # dispatcher central + vérification des permissions
    ├── events.js            # MP de bienvenue à l'arrivée d'un membre
    ├── scripts/
    │   └── commands.js      # déploiement/nettoyage des commandes slash (deploy|clear)
    └── commands/
        ├── dashboard.js
        └── enquete.js
```

## 🧠 Notes techniques

- SQLite local via `node:sqlite` (intégré à Node.js 22.5+, aucune compilation
  native requise), mode `WAL` + `synchronous = NORMAL`, index sur les
  colonnes les plus filtrées.
- Gestionnaires d'erreurs globaux (`client.on('error')`, `shardError`,
  `unhandledRejection`, `uncaughtException`) : les erreurs sont toujours
  journalisées, jamais silencieuses.
- Avant toute publication d'enquête, les permissions du bot dans le salon
  cible sont vérifiées (`channel.permissionsFor`) ; en cas de permissions
  manquantes, l'enquête reste en brouillon plutôt que de passer "active" sans
  message public réellement envoyé.
- Les **sessions de réponse** sont persistées en base : un redémarrage du bot
  en pleine réponse n'efface pas la progression.
- Les **réponses anonymes** (mode Privé) sont stockées avec
  `user_id = 'anonymous'` : la limite de réponses par utilisateur, le rôle de
  récompense côté "déjà répondu", et le mode utilisateur ne s'appliquent
  qu'aux réponses non-anonymes.
- Le rôle de récompense est attribué/retiré même pour une réponse envoyée en
  mode Privé (le bot sait toujours qui a cliqué ; seule la donnée stockée est
  anonyme).
- Le graphique texte du dashboard (`█`/`░`) évite toute dépendance de rendu
  graphique native ; le bouton "Graphiques" passe par l'API publique
  QuickChart (aucune dépendance locale).
- L'export HTML résout le pseudo Discord de chaque répondant non-anonyme via
  l'API (mis en cache) et le transforme en lien cliquable vers
  `https://discord.dog/<id>`.
- Le rappel automatique peuple le cache des membres du serveur
  (`guild.members.fetch()`) pour déterminer qui n'a pas encore répondu —
  peut être coûteux sur un très gros serveur.

## 🔧 Personnalisation possible

- Ajouter d'autres types de questions dans `panels.js` (`handleTypeChoice`/
  `addQuestion`) et `responseFlow.js` (`renderQuestion`).
- Ajouter d'autres modèles d'enquête dans `SURVEY_TEMPLATES` (`utils.js`).
- Ajouter d'autres permissions granulaires dans `PERMS`/`PERM_LABELS`
  (`permissions.js`).
