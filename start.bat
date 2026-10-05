@echo off
setlocal enabledelayedexpansion
title Enquete Bot

echo.
echo   ============================================
echo              ENQUETE BOT - DEMARRAGE
echo   ============================================
echo.

REM --- 1. Verifie/cree le .env ---
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo   [INFO] Fichier .env cree a partir de .env.example.
        echo   [ATTENTION] Edite le fichier .env avec ton DISCORD_TOKEN
        echo               et ton CLIENT_ID, puis relance ce script.
        echo.
        pause
        exit /b 1
    ) else (
        echo   [ERREUR] Aucun .env ni .env.example trouve.
        echo            Lance ce script depuis le dossier enquete-bot.
        echo.
        pause
        exit /b 1
    )
)

findstr /C:"colle_ton_token_ici" ".env" >nul
if %errorlevel%==0 (
    echo   [ERREUR] Le fichier .env contient encore des valeurs par defaut.
    echo            Remplis DISCORD_TOKEN et CLIENT_ID puis relance ce script.
    echo.
    pause
    exit /b 1
)

echo   [OK] Configuration trouvee.
echo.

REM --- 2. Installe les dependances si besoin ---
if not exist "node_modules\" (
    echo   --------------------------------------------
    echo   Installation des dependances...
    echo   --------------------------------------------
    call npm install
    if errorlevel 1 (
        echo   [ERREUR] Echec de npm install.
        pause
        exit /b 1
    )
    echo.
)

REM --- 3. Niveau de logs ---
echo   --------------------------------------------
echo   Niveau de journalisation
echo   --------------------------------------------
echo   Par defaut, seules les erreurs et les avertissements
echo   sont affiches dans la console.
echo.
set /p VERBOSE="  Activer les logs detailles (debug) ? (o/N) : "
if /I "%VERBOSE%"=="o" (
    set LOG_LEVEL=debug
    echo   -^> Logs detailles actives.
) else (
    set LOG_LEVEL=warn
    echo   -^> Logs reduits (erreurs + avertissements uniquement^).
)
echo.

REM --- 4. Deploiement des commandes ---
echo   --------------------------------------------
echo   Deploiement des commandes /dashboard et /enquete
echo   --------------------------------------------
call npm run deploy
if errorlevel 1 (
    echo   [ERREUR] Echec du deploiement des commandes.
    pause
    exit /b 1
)
echo.

REM --- 5. Demarrage ---
echo   --------------------------------------------
echo   Demarrage du bot...
echo   --------------------------------------------
echo.
call npm start

echo.
echo   [INFO] Le bot s'est arrete.
pause
