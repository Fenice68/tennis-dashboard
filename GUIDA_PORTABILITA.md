# 🚀 Guida Portabilità: Tennis Analytics V6.0 (Zero-Config)

Grazie al passaggio a **SQLite**, il progetto è ora 100% portatile. Non serve più installare o configurare database esterni!

## 1. Prerequisiti
Sul nuovo PC devi installare solo:
1. **Node.js:** Scarica la versione "LTS" dal sito ufficiale [nodejs.org](https://nodejs.org/).

## 2. Come Trasferire il Progetto
1. Copia l'intera cartella del progetto su una chiavetta USB o tramite cloud.
2. **Suggerimento:** Non serve copiare la cartella `node_modules` (verrà ricreata in automatico al primo avvio). Tutto lo storico è salvato nel file `tennis_db.sqlite`.

## 3. Avvio con un Click
Sul nuovo PC, entra nella cartella e fai doppio clic sul file:
👉 **`AVVIA_TENNIS.bat`**

### Cosa farà lo script al primo avvio?
1. Verificherà la presenza di Node.js.
2. Installerà automaticamente le librerie mancanti.
3. Aprirà il browser all'indirizzo corretto.
4. Avvierà il server e il database locale.

---
💡 **Tutto pronto:** Il sistema è ora indipendente, veloce e non richiede configurazioni manuali. Buon lavoro!

## 4. Registro Aggiornamenti (V6.1 - Mobile & Rete)
- **Responsive Design Aggiornato:** Riprogettata l'interfaccia di `index.html` per l'uso fluido da smartphone. I riquadri del cruscotto ora si incolonnano elegantemente sotto i 1024px, senza tagliare le statistiche.
- **Integrazione "La Fenice":** Corretto il bug del routing lato Server (Express 5) per permettere il transito nativo di foto e logo (`3 Fenice Logo.jpg`) senza esporre il DB.
- **Accesso Ibrido (Zero Data-Loss):** Introdotto `AVVIA_WIFI_E_INTERNET.bat` per usare il Command Center contemporaneamente su WiFi (IP) e su Rete Globale (Tunnel) aggirando il problema del reset automatico dei dischi nei cloud gratuiti.
