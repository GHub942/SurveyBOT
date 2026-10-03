# 🤖 Enquête Bot — Bot Discord d'enquêtes paramétrable

Bot Discord (discord.js v14) permettant de créer et gérer des enquêtes entièrement
paramétrables via un tableau de bord interactif, avec un système de permissions
granulaires, sans base de données externe (SQLite local intégré à Node.js).

## ⚠️ Mise à jour depuis une version antérieure

Si tu mets à jour un dossier existant : **supprime `src/commands/config.js`** s'il
est encore présent (remplacé par `dashboard.js`) — le garder provoque un crash au
démarrage. Après avoir remplacé les fichiers, relance `node clear-commands.js` puis
`npm run deploy` pour nettoyer les anciennes commandes Discord dupliquées.

## ✨ Fonctionnalités

### `/dashboard enquete` — Tableau de bord
`/dashboard` est un **groupe de commande** (`/dashboard enquete` pour l'instant,
d'autres sous-commandes pourront s'ajouter plus tard sans rien casser).

Deux modes, à la manière de Bivouac/BivouacBOT_PreProd :
- Si tu peux gérer le bot (permission déléguée ou **Gérer le serveur**),
  `/dashboard enquete` ouvre d'abord un **écran de choix** entre les deux modes.
  Un membre sans aucune permission est envoyé **directement** en mode
  utilisateur, sans jamais voir le mode gestion.
- **Mode gestion** : identique à avant. Organisé en 3 lignes (Enquêtes /
  Communication / Administration, Statistiques juste après "Gérer les
  données") et ne montre que les sections auxquelles l'utilisateur a accès.
- **Mode utilisateur** : permet à **n'importe quel membre** de retrouver les
  enquêtes auxquelles il a répondu (de façon non-anonyme) et de :
  - 👁️ **voir** sa réponse, toujours ;
  - ✏️ **modifier** sa réponse (si autorisé par l'enquête, et si elle est
    toujours active) — reprend directement ses réponses actuelles, question
    par question ;
  - 🗑️ **supprimer** sa réponse (si autorisé par l'enquête) ;

  sans jamais passer par un admin — sauf si l'enquête a désactivé l'option
  concernée, si l'enquête est **archivée** (lecture seule), ou si le membre a
  été **bloqué** (bouton "Bloquer" dans 🗄️ Gérer les données), auquel cas la
  permission **Gérer la base de données** est requise.

- **📋 Gestion des enquêtes** (menu unique, sans sous-écran superflu) : le
  bouton "Nouvelle enquête" et la liste des enquêtes existantes (menu
  déroulant, avec pagination) sont directement sur le même écran.
- **📨 Salons** (menu unique) : salon d'annonce des enquêtes et salon de
  réception des réponses, chacun désactivable indépendamment.
- **🗄️ Gérer les données** : choisis un **utilisateur** ou une **enquête**,
  puis consulte ses réponses (export **HTML**) ou supprime-les — en deux
  étapes claires plutôt qu'une suppression directe.
- **📜 Journal** : filtrable par **plusieurs membres et plusieurs types
  d'action à la fois** (menus à sélection multiple, pas de bouton "réinitialiser"
  — il suffit de désélectionner). Les actions automatiques (ex : clôture
  programmée) sont attribuées au **bot** lui-même (sa mention), pas à "Système".
- **🗄️ Archivage** : une enquête peut être **archivée** au lieu d'être
  supprimée directement. Une fois archivée : exclue des statistiques globales,
  ses réponses restent lisibles (export HTML/graphiques), mais plus aucune
  modification n'est possible (ni sur l'enquête, ni sur les réponses des
  membres) tant qu'elle n'est pas désarchivée. La **suppression définitive**
  n'est possible qu'une fois l'enquête archivée.

- **📋 Gestion des enquêtes** (menu unique regroupant création et gestion) :
  - **Nouvelle enquête** : à partir d'un **modèle pré-rempli** ou vierge, ajout de
    questions par un flux de boutons (type → obligatoire → réglages spécifiques →
    intitulé) avec pour chaque type :
    - 📝 **Texte** : une seule ligne ou plusieurs lignes
    - 🔢 **Nombre** : valeur minimum/maximum autorisée (optionnel)
    - 🔘 **Choix multiple** : nombre minimum et maximum d'options sélectionnables
      (1/1 = choix unique classique, ou une vraie sélection multiple)
  - Le panneau de construction affiche chaque question avec son type (icône),
    obligatoire ou non (badge), et ses réglages en un coup d'œil. Chaque question
    peut être **réorganisée** (⬆️/⬇️), modifiée, ou supprimée.
  - **Aperçu interactif** (répondre réellement au questionnaire pour le tester,
    sans qu'aucune réponse ne soit enregistrée — annoncé au début et à la fin),
    publication, puis depuis le tableau de bord d'une enquête : **renommer/
    modifier**, changer le **mode d'anonymat**, programmer une **clôture
    automatique**, autoriser ou non la **suppression** et la **modification en
    libre-service** par le membre (mode utilisateur, activées par défaut),
    **clôturer/rouvrir**, **dupliquer**, exporter en **HTML**
    (tableau stylé, pseudo en lien cliquable vers `discord.dog` pour lookup rapide
    de l'ID) ou voir des **graphiques** générés à la volée, supprimer (avec
    confirmation).
- **📨 Salons** (menu unique regroupant les deux salons) : le salon où l'enquête
  est publiée (avec le bouton "Répondre"), et un salon de réception séparé
  (optionnel) où un résumé de chaque nouvelle réponse est posté en direct.
- **📊 Statistiques** (en bas du panneau) : vue d'ensemble avec **filtre par
  statut** (toutes / actives / brouillons / fermées) — nombre d'enquêtes, total de
  réponses, classement des enquêtes les plus répondues pour le filtre choisi.
- **📢 Envoyer un MP** : à tous les membres, à un rôle, ou à des utilisateurs précis
  — cible et mise en avant d'une enquête choisies sur un **même écran**. Le
  message est envoyé sous forme d'**embed**, avec des **variables** substituées
  individuellement par destinataire : `{user}`, `{userMention}`, `{userId}`,
  `{surveyName}`, `{surveyId}`, `{surveyPrivacy}`, `{serverName}`. Des **messages
  pré-remplis** (Amical/Formel/Rappel) sont disponibles, ou un message
  personnalisé. Avant tout envoi réel : un récapitulatif de confirmation (nombre
  de destinataires, aperçu du texte) puis un **second message éphémère séparé**
  montrant le rendu final exact (embed + boutons désactivés), avec les propres
  infos de l'expéditeur en exemple.
- **👋 MP de bienvenue** (menu unique regroupant activation et message) : envoyé
  automatiquement à chaque nouveau membre.
- **📜 Voir les logs** : journal d'audit paginé, **filtrable par membre et par
  type d'action**.
- **🗄️ Gérer les données** : supprimer les réponses d'un utilisateur précis ou
  vider les réponses d'une enquête (RGPD).
- **🔑 Permissions** (réservé à **Gérer le serveur**) : attribuer indépendamment à
  chaque membre une ou plusieurs permissions, et pour "Gérer les MP ciblés",
  limiter à quels rôles/membres précis la personne peut envoyer des MP.

Le message public d'une enquête affiche son statut, sa date de clôture, le
nombre de réponses maximum par membre, le mode d'anonymat, le nombre de
questions et le **nombre de réponses reçues en direct** (mis à jour
automatiquement à chaque nouvelle réponse).

### `/enquete <nom>` — Répondre à une enquête
Flux de réponse avec bouton **◀️ Précédent**, **récapitulatif** avant envoi
définitif (modifiable/annulable), choix de répondre **anonymement** si
l'enquête le permet, détection si l'enquête a été clôturée en cours de route,
et session **persistée en base** (survit à un redémarrage du bot).

## 🔒 Modes de confidentialité des réponses

À la création d'une enquête (ou modifiable ensuite), 4 modes sont disponibles :

| Mode | Comportement |
|---|---|
| 🌐 **Publique** | Le nom du répondant est visible dans les stats/exports |
| 🛡️ **Semi-privé** | Le nom n'est visible que du staff (limite les doublons) |
| 🙈 **Privé** | Aucune identité conservée → réponses **illimitées** par personne (forcé automatiquement) |
| 🎭 **Au choix** | Chaque membre choisit, au moment de répondre, entre Publique et Semi-privé |

## 🔑 Système de permissions

| Permission | Donne accès à |
|---|---|
| 📋 Gérer les enquêtes | Créer/modifier/supprimer des enquêtes et leurs questions |
| 📢 MP à tous les membres | Envoyer un MP à l'ensemble du serveur |
| ✉️ Gérer les MP ciblés | Envoyer un MP à un rôle ou des membres précis (limitable) |
| 👋 Gérer les MP de bienvenue | Activer/désactiver/modifier le message de bienvenue |
| 📜 Voir les logs | Consulter le journal d'audit |
| 🗄️ Gérer la base de données | Supprimer des données de membres/enquêtes, bloquer/débloquer un membre (mode utilisateur) |

Les membres avec **Gérer le serveur** ont accès à tout. La gestion des
permissions (bouton "Permissions") est réservée à ces membres, pour éviter
qu'un utilisateur ne s'auto-attribue des droits. Pour "Gérer les MP ciblés",
un responsable peut restreindre les rôles/membres qu'un utilisateur a le droit
de cibler ; sans restriction définie, l'accès est libre.

## 📦 Installation

```bash
npm install
cp .env.example .env
```

Remplis `.env` avec `DISCORD_TOKEN`, `CLIENT_ID`, et optionnellement `GUILD_ID`
pour un déploiement instantané sur un serveur de test.

### Créer l'application Discord

1. https://discord.com/developers/applications → crée une application.
2. Onglet **Bot** : crée le bot, copie le token dans `DISCORD_TOKEN`, active
   l'intent privilégié **SERVER MEMBERS INTENT**.
3. Onglet **OAuth2 > URL Generator** : coche `bot` et `applications.commands`,
   permissions minimum : `Send Messages`, `Embed Links`, `Attach Files`,
   `Use Slash Commands`.

### Lancer le bot

Sous Windows, double-clique sur `quickstart.bat` : il vérifie la configuration,
installe les dépendances si besoin, te propose d'activer les **logs détaillés**
(par défaut, seuls erreurs et avertissements s'affichent), déploie les
commandes puis démarre le bot.

Manuellement :
```bash
npm run deploy   # enregistre /dashboard et /enquete
npm start        # démarre le bot (LOG_LEVEL=warn par défaut)
LOG_LEVEL=debug npm start   # pour des logs détaillés
```

## 🗂️ Structure du projet

```
enquete-bot/
├── deploy-commands.js     # enregistre /dashboard et /enquete
├── clear-commands.js      # nettoie les anciennes commandes dupliquées
├── quickstart.bat         # lancement rapide (Windows)
├── src/
│   ├── index.js           # point d'entrée, connexion du client
│   ├── database.js        # schéma SQLite (node:sqlite) + migrations légères
│   ├── logger.js           # logging simple par niveau (error/warn/info/debug)
│   ├── permissions.js      # système de permissions granulaires par utilisateur
│   ├── logs.js             # journal d'audit (avec filtres)
│   ├── messages.js         # construction/rafraîchissement du message public d'enquête
│   ├── scheduler.js        # clôture automatique programmée (vérifie chaque minute)
│   ├── utils.js            # sessions en mémoire, presets, variables MP, helpers
│   ├── panels.js           # tableau de bord, builder d'enquête, dashboard, RGPD, logs
│   ├── responseFlow.js      # flux de réponse (persisté en base, anonymat, aperçu, recap)
│   ├── interactions.js      # dispatcher central + vérification des permissions
│   ├── events.js            # MP de bienvenue à l'arrivée d'un membre
│   └── commands/
│       ├── dashboard.js
│       └── enquete.js
└── data.sqlite            # créé automatiquement au premier lancement
```

## 🧠 Notes techniques

- SQLite local via `node:sqlite` (intégré à Node.js 22.5+, aucune compilation
  native requise).
- Les **sessions de réponse** sont persistées en base : un redémarrage du bot en
  pleine réponse n'efface pas la progression.
- Le broadcast de MP **met en cache les destinataires résolus** lors de l'étape
  de confirmation et les réutilise tels quels à l'envoi, pour éviter un second
  aller-retour identique vers l'API Discord (optimisation notable sur un gros
  serveur avec la cible "tous les membres").
- Les **réponses anonymes** sont stockées avec `user_id = 'anonymous'` : la
  limite de réponses par utilisateur ne peut donc être garantie que pour les
  réponses non-anonymes.
- Le **graphique** du dashboard est une jauge textuelle (`█`/`░`) plutôt qu'une
  image, pour éviter toute dépendance de rendu graphique native ; les
  graphiques en image (bouton "Graphiques") passent par l'API publique
  QuickChart (aucune dépendance locale, juste une URL d'image).
- L'export HTML résout le pseudo Discord de chaque répondant non-anonyme via
  l'API (mis en cache pour éviter les doublons) et le transforme en lien
  cliquable vers `https://discord.dog/<id>` pour un lookup rapide.

## 🔧 Personnalisation possible

- Ajouter d'autres types de questions dans `panels.js` (`handleTypeChoice`/
  `addQuestion`) et `responseFlow.js` (`renderQuestion`).
- Ajouter d'autres modèles d'enquête dans `SURVEY_TEMPLATES` (`utils.js`).
- Ajouter d'autres permissions granulaires dans `PERMS`/`PERM_LABELS`
  (`permissions.js`).
