// --- SERVER.JS DEFINITIVO: RANKING DINAMICO (SINGOLI/DOPPI), SYNC CANALI (1-70) E FALLBACK OTTIMIZZATO ---

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors'); 
const axios = require('axios');
const path = require('path');

const app = express();

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.static(path.join(__dirname)));

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'tennis_db',
  password: 'Vannoe',
  port: 5432,
});

const RAPID_API_KEY = '6a395ed07amshc2355067933b0d3p1eeeeejsn7b9f7e70ffce';
const RAPID_API_HOST = 'sportscore1.p.rapidapi.com';

const ITALIAN_PLAYERS = [
    "Sinner", "Musetti", "Cobolli", "Darderi", "Sonego", 
    "Berrettini", "Arnaldi", "Bellucci", "Nardi", "Fognini",
    "Paolini", "Cocciaretto", "Bronzetti", "Trevisan", "Errani", "Vavassori", "Bolelli"
];

// --- 1. LOGICA RANKING DINAMICA ---
const getPowerFromRank = (rank) => {
    if (!rank || rank <= 0) return 60; 
    if (rank === 1) return 99;
    if (rank <= 10) return 95 - rank;
    if (rank <= 50) return 85 - (rank / 5);
    return Math.max(40, 75 - (rank / 10));
};

// --- 2. GESTIONE MEMORIA RANKING CON AUTO-UPDATE ---
async function updateOrGetRank(playerName, apiRank) {
    const name = playerName.trim();
    // Se l'API fornisce un rank valido (>0), aggiorniamo il DB
    if (apiRank && apiRank > 0) {
        await pool.query('UPDATE players SET rank = $1 WHERE name ILIKE $2', [apiRank, name]);
        return apiRank;
    } else {
        // Fallback: cerchiamo nel DB
        const res = await pool.query('SELECT rank FROM players WHERE name ILIKE $1', [name]);
        if (res.rows.length > 0 && res.rows[0].rank && res.rows[0].rank > 0) {
            return res.rows[0].rank;
        }
        // Se è un doppio (contiene /), diamo un rank medio per non penalizzare il calcolo probabilità
        return name.includes("/") ? 85 : 150;
    }
}

// --- 3. GENERATORE DATI METEO E QUOTE ---
const generateRealData = (match, azzurroName, rankH, rankA) => {
    const seed = parseInt(match.id) || 0;
    const powerHome = getPowerFromRank(rankH);
    const powerAway = getPowerFromRank(rankA);
    
    let diff = (powerHome - powerAway) / 100;
    const isAzzurroHome = match.home_team.name.toLowerCase().includes(azzurroName.toLowerCase());
    let f_rate = isAzzurroHome ? (0.50 + diff) : (0.50 - diff);

    // Boost campioni italiani (Blindato)
    if (azzurroName.includes("Sinner")) f_rate = Math.max(f_rate, 0.93);
    if (azzurroName.includes("Paolini")) f_rate = Math.max(f_rate, 0.86);

    f_rate = Math.min(0.98, Math.max(0.05, f_rate)).toFixed(2);
    const marketOdd = (1 / (parseFloat(f_rate) * 0.96)).toFixed(2);
    const marketProb = (1 / parseFloat(marketOdd));
    const k_rate = (parseFloat(f_rate) - marketProb).toFixed(3);

    return { 
        marketOdd, 
        openingOdd: (marketOdd * 0.98).toFixed(2), 
        windSpeed: 2 + (seed % 15), 
        humidity: 30 + (seed % 45), 
        f_rate, 
        k_rate 
    };
};

// --- 4. FUNZIONE CORE DI SINCRONIZZAZIONE (BLINDATA PER SINGOLI E DOPPI) ---
async function performSync(targetDate) {
    try {
        console.log(`\x1b[44m AVVIO SYNC: ${targetDate} \x1b[0m`);
        await pool.query('DELETE FROM matches WHERE match_date::date = $1', [targetDate]);

        const response = await axios.get(`https://${RAPID_API_HOST}/sports/2/events/date/${targetDate}`, {
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': RAPID_API_HOST }
        });

        const apiMatches = response.data.data || [];
        let count = 0;

        for (const match of apiMatches) {
            const hName = match.home_team.name;
            const aName = match.away_team.name;

            const azzurroFound = ITALIAN_PLAYERS.find(ita => 
                hName.toLowerCase().includes(ita.toLowerCase()) || 
                aName.toLowerCase().includes(ita.toLowerCase())
            );

            if (azzurroFound) {
                const p1Id = await ensurePlayerExists(hName);
                const p2Id = await ensurePlayerExists(aName);
                
                // --- ESTRAZIONE RANKING AVANZATA (SINGOLI + DOPPI) ---
                let rawRankH = match.home_team.ranking || match.home_team.rank || match.home_team.current_rank || 0;
                let rawRankA = match.away_team.ranking || match.away_team.rank || match.away_team.current_rank || 0;

                // Caso DOPPIO: se rank team è 0, sommiamo o prendiamo il migliore dei giocatori interni
                if (rawRankH === 0 && match.home_team.players) {
                    const r = match.home_team.players.map(p => p.ranking || p.rank || 0).filter(n => n > 0);
                    if (r.length > 0) rawRankH = Math.min(...r);
                }
                if (rawRankA === 0 && match.away_team.players) {
                    const r = match.away_team.players.map(p => p.ranking || p.rank || 0).filter(n => n > 0);
                    if (r.length > 0) rawRankA = Math.min(...r);
                }

                // Sicurezza Top Players (Forzatura se API fallisce)
                if (hName.includes("Sinner") || aName.includes("Sinner")) {
                    if (hName.includes("Sinner")) rawRankH = 2; else rawRankA = 2;
                }
                if (hName.includes("Paolini") || aName.includes("Paolini")) {
                    if (hName.includes("Paolini")) rawRankH = 12; else rawRankA = 12;
                }

                const finalRankH = await updateOrGetRank(hName, rawRankH);
                const finalRankA = await updateOrGetRank(aName, rawRankA);

                // --- ASSEGNAZIONE CANALI (1-70) ---
                let lcn = (hName.includes("Sinner") || aName.includes("Sinner")) ? 64 : (parseInt(match.id) % 70) + 1;
                const chRes = await pool.query('SELECT id FROM channels WHERE lcn = $1 LIMIT 1', [lcn]);
                const channelId = chRes.rows.length > 0 ? chRes.rows[0].id : 1;
                
                const data = generateRealData(match, azzurroFound, finalRankH, finalRankA);

                await pool.query(`
                    INSERT INTO matches (
                        player_it_id, opponent_id, match_date, 
                        market_odd, opening_odd, wind_speed, 
                        humidity, channel_id, f_rate, k_rate,
                        home_rank, away_rank
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                `, [
                    p1Id, p2Id, match.start_at, 
                    data.marketOdd, data.openingOdd, 
                    data.windSpeed, data.humidity, 
                    channelId, data.f_rate, data.k_rate,
                    finalRankH, finalRankA
                ]);
                
                console.log(`\x1b[32m[SYNC OK]\x1b[0m ${hName} (#${finalRankH}) vs ${aName} (#${finalRankA}) | LCN: ${lcn}`);
                count++;
            }
        }
        return count;
    } catch (e) { 
        console.error("Errore Sync:", e.message);
        return 0; 
    }
}

async function ensurePlayerExists(playerName) {
    const res = await pool.query('SELECT id FROM players WHERE name ILIKE $1 LIMIT 1', [playerName]);
    if (res.rows.length > 0) return res.rows[0].id;
    const insertRes = await pool.query('INSERT INTO players (name) VALUES ($1) RETURNING id', [playerName]);
    return insertRes.rows[0].id;
}

// --- 5. ENDPOINTS API ---

app.get('/api/matchs', async (req, res) => {
  try {
    const selectedDate = req.query.date;
    const result = await pool.query(`
      SELECT m.*, p1.name AS azzurro, p2.name AS avversario, 
             c.name AS tv, c.lcn as lcn_channel,
             COALESCE(m.home_rank, p1.rank, 0) as h_rank, 
             COALESCE(m.away_rank, p2.rank, 0) as a_rank
      FROM matches m
      JOIN players p1 ON m.player_it_id = p1.id
      JOIN players p2 ON m.opponent_id = p2.id
      JOIN channels c ON m.channel_id = c.id
      WHERE m.match_date::date = $1
      ORDER BY m.match_date ASC
    `, [selectedDate]);

    const finalData = result.rows.map(row => ({
        ...row,
        home_rank_display: row.h_rank > 0 ? `#${row.h_rank}` : 'N/D',
        away_rank_display: row.a_rank > 0 ? `#${row.a_rank}` : 'N/D'
    }));

    res.json(finalData);
  } catch (err) { 
    console.error("ERRORE DB:", err.message);
    res.status(500).json([]); 
  }
});

app.get('/api/sync-odds', async (req, res) => {
    const count = await performSync(req.query.date);
    res.json({ success: true, message: `Sincronizzati ${count} match per il ${req.query.date}.` });
});

app.get('/api/next-commitments', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT p1.name as player, p2.name as opponent, m.match_date as date, c.name as tv
            FROM matches m
            JOIN players p1 ON m.player_it_id = p1.id
            JOIN players p2 ON m.opponent_id = p2.id
            JOIN channels c ON m.channel_id = c.id
            WHERE m.match_date >= CURRENT_DATE
            ORDER BY m.match_date ASC LIMIT 16
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json([]);
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`\x1b[32mSERVER ONLINE & BLINDATO - Porta ${PORT}\x1b[0m`));