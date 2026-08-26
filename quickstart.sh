#!/usr/bin/env bash
# Lancement rapide du bot d'enquêtes
# Usage : ./quickstart.sh   (à placer à la racine du dossier enquete-bot/)

set -e

echo "🤖 Enquête Bot — démarrage rapide"
echo ""

# 1. Vérifie/crée le .env
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "📄 Fichier .env créé à partir de .env.example."
    echo "⚠️  Édite le fichier .env avec ton DISCORD_TOKEN et ton CLIENT_ID avant de continuer."
    exit 1
  else
    echo "❌ Aucun .env ni .env.example trouvé. Lance ce script depuis le dossier enquete-bot/."
    exit 1
  fi
fi

# 2. Vérifie que le token est bien renseigné
if grep -q "colle_ton_token_ici" .env 2>/dev/null; then
  echo "❌ Le fichier .env contient encore des valeurs par défaut."
  echo "   Remplis DISCORD_TOKEN et CLIENT_ID dans .env puis relance ce script."
  exit 1
fi

# 3. Installe les dépendances si besoin
if [ ! -d node_modules ]; then
  echo "📦 Installation des dépendances (npm install)..."
  npm install
fi

# 4. Déploie les commandes slash
echo "🚀 Déploiement des commandes /config et /enquete..."
npm run deploy

# 5. Lance le bot
echo "▶️  Démarrage du bot..."
npm start
