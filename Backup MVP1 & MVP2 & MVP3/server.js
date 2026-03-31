const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); 
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  user: 'postgres', host: 'localhost', database: 'tennis_db', password: 'Vannoe', port: 5432,
});

// AGGIORNAMENTO STRUTTURA DB ALL'AVVIO
async function setupDB() {
    try {
        await pool.query(`ALTER TABLE matches ADD COLUMN IF NOT EXISTS target_date VARCHAR(20), ADD COLUMN IF NOT EXISTS venue_city VARCHAR(100), ADD COLUMN IF NOT EXISTS temp INT, ADD COLUMN IF NOT EXISTS humidity INT, ADD COLUMN IF NOT EXISTS wind INT, ADD COLUMN IF NOT EXISTS weather_icon VARCHAR(10), ADD COLUMN IF NOT EXISTS tournament VARCHAR(150), ADD COLUMN IF NOT EXISTS match_round VARCHAR(50), ADD COLUMN IF NOT EXISTS surface VARCHAR(50)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS bets (id SERIAL PRIMARY KEY, match_date VARCHAR(50), azzurro VARCHAR(100), avversario VARCHAR(100), selection VARCHAR(100), market_odd NUMERIC, probability NUMERIC, roi NUMERIC, stake_euro NUMERIC, expected_profit NUMERIC, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`ALTER TABLE bets ADD COLUMN IF NOT EXISTS note VARCHAR(500)`);
        console.log("🐘 DATABASE: Struttura allineata.");
    } catch (e) {
        console.error("❌ ERRORE SETUP DB:", e.message);
    }
}
setupDB();

// SOSFASCORE FREE API IMPLEMENTATION INSTEAD OF RAPIDAPI
const TRACKED_PLAYERS = [
    "sinner", "paolini", "musetti", "cobolli", "arnaldi", 
    "darderi", "berrettini", "sonego", "fognini", "errani"
];

async function getDynamicRank(teamId) {
    if (!teamId) return 150;
    try {
        const res = await axios.get(`https://api.sofascore.com/api/v1/team/${teamId}`);
        return res.data?.team?.ranking || 150;
    } catch (e) {
        return 150;
    }
}

app.get('/api/reset-db', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE matches RESTART IDENTITY');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

async function performSync(targetDate) {
    console.log(`📡 Sincronizzazione per l'etichetta: ${targetDate}`);
    try {
        // Eliminiamo solo i match che hanno la stessa etichetta testuale
        await pool.query("DELETE FROM matches WHERE target_date = $1", [targetDate]);
        
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
                
                const p1Id = (await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [hName])).rows[0].id;
                const p2Id = (await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [aName])).rows[0].id;
                
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
                const channelId = (await pool.query('INSERT INTO channels (name, lcn) VALUES ($1, $2) ON CONFLICT (lcn) DO UPDATE SET lcn=EXCLUDED.lcn RETURNING id', [`Canale ${lcnNum}`, lcnNum])).rows[0].id;

                // TENTATIVO DI ESTRAZIONE QUOTE REALI (Bookmaker)
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
                } catch(e) { /* ignore, use math formula */ }

                // Estrai Superficie
                let surfaceRaw = match.tournament?.uniqueTournament?.groundType || match.groundType || "Hardcourt";
                surfaceRaw = surfaceRaw.toLowerCase();
                let surfaceInfo = '🎾 Cemento';
                if (surfaceRaw.includes('clay')) surfaceInfo = '🧱 Terra';
                else if (surfaceRaw.includes('grass')) surfaceInfo = '🌿 Erba';
                else if (surfaceRaw.includes('indoor') || surfaceRaw.includes('carpet')) surfaceInfo = '🏛️ Indoor';

                // Trova città del torneo e chiama Open-Meteo API
                let city = "Rome";
                if (match.venue?.city?.name) {
                    city = match.venue.city.name;
                } else if (match.tournament?.name) {
                    city = match.tournament.name.split(',')[0].trim();
                }

                let temp = 24, humidity = 40, wind = 15, weather_icon = '☀️';
                try {
                    const geoRes = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
                    if (geoRes.data && geoRes.data.results && geoRes.data.results.length > 0) {
                        const { latitude, longitude } = geoRes.data.results[0];
                        const weatherRes = await axios.get(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code`);
                        if (weatherRes.data?.current) {
                            temp = Math.round(weatherRes.data.current.temperature_2m);
                            humidity = Math.round(weatherRes.data.current.relative_humidity_2m);
                            wind = Math.round(weatherRes.data.current.wind_speed_10m);
                            const code = weatherRes.data.current.weather_code;
                            
                            if (code === 0) weather_icon = '☀️';
                            else if (code >= 1 && code <= 3) weather_icon = '⛅';
                            else if (code >= 45 && code <= 48) weather_icon = '🌫️';
                            else if (code >= 51 && code <= 67) weather_icon = '🌧️';
                            else if (code >= 71 && code <= 77) weather_icon = '❄️';
                            else if (code >= 80 && code <= 82) weather_icon = '🌦️';
                            else if (code >= 95) weather_icon = '⛈️';
                            else weather_icon = '☁️';
                        }
                    }
                } catch (we) { console.error("Meteo fallito per", city); }

                const cName = match.tournament?.category?.name || '';
                const tName = match.tournament?.name || '';
                const tournament_name = (cName === tName ? tName : `${cName} - ${tName}`).replace(/^- |- $/g, '').trim();
                const match_round = match.roundInfo?.name || "";

                // Inseriamo IL TARGET_DATE COME ETICHETTA DI TESTO + METEO REAL TIME E TORNEO
                const matchDateIso = new Date(match.startTimestamp * 1000).toISOString();
                
                // Proviamo a vedere se esiste già
                const exist = await pool.query(`SELECT 1 FROM matches WHERE player_it_id=$1 AND opponent_id=$2 AND target_date=$3`, [p1Id, p2Id, targetDate]);
                if (exist.rows.length === 0) {
                    await pool.query(`
                        INSERT INTO matches (player_it_id, opponent_id, match_date, market_odd, opening_odd, channel_id, k_rate, home_rank, away_rank, target_date, venue_city, temp, humidity, wind, weather_icon, tournament, match_round, surface) 
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`, 
                        [p1Id, p2Id, matchDateIso, mOddAzz, mOddOpp, channelId, kRateReal.toFixed(3), rH, rA, targetDate, city, temp, humidity, wind, weather_icon, tournament_name, match_round, surfaceInfo]
                    );
                    count++;
                }
            }
        }
        console.log(`✅ Sync completato: ${count} match inseriti con etichetta ${targetDate}`);
        return { count };
    } catch (e) { 
        const errorMsg = e.response ? JSON.stringify(e.response.data) : e.message;
        console.error("ERRORE SYNC:", errorMsg);
        return { error: errorMsg }; 
    }
}

app.get('/api/matchs', async (req, res) => {
    try {
        // Cerchiamo i match usando solo ed esclusivamente l'etichetta testuale
        const result = await pool.query(`
            SELECT m.*, p1.name AS azzurro, p2.name AS avversario, c.lcn as lcn_channel
            FROM matches m 
            JOIN players p1 ON m.player_it_id = p1.id 
            JOIN players p2 ON m.opponent_id = p2.id 
            LEFT JOIN channels c ON m.channel_id = c.id 
            WHERE m.target_date = $1 
            ORDER BY m.match_date ASC`, [req.query.date]);
        
        res.json(result.rows.map(row => {
            const azz_prob = (((1 / parseFloat(row.market_odd)) + parseFloat(row.k_rate)) * 100).toFixed(1);
            return {
                ...row,
                azz_rank_val: row.home_rank,
                opp_rank_val: row.away_rank,
                azz_prob: azz_prob,
                azz_roi: ((parseFloat(row.market_odd) - 1) * 100).toFixed(0),
                opp_roi: ((parseFloat(row.opening_odd) - 1) * 100).toFixed(0),
                temp: row.temp || 24, 
                humidity: row.humidity || 40, 
                weather_icon: row.weather_icon || '☀️',
                wind: row.wind || 15,
                venue_city: row.venue_city || 'Città ignota',
                tournament: row.tournament || 'Torneo Sconosciuto',
                match_round: row.match_round || '',
                surface: row.surface || '🎾 Cemento'
            };
        }));
    } catch (e) { res.status(500).json([]); }
});

app.get('/api/sync-odds', async (req, res) => {
    const result = await performSync(req.query.date);
    if (result.error) {
        res.json({ success: false, error: result.error });
    } else {
        res.json({ success: true, count: result.count });
    }
});

app.get('/api/weekly-schedule', async (req, res) => {
    try {
        const promises = [];
        const today = new Date();
        
        for(let i=0; i<7; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dt = String(d.getDate()).padStart(2, '0');
            const targetDate = `${yyyy}-${mm}-${dt}`;
            
            const p = axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`)
                .then(r => ({ date: targetDate, events: r.data.events || [] }))
                .catch(e => ({ date: targetDate, events: [] }));
                
            promises.push(p);
        }
        
        const results = await Promise.all(promises);
        const schedule = [];
        
        for(const resObj of results) {
            for(const match of resObj.events) {
                const hNames = match.homeTeam?.name?.toLowerCase() || "";
                const aNames = match.awayTeam?.name?.toLowerCase() || "";
                if(!hNames || !aNames) continue;
                
                const isIta = TRACKED_PLAYERS.some(ita => hNames.includes(ita) || aNames.includes(ita));
                if(isIta) {
                    const seed = parseInt(match.id) || 1000;
                    const cName = match.tournament?.category?.name || '';
                    const tName = match.tournament?.name || '';
                    const fullTournament = cName === tName ? tName : `${cName} - ${tName}`;
                    
                    schedule.push({
                        target_date: resObj.date,
                        match_date: new Date(match.startTimestamp * 1000).toISOString(),
                        azzurro: match.homeTeam.name,
                        avversario: match.awayTeam.name,
                        lcn_channel: (seed % 70) + 1,
                        tournament: fullTournament.trim().replace(/^- |- $/g, '')
                    });
                }
            }
        }
        res.json(schedule);
    } catch (e) {
        console.error("Weekly sync error:", e.message);
        res.json([]); 
    }
});

app.post('/api/save-bets', async (req, res) => {
    try {
        const bets = req.body.bets;
        const nota = req.body.note || "";
        if (!bets || !bets.length) return res.json({ success: false });
        
        for (const b of bets) {
            await pool.query(`
                INSERT INTO bets (match_date, azzurro, avversario, selection, market_odd, probability, roi, stake_euro, expected_profit, note)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [b.match_date, b.azzurro, b.avversario, b.selection, b.market_odd, b.probability, b.roi, b.stake_euro, b.expected_profit, nota]
            );
        }
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/export-bets', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM bets ORDER BY created_at DESC');
        if (result.rows.length === 0) return res.send("Nessuna scommessa salvata nello storico.");
        
        // Uso BOM per Excel e Punto e Virgola (;) per colmare le impostazioni regionali italiane
        let csv = "\uFEFFID;Data Match;Giocatore 1 (Casa);Giocatore 2 (Ospite);Selezione (Puntata);Quota Media;Probabilita (%);ROI (%);Stake Consigliato (Euro);Profitto Atteso (Euro);Nota Storica;Data Salvataggio\n";
        result.rows.forEach(r => {
            const dateFmt = r.created_at.toISOString().replace('T', ' ').substring(0, 19);
            const rNote = r.note ? r.note.replace(/"/g, '""') : "";
            csv += `${r.id};${r.match_date};"${r.azzurro}";"${r.avversario}";"${r.selection}";${r.market_odd};${r.probability};${r.roi};${r.stake_euro};${r.expected_profit};"${rNote}";"${dateFmt}"\n`;
        });
        
        const todayStr = new Date().toISOString().split('T')[0];
        res.header('Content-Type', 'text/csv; charset=utf-8');
        res.attachment(`storico_scommesse_tennis_${todayStr}.csv`);
        return res.send(csv);
    } catch (e) {
        res.status(500).send("Errore export CSV");
    }
});



const PORT = 5000;
const server = app.listen(PORT, () => {
    console.log('🎾 TENNIS MASTER V6.0: Server attivo sulla porta 5000');
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error('❌ PORTA 5000 OCCUPATA: Il server è probabilmente già attivo in un altra finestra.');
    } else {
        console.error('❌ ERRORE SERVER: ' + e.message);
    }
});
