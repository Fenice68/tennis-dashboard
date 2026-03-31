@echo off
setlocal
title Tennis Analytics V6.0 - PORTABLE
echo ##################################################
echo #          TENNIS ANALYTICS V6.0 MASTER          #
echo #           PORTABLE MODE (ZERO-CONFIG)          #
echo ##################################################
echo.

:: Controlla se Node.js è installato
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERRORE] Node.js non trovato! 
    echo Per favore installa Node.js da https://nodejs.org/
    pause
    exit /b
)

:: Controlla se le librerie sono presenti
if not exist node_modules (
    echo [INFO] Librerie mancanti. Installazione in corso...
    call npm install
)

:: Avvia il browser dopo un breve ritardo
echo [OK] Avvio in corso...
timeout /t 3 /nobreak >nul
start http://localhost:5000

:: Avvia il server
node server.js

pause
