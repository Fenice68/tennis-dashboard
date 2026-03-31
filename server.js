const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors'); 
const axios = require('axios');
const path = require('path');
const fs = require('fs'); // Aggiunto per permettere al server di leggere le cartelle
const http = require('http');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }));
app.use(express.json());

// --- 1. RICERCA AUTOMATICA DELLA CARTELLA ANGULAR ---
// Questo blocco di codice fa il lavoro "sporco" per te.
// Cerca in automatico la cartella corretta generata da Angular dentro "dist"
let distPath = path.join(__dirname, 'dist'); 

try {
    const baseDist = path.join(__dirname, 'dist');
    if (fs.existsSync(baseDist)) {
        // Trova la prima sottocartella dentro dist (es. 'progetto-tennis')
        const cartelle = fs.readdirSync(baseDist, { withFileTypes: true })
                           .filter(dirent => dirent.isDirectory())
                           .map(dirent => dirent.name);
        
        if (cartelle.length > 0) {
            const nomeProgetto = cartelle[0];
            // Angular 17+ spesso crea un'ulteriore cartella 'browser'
            const pathBrowser = path.join(baseDist, nomeProgetto, 'browser');
            if (fs.existsSync(pathBrowser)) {
                distPath = pathBrowser;
            } else {
                distPath = path.join(baseDist, nomeProgetto);
            }
        }
    }
} catch (err) {
    console.log("⚠️ Attenzione: Non sono riuscito a scansionare la cartella dist.");
}

// Diciamo a Express di usare la cartella trovata automaticamente
app.use(express.static(distPath));


// --- SQLITE DATABASE CONNECTION ---
const dbPath = path.join(__dirname, 'tennis_db.sqlite');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

const dbQuery = async (sql, params = []) => db.prepare(sql).all(...params);
const dbRun = async (sql, params = []) => {
    const result = db.prepare(sql).run(...params);
    return { id: result.lastInsertRowid, changes: result.changes };
};
const dbGet = async (sql, params = []) => db.prepare(sql).get(...params);

// --- INITIALIZE DATABASE STRUCTURE ---
function setupDB() {
    try {
        db.exec(`CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, lcn INTEGER UNIQUE, name TEXT NOT NULL, provider_type TEXT, is_tennis_active BOOLEAN DEFAULT 0)`);
        db.exec(`CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, ranking_live INTEGER, surface_win_rate DECIMAL(5,2), is_italian BOOLEAN DEFAULT 0)`);
        db.exec(`CREATE TABLE IF NOT EXISTS matches (
            id INTEGER PRIMARY KEY AUTOINCREMENT, player_it_id INTEGER, opponent_id INTEGER, channel_id INTEGER, 
            match_date TEXT NOT NULL, target_date TEXT, venue_city TEXT, temp INTEGER, humidity INTEGER, 
            wind INTEGER, weather_icon TEXT, tournament TEXT, match_round TEXT, surface TEXT, 
            market_odd DECIMAL(5,2), opening_odd DECIMAL(5,2), k_rate DECIMAL(5,3), home_rank INTEGER, away_rank INTEGER,
            home_score INTEGER, away_score INTEGER, status TEXT
        )`);
        try { db.exec(`ALTER TABLE matches ADD COLUMN home_score INTEGER`); } catch(e) {}
        try { db.exec(`ALTER TABLE matches ADD COLUMN away_score INTEGER`); } catch(e) {}
        try { db.exec(`ALTER TABLE matches ADD COLUMN status TEXT`); } catch(e) {}
        
        try { db.exec(`DELETE FROM matches WHERE id NOT IN (SELECT MIN(id) FROM matches GROUP BY player_it_id, opponent_id, match_date)`); } catch(e) {}
        
        db.exec(`CREATE TABLE IF NOT EXISTS bets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, match_date TEXT, azzurro TEXT, avversario TEXT, 
            selection TEXT, market_odd NUMERIC, probability NUMERIC, roi NUMERIC, 
            stake_euro NUMERIC, expected_profit NUMERIC, note TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        console.log("🎾 SQLITE: Database pronto e portatile.");
    } catch (e) {
        console.error("❌ ERRORE SETUP DB:", e.message);
    }
}
setupDB();

const TRACKED_PLAYERS = [
    "sinner", "musetti", "cobolli", "darderi", "arnaldi", "sonego", "berrettini", "fognini",
    "nardi", "bellucci", "passaro", "gigante", "zeppieri", "napolitano", "vavassori", "bolelli",
    "maestrelli", "pellegrino", "agamenone", "travaglia", "gaio", "cecchinato", "caruso",
    "paolini", "cocciaretto", "bronzetti", "errani", "trevisan", "stefanini", "brancaccio", 
    "pigato", "pedone", "rosatello"
];

async function getDynamicRank(teamId) {
    if (!teamId) return 150;
    try {
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}`);
        return res.data?.team?.ranking || 150;
    } catch (e) { return 150; }
}

// --- API ROUTES ---
app.get('/api/reset-db', async (req, res) => {
    try {
        await dbRun('DELETE FROM matches');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

async function performSync(targetDate) {
    console.log(`📡 Sincronizzazione: ${targetDate}`);
    try {
        await dbRun("DELETE FROM matches WHERE target_date = ?", [targetDate]);
        const response = await axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`);
        const apiMatches = response.data.events || [];
        let count = 0;

        for (const match of apiMatches) {
            const hName = match.homeTeam?.name;
            const aName = match.awayTeam?.name;
            if (!hName || !aName) continue;

            const isIta = TRACKED_PLAYERS.some(ita => hName.toLowerCase().includes(ita) || aName.toLowerCase().includes(ita));
            if (isIta) {
                const rH = await getDynamicRank(match.homeTeam.id);
                const rA = await getDynamicRank(match.awayTeam.id);
                
                await dbRun('INSERT OR IGNORE INTO players (name) VALUES (?)', [hName]);
                const p1 = await dbGet('SELECT id FROM players WHERE name = ?', [hName]);
                await dbRun('INSERT OR IGNORE INTO players (name) VALUES (?)', [aName]);
                const p2 = await dbGet('SELECT id FROM players WHERE name = ?', [aName]);
                
                const seed = parseInt(match.id) || 1000;
                const eloAzz = 2500 - (rH * 5);
                const eloOpp = 2500 - (rA * 5);
                let baseProb = 1 / (1 + Math.pow(10, (eloOpp - eloAzz) / 400));
                const probWin = Math.max(0.05, Math.min(0.95, baseProb + ((seed % 15 - 7)/100)));
                const edge = ((seed * 3) % 15 - 7) / 100; 

                let mOddAzz = (1 / (probWin - edge)).toFixed(2);
                let mOddOpp = (1 / (1.05 - (probWin - edge))).toFixed(2);
                let kRateReal = edge;

                const lcnNum = (seed % 70) + 1;
                await dbRun('INSERT OR IGNORE INTO channels (name, lcn) VALUES (?, ?)', [`Canale ${lcnNum}`, lcnNum]);
                const channel = await dbGet('SELECT id FROM channels WHERE lcn = ?', [lcnNum]);

                try {
                    const oddsRes = await axios.get(`https://api.sofascore.com/api/v1/event/${match.id}/odds/1/all`);
                    const market = oddsRes.data?.markets?.find(m => m.marketName === 'Full time' || m.marketId === 1);
                    if (market && market.choices) {
                        const hC = market.choices.find(c => c.name === "1");
                        const aC = market.choices.find(c => c.name === "2");
                        const parseFrac = (f) => {
                            if (!f || !f.includes('/')) return 0;
                            const p = f.split('/');
                            return (parseFloat(p[0]) / parseFloat(p[1])) + 1;
                        };
                        const realHome = parseFrac(hC?.fractionalValue);
                        const realAway = parseFrac(aC?.fractionalValue);
                        if (realHome > 1 && realAway > 1) {
                            mOddAzz = realHome.toFixed(2);
                            mOddOpp = realAway.toFixed(2);
                            const margin = (1 / realHome) + (1 / realAway) - 1;
                            kRateReal = Math.max(0.01, margin);
                        }
                    }
                } catch(e) {}

                let surfaceRaw = (match.tournament?.uniqueTournament?.groundType || match.groundType || "Hardcourt").toLowerCase();
                let surfaceInfo = '🎾 Cemento';
                if (surfaceRaw.includes('clay')) surfaceInfo = '🧱 Terra';
                else if (surfaceRaw.includes('grass')) surfaceInfo = '🌿 Erba';
                else if (surfaceRaw.includes('indoor') || surfaceRaw.includes('carpet')) surfaceInfo = '🏛️ Indoor';

                let city = match.venue?.city?.name || (match.tournament?.name ? match.tournament.name.split(',')[0].trim() : "Rome");
                let temp = 24, humidity = 40, wind = 15, weather_icon = '☀️';
                try {
                    const geoRes = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
                    if (geoRes.data?.results?.length > 0) {
                        const { latitude, longitude } = geoRes.data.results[0];
                        const weatherRes = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
                        if (weatherRes.data?.current) {
                            temp = Math.round(weatherRes.data.current.temperature_2m);
                            humidity = Math.round(weatherRes.data.current.relative_humidity_2m);
                            wind = Math.round(weatherRes.data.current.wind_speed_10m);
                            const code = weatherRes.data.current.weather_code;
                            if (code === 0) weather_icon = '☀️'; else if (code >= 1 && code <= 3) weather_icon = '⛅'; else if (code >= 51 && code <= 67) weather_icon = '🌧️'; else weather_icon = '☁️';
                        }
                    }
                } catch (we) {}

                const cName = match.tournament?.category?.name || '';
                const tName = match.tournament?.name || '';
                const tournament_name = (cName === tName ? tName : `${cName} - ${tName}`).replace(/^- |- $/g, '').trim();
                const match_round = match.roundInfo?.name || "";
                const matchDateIso = new Date(match.startTimestamp * 1000).toISOString();
                const homeScore = match.homeScore?.display || match.homeScore?.current || 0;
                const awayScore = match.awayScore?.display || match.awayScore?.current || 0;
                const matchStatus = match.status?.type || 'notstarted';
                
                await dbRun(`DELETE FROM matches WHERE player_it_id = ? AND opponent_id = ? AND match_date = ?`, [p1.id, p2.id, matchDateIso]);

                await dbRun(`
                    INSERT INTO matches (player_it_id, opponent_id, match_date, market_odd, opening_odd, channel_id, k_rate, home_rank, away_rank, target_date, venue_city, temp, humidity, wind, weather_icon, tournament, match_round, surface, home_score, away_score, status) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
                    [p1.id, p2.id, matchDateIso, mOddAzz, mOddOpp, channel.id, kRateReal.toFixed(3), rH, rA, targetDate, city, temp, humidity, wind, weather_icon, tournament_name, match_round, surfaceInfo, homeScore, awayScore, matchStatus]
                );
                count++;
            }
        }
        return { count };
    } catch (e) { return { error: e.message }; }
}

app.get('/api/matchs', async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT m.*, p1.name AS azzurro, p2.name AS avversario, c.lcn as lcn_channel
            FROM matches m 
            JOIN players p1 ON m.player_it_id = p1.id 
            JOIN players p2 ON m.opponent_id = p2.id 
            LEFT JOIN channels c ON m.channel_id = c.id 
            WHERE m.target_date = ? 
            ORDER BY m.match_date ASC`, [req.query.date]);
        
        res.json(rows.map(row => {
            const azz_prob = (((1 / parseFloat(row.market_odd)) + parseFloat(row.k_rate)) * 100).toFixed(1);
            return { ...row, azz_rank_val: row.home_rank, opp_rank_val: row.away_rank, azz_prob: azz_prob, azz_roi: ((parseFloat(row.market_odd) - 1) * 100).toFixed(0), opp_roi: ((parseFloat(row.opening_odd) - 1) * 100).toFixed(0) };
        }));
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/sync-odds', async (req, res) => {
    const result = await performSync(req.query.date);
    res.json(result.error ? { success: false, error: result.error } : { success: true, count: result.count });
});

app.get('/api/weekly-schedule', async (req, res) => {
    try {
        const promises = [];
        const today = new Date();
        for(let i=0; i<7; i++) {
            const d = new Date(today); d.setDate(d.getDate() + i);
            const targetDate = d.toISOString().split('T')[0];
            promises.push(axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`).then(r => ({ date: targetDate, events: r.data.events || [] })).catch(() => ({ date: targetDate, events: [] })));
        }
        const results = await Promise.all(promises);
        const schedule = [];
        for(const resObj of results) {
            for(const match of resObj.events) {
                const isIta = TRACKED_PLAYERS.some(ita => match.homeTeam?.name?.toLowerCase().includes(ita) || match.awayTeam?.name?.toLowerCase().includes(ita));
                if(isIta) {
                    schedule.push({ target_date: resObj.date, azzurro: match.homeTeam.name, avversario: match.awayTeam.name, lcn_channel: (parseInt(match.id) % 70) + 1, tournament: match.tournament?.name || '' });
                }
            }
        }
        res.json(schedule);
    } catch (e) { res.json([]); }
});

app.post('/api/save-bets', async (req, res) => {
    try {
        const bets = req.body.bets; const nota = req.body.note || "";
        for (const b of bets) {
            await dbRun(`INSERT INTO bets (match_date, azzurro, avversario, selection, market_odd, probability, roi, stake_euro, expected_profit, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [b.match_date, b.azzurro, b.avversario, b.selection, b.market_odd, b.probability, b.roi, b.stake_euro, b.expected_profit, nota]);
        }
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.get('/api/export-bets', async (req, res) => {
    try {
        const rows = await dbQuery('SELECT * FROM bets ORDER BY created_at DESC');
        if (!rows.length) return res.send("Nessuna scommessa salvata.");
        let csv = "\uFEFFID;Data Match;Giocatore 1;Giocatore 2;Selezione;Quota;Prob;ROI;Stake;Profitto;Nota;Data Salvataggio\n";
        rows.forEach(r => csv += `${r.id};${r.match_date};"${r.azzurro}";"${r.avversario}";"${r.selection}";${r.market_odd};${r.probability};${r.roi};${r.stake_euro};${r.expected_profit};"${r.note}";"${r.created_at}"\n`);
        res.header('Content-Type', 'text/csv; charset=utf-8'); res.attachment(`storico_tennis.csv`);
        res.send(csv);
    } catch (e) { res.status(500).send("Errore export"); }
});

app.get('/api/export-matches', async (req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT m.*, p1.name AS azzurro, p2.name AS avversario 
            FROM matches m 
            JOIN players p1 ON m.player_it_id = p1.id 
            JOIN players p2 ON m.opponent_id = p2.id 
            ORDER BY m.match_date DESC`);
        if (!rows.length) return res.send("Nessun match salvato.");
        let csv = "\uFEFFID;Data;Torneo;Round;Superficie;Giocatore 1;Score 1;Score 2;Giocatore 2;Quota;ROI;Meteo;Citta\n";
        rows.forEach(r => {
            const azz_roi = ((parseFloat(r.market_odd) - 1) * 100).toFixed(0);
            csv += `${r.id};${r.match_date};"${r.tournament}";"${r.match_round}";"${r.surface}";"${r.azzurro}";${r.home_score};${r.away_score};"${r.avversario}";${r.market_odd};+${azz_roi}%;"${r.weather_icon} ${r.temp}°";"${r.venue_city}"\n`;
        });
        res.header('Content-Type', 'text/csv; charset=utf-8'); res.attachment(`archivio_match_tennis.csv`);
        res.send(csv);
    } catch (e) { res.status(500).send("Errore export"); }
});

// --- 2. GESTIONE DELLA NAVIGAZIONE (FALLBACK) ---
// Gestisce l'errore Not Found: rimanda le richieste sconosciute ad Angular
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\n❌ ERRORE: La porta ${PORT} è già occupata!`);
        process.exit(1);
    } else {
        console.error('❌ ERRORE SERVER:', e.message);
    }
});

server.listen(PORT, () => {
    console.log(`\n##################################################`);
    console.log(`🎾 TENNIS PORTABLE V6.0: Attivo su porta ${PORT}`);
    console.log(`📂 Cartella frontend agganciata automaticamente: ${distPath}`);
    console.log(`##################################################\n`);
});