# Contribuer à Enquête Bot

## Mise en place de l'environnement

```bash
npm install
cp .env.example .env
# Remplis .env avec un token de bot de test (DISCORD_TOKEN, CLIENT_ID),
# idéalement avec GUILD_ID défini pour un déploiement instantané des
# commandes sur un serveur de test plutôt qu'un déploiement global (~1h de
# propagation).
npm run deploy
npm start
```

Active les logs détaillés avec `LOG_LEVEL=debug npm start` pendant le
développement.

## Structure du code

Voir la section "Structure du projet" du `README.md` pour le rôle de chaque
fichier. Quelques repères utiles :

- `interactions.js` est le **dispatcher central** : toute nouvelle
  interaction (bouton, select, modal) doit y être routée, avec sa règle de
  permission associée dans `checkPermissionForCustomId`.
- `panels.js` contient la quasi-totalité des panneaux et de leur logique
  métier (très gros fichier, organisé par sections commentées).
- `responseFlow.js` gère tout le parcours `/enquete` (questions, logique
  conditionnelle, anonymat, récapitulatif).
- Toute nouvelle colonne de base de données s'ajoute dans `database.js` via
  `safeAlter(...)`, jamais en modifiant directement un `CREATE TABLE`
  existant (pour rester compatible avec les bases déjà en place).

## Style de code

- Pas de framework de lint/format imposé pour l'instant : reste cohérent
  avec le style existant (2 espaces, points-virgules, commentaires en
  français expliquant le "pourquoi" plutôt que le "quoi").
- Les messages utilisateur (embeds, boutons, erreurs) sont en français.
- Toute action administrative doit être journalisée via `logs.logFromInteraction`
  ou `logs.log`.

## Avant de proposer une modification

1. Vérifie que `node -c` passe sur tous les fichiers modifiés (pas d'erreur
   de syntaxe).
2. Teste manuellement le flux concerné sur un serveur de test.
3. Si tu ajoutes une nouvelle commande ou sous-commande, pense à relancer
   `npm run deploy` (et éventuellement `npm run clear` en cas de doublons).
4. Décris clairement, dans ta pull request, ce qui change et pourquoi.
