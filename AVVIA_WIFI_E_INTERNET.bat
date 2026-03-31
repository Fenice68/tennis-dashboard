@echo off
setlocal
color 0e
title Tennis Command Center - WIFI e TUNNEL
echo ========================================================
echo        TENNIS COMMAND CENTER - SERVER CONDIVISO
echo ========================================================
echo.

:: Controlla pacchetti Node
if not exist node_modules (
    echo Installazione moduli Node.js in corso...
    call npm install
)

echo [1] Avvio del Database e del Server (Porta 5000)...
start "Tennis Server (Lasciami Aperto!)" cmd /k "node server.js"

timeout /t 3 /nobreak >nul

echo.
echo ========================================================
echo  📡 ACCESSO DA CASA (CONNESSIONE WIFI)
echo ========================================================
echo Prendi il tuo telefono connesso allo stesso WiFi del PC,
echo apri Chrome/Safari e digita UN INDIRIZZO IP della lista 
echo qui sotto seguito da :5000 (Esempio: http://192.168.1.55:5000)
echo.
ipconfig | findstr /i "IPv4"
echo.
echo.
echo ========================================================
echo  🌍 ACCESSO DA FUORI CASA (RETE 4G/5G)
echo ========================================================
echo Generazione in corso di un link diretto (Zero-Click)
echo ========================================================
echo Cerca piu' in basso la riga simile a:
echo "http://qualcosa.tunnelmole.net"
echo
echo Copia quell'indirizzo e invialo ai tuoi amici! 
echo Il link si aprira' in modo INVISIBILE E ISTANTANEO,
echo senza bloccargli l'accesso o chiedergli strani IP!
echo --------------------------------------------------------

call npx -y tunnelmole 5000

pause
