#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "  ============================================"
echo "             ENQUETE BOT - DEMARRAGE"
echo "  ============================================"
echo ""

# --- 1. Vérifie/crée le .env ---
if [ ! -f ".env" ]; then
  if [ -f ".env.example" ]; then
    cp ".env.example" ".env"
    echo "  [INFO] Fichier .env créé à partir de .env.example."
    echo "  [ATTENTION] Édite le fichier .env avec ton DISCORD_TOKEN"
    echo "              et ton CLIENT_ID, puis relance ce script."
    echo ""
    exit 1
  else
    echo "  [ERREUR] Aucun .env ni .env.example trouvé."
    echo "           Lance ce script depuis le dossier enquete-bot."
    echo ""
    exit 1
  fi
fi

if grep -q "colle_ton_token_ici" ".env"; then
  echo "  [ERREUR] Le fichier .env contient encore des valeurs par défaut."
  echo "           Remplis DISCORD_TOKEN et CLIENT_ID puis relance ce script."
  echo ""
  exit 1
fi

echo "  [OK] Configuration trouvée."
echo ""

# --- 2. Installe les dépendances si besoin ---
if [ ! -d "node_modules" ]; then
  echo "  --------------------------------------------"
  echo "  Installation des dépendances..."
  echo "  --------------------------------------------"
  npm install
  echo ""
fi

# --- 3. Niveau de logs ---
echo "  --------------------------------------------"
echo "  Niveau de journalisation"
echo "  --------------------------------------------"
echo "  Par défaut, seules les erreurs et les avertissements"
echo "  sont affichés dans la console."
echo ""
read -r -p "  Activer les logs détaillés (debug) ? (o/N) : " VERBOSE
if [[ "$VERBOSE" =~ ^[oOyY]$ ]]; then
  export LOG_LEVEL=debug
  echo "  -> Logs détaillés activés."
else
  export LOG_LEVEL=warn
  echo "  -> Logs réduits (erreurs + avertissements uniquement)."
fi
echo ""

# --- 4. Déploiement des commandes ---
echo "  --------------------------------------------"
echo "  Déploiement des commandes /dashboard et /enquete"
echo "  --------------------------------------------"
npm run deploy
echo ""

# --- 5. Démarrage ---
echo "  --------------------------------------------"
echo "  Démarrage du bot..."
echo "  --------------------------------------------"
echo ""
npm start

echo ""
echo "  [INFO] Le bot s'est arrêté."
