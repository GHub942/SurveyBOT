# 🤖 Enquête Bot — Bot Discord d'enquêtes paramétrable

Bot Discord (discord.js v14) permettant de créer et gérer des enquêtes entièrement
paramétrables via un panneau interactif, sans base de données externe (SQLite local).

## ✨ Fonctionnalités

- **`/config`** — Panneau de configuration (réservé aux membres avec la permission
  **Gérer le serveur**, ou aux utilisateurs ajoutés à la **liste blanche**) :
  - Choisir le **salon** où sont publiées les enquêtes et où les membres répondent
  - Gérer la **liste blanche** des utilisateurs autorisés à utiliser `/config`
  - Créer une **nouvelle enquête** (nom, description, réponses max/utilisateur, **clôture automatique** programmable JJ/MM/AAAA HH:MM)
  - Choisir le **mode d'anonymat** de chaque enquête : non anonyme / au choix du membre / anonyme total
  - Ajouter des **questions** de type `texte`, `nombre` ou `choix`, via un flux par boutons (type → obligatoire → intitulé), sans jamais avoir à taper du texte brut pour un choix
  - Gérer une question existante (**modifier** ou **supprimer avec confirmation**)
  - **Aperçu** du message avant publication, puis **publication** avec bouton "Répondre"
  - **Dupliquer** une enquête existante (copie en brouillon, modifiable)
  - Activer/désactiver l'envoi automatique d'un **MP de bienvenue** aux nouveaux membres,
    avec **3 messages pré-remplis** (Amical / Formel / Rappel) ou un message personnalisé
  - Envoyer un **MP ciblé** : à tous les membres, à un **rôle**, ou à des **utilisateurs précis**,
    avec les mêmes messages pré-remplis ; chaque MP inclut un bouton "Répondre" (ou un menu si
    plusieurs enquêtes actives) et un bouton "Supprimer ce message"
  - **Dashboard** par enquête : nombre de réponses, **graphique en barres** pour les questions à
    choix, pagination si beaucoup de questions, export **CSV**, clôture/réactivation, suppression
  - **Gestion des données** (RGPD) : supprimer toutes les réponses d'un utilisateur précis, ou
    vider les réponses d'une enquête entière (l'enquête et ses questions sont conservées)
  - **Journal d'audit** : historique paginé de toutes les actions de configuration (qui, quoi, quand)

- **`/enquete <nom>`** — Répondre à une enquête active (avec autocomplétion des noms).
  Si l'enquête le permet, le membre choisit de répondre **anonymement** ou non. Le nombre de
  réponses par utilisateur est automatiquement limité selon la configuration (les réponses
  anonymes ne peuvent pas être comptabilisées par utilisateur, par nature).
  La progression est **sauvegardée en base** : si le bot redémarre en pleine réponse, la
  session reprend exactement là où elle s'était arrêtée.

- **Clôture automatique** — Une enquête programmée avec une date de clôture se ferme toute
  seule (vérification chaque minute), et le bouton "Répondre" du message public est désactivé.

## 📦 Installation

```bash
npm install
cp .env.example .env
```

Remplis le fichier `.env` :

```
DISCORD_TOKEN=...   # Discord Developer Portal > Bot > Reset Token
CLIENT_ID=...        # Discord Developer Portal > General Information > Application ID
GUILD_ID=...         # optionnel : ID d'un serveur pour un déploiement instantané en dev
```

### Créer l'application Discord

1. Va sur https://discord.com/developers/applications et crée une application.
2. Onglet **Bot** : crée le bot, copie le token dans `DISCORD_TOKEN`.
3. Toujours dans **Bot** : active l'intent privilégié **SERVER MEMBERS INTENT**
   (nécessaire pour le MP de bienvenue et le broadcast à tous les membres).
4. Onglet **OAuth2 > URL Generator** : coche `bot` et `applications.commands`,
   puis dans permissions coche au minimum : `Send Messages`, `Embed Links`,
   `Attach Files`, `Use Slash Commands`. Utilise l'URL générée pour inviter le bot.

### Déployer les commandes slash

```bash
npm run deploy
```

### Lancer le bot

```bash
npm start
```

## 🗂️ Structure du projet

```
enquete-bot/
├── deploy-commands.js     # enregistre /config et /enquete auprès de Discord
├── src/
│   ├── index.js           # point d'entrée, connexion du client
│   ├── database.js        # schéma SQLite (node:sqlite) + migrations légères
│   ├── logs.js             # journal d'audit
│   ├── scheduler.js        # clôture automatique programmée (vérifie chaque minute)
│   ├── utils.js            # permissions, sessions en mémoire, helpers (dates, graphiques)
│   ├── panels.js           # panneau /config, builder d'enquête, dashboard, RGPD, logs
│   ├── responseFlow.js      # flux de réponse à une enquête (persisté en base, anonymat)
│   ├── interactions.js      # dispatcher central (boutons/selects/modals)
│   ├── events.js            # MP de bienvenue à l'arrivée d'un membre
│   └── commands/
│       ├── config.js
│       └── enquete.js
└── data.sqlite            # créé automatiquement au premier lancement
```

## 🧠 Notes techniques

- Les données sont stockées dans un fichier **SQLite local** (`data.sqlite`), créé
  automatiquement via `node:sqlite` (intégré à Node.js, aucune compilation native
  requise) — aucune base de données externe non plus.
- Les questions de type "texte"/"nombre" sont recueillies via une **fenêtre modale**
  (pop-up Discord), celles de type "choix" via un **menu déroulant**. Les enquêtes
  se répondent question par question dans un message éphémère (visible uniquement
  par le répondant).
- Les **sessions de réponse** (progression dans une enquête) sont **persistées en base**
  (table `response_sessions`) : un redémarrage du bot en pleine réponse n'efface pas la
  progression, l'utilisateur peut relancer `/enquete` et reprendre où il en était. Les
  sessions de *construction* d'enquête (brouillon de question en cours) restent en
  mémoire, sans conséquence puisqu'elles ne concernent que l'équipe de modération.
- Le broadcast de MP respecte une petite pause entre chaque envoi, avec une reprise
  automatique (retry avec backoff) en cas de réponse "rate limited" de Discord ; les
  membres ayant fermé leurs MP sont simplement comptabilisés en échec.
- Le **journal d'audit** (table `audit_log`) enregistre qui a fait quoi et quand
  (configuration, création/publication/suppression d'enquête, questions, MP envoyés,
  exports, suppressions de données). Consultable via le bouton "Journal" du panneau.
- Les **réponses anonymes** sont stockées avec `user_id = 'anonymous'` : elles ne
  peuvent techniquement pas être rattachées à un membre précis, y compris par le staff
  via "Gérer les données". La limite de réponses par utilisateur ne peut donc être
  garantie que pour les réponses non-anonymes.
- Le **graphique** du dashboard est une jauge textuelle (caractères Unicode `█`/`░`)
  plutôt qu'une image : cela évite toute dépendance à une librairie de rendu graphique
  (souvent native et donc sujette aux mêmes soucis de compilation que `better-sqlite3`).

## 🔧 Personnalisation possible

- Ajouter d'autres types de questions (ex: échelle 1-5, date) dans `panels.js`
  (fonctions `handleTypeChoice`/`addQuestion`) et `responseFlow.js` (`renderQuestion`).
- Le menu "Gérer une question" et la liste des enquêtes sont limités à 25 éléments
  par les menus déroulants Discord ; la pagination existe pour la liste d'enquêtes,
  mais pas encore pour la sélection de question au-delà de 25 (cas rare en pratique).
