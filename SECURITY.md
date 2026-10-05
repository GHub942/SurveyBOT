# Politique de sécurité

## Signaler une vulnérabilité

Si tu découvres une faille de sécurité (fuite de données entre serveurs,
contournement du système de permissions, injection SQL, etc.), merci de
**ne pas** ouvrir une issue publique. Contacte directement un mainteneur du
projet (ou le propriétaire du dépôt) en privé, avec :

- une description de la faille et de son impact potentiel ;
- les étapes pour la reproduire ;
- si possible, un correctif suggéré.

Un correctif sera priorisé et un changelog de sécurité sera publié une fois
le correctif déployé.

## Bonnes pratiques déjà en place

- Aucune permission Discord native (Gérer le serveur, Administrateur, etc.)
  ne donne accès au bot : seul le propriétaire réel du serveur a un accès
  total, vérifié en direct auprès de Discord à chaque interaction. Tout le
  reste passe par le système de permissions interne du bot (voir le README).
- Les requêtes SQL utilisent systématiquement des requêtes préparées
  (`db.prepare(...).run(...)`), jamais de concaténation de chaînes avec des
  données utilisateur.
- Le fichier `.env` (token du bot, identifiants) ne doit **jamais** être
  commité ni partagé — il est exclu via `.gitignore`.
- Les fichiers de sauvegarde JSON (`💾 Sauvegarde JSON`) contiennent les
  identifiants Discord des répondants et le contenu de leurs réponses : à
  traiter comme une donnée sensible, à ne jamais partager publiquement.

## Versions supportées

Ce projet n'a pas de cycle de versions formel pour l'instant : seule la
dernière version sur la branche principale est maintenue et reçoit des
correctifs de sécurité.
