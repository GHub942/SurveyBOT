@echo off
REM Lancement rapide du bot d'enquêtes (Windows)
REM Usage : quickstart.bat   (à placer a la racine du dossier enquete-bot\)

setlocal enabledelayedexpansion

echo 🤖 Enquete Bot — demarrage rapide
echo.

REM 1. Verifie/cree le .env
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo 📄 Fichier .env cree a partir de .env.example.
        echo ⚠️  Edite le fichier .env avec ton DISCORD_TOKEN et ton CLIENT_ID avant de continuer.
        pause
        exit /b 1
    ) else (
        echo ❌ Aucun .env ni .env.example trouve. Lance ce script depuis le dossier enquete-bot\.
        pause
        exit /b 1
    )
)

REM 2. Verifie que le token est bien renseigne
findstr /C:"colle_ton_token_ici" ".env" >nul
if %errorlevel%==0 (
    echo ❌ Le fichier .env contient encore des valeurs par defaut.
    echo    Remplis DISCORD_TOKEN et CLIENT_ID dans .env puis relance ce script.
    pause
    exit /b 1
)

REM 3. Installe les dependances si besoin
if not exist "node_modules\" (
    echo 📦 Installation des dependances npm install...
    call npm install
    if errorlevel 1 (
        echo ❌ Echec de npm install.
        pause
        exit /b 1
    )
)

REM 4. Deploie les commandes slash
echo 🚀 Deploiement des commandes /config et /enquete...
call npm run deploy
if errorlevel 1 (
    echo ❌ Echec du deploiement des commandes.
    pause
    exit /b 1
)

REM 5. Lance le bot
echo ▶️  Demarrage du bot...
call npm start

pause
