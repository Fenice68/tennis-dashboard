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

const RAPID_API_KEY = '6a395ed07amshc2355067933b0d3p1eeeeejsn7b9f7e70ffce';
const RAPID_API_HOST = 'sportscore1.p.rapidapi.com';

// --- L'ANAGRAFICA SUPREMA (Dati aggiornati 2026) ---
const BLINDATO_RANK = {
    "sinner": 1, "paolini": 4, "musetti": 15, "cobolli": 26, "arnaldi": 32,
    "darderi": 38, "berrettini": 40, "sonego": 50, "fognini": 75, "errani": 82,
    "vavassori": 1, "bolelli": 1
};

// Normalizza il nome (toglie spazi, minuscolo, toglie accenti)
function normalize(name) {
    if (!name) return "";
    return name.toLowerCase().replace(/[^a-z]/g, '');
}

function getForcedRank(name, apiRank) {
    const n = normalize(name);
    for (let key in BLINDATO_RANK) {
        if (n.includes(key)) return BLINDATO_RANK[key];
    }
    const r = parseInt(apiRank);
    return (r > 0 && r < 400) ? r : 78;
}

app.get('/api/reset-db', async (req, res) => {
    try {
        await pool.query('TRUNCATE TABLE matches RESTART IDENTITY');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

async function performSync(targetDate) {
    try {
        await pool.query('DELETE FROM matches WHERE match_date::date = $1', [targetDate]);
        const response = await axios.get(`https://${RAPID_API_HOST}/sports/2/events/date/${targetDate}`, {
            headers: { 'x-rapidapi-key': RAPID_API_KEY, 'x-rapidapi-host': RAPID_API_HOST }
        });
        const apiMatches = response.data.data || [];
        let count = 0;

        for (const match of apiMatches) {
            const hName = match.home_team?.name;
            const aName = match.away_team?.name;
            if (!hName || !aName) continue;

            // Controllo se c'è un italiano
            const names = [normalize(hName), normalize(aName)];
            const hasIta = Object.keys(BLINDATO_RANK).some(ita => names[0].includes(ita) || names[1].includes(ita));

            if (hasIta) {
                const rAzz = getForcedRank(hName, match.home_team.ranking);
                const rOpp = getForcedRank(aName, match.away_team.ranking);
                
                const p1Id = (await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [hName])).rows[0].id;
                const p2Id = (await pool.query('INSERT INTO players (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id', [aName])).rows[0].id;
                
                const seed = parseInt(match.id) || 1000;
                const eloAzz = 2500 - (rAzz * 5);
                const eloOpp = 2500 - (rOpp * 5);
                let baseProb = 1 / (1 + Math.pow(10, (eloOpp - eloAzz) / 400));
                const probWin = Math.max(0.05, Math.min(0.95, baseProb + ((seed % 15 - 7)/100)));
                const edge = ((seed * 3) % 15 - 7) / 100; 
                
                const mOddAzz = (1 / (probWin - edge)).toFixed(2);
                const mOddOpp = (1 / (1.05 - (probWin - edge))).toFixed(2);
                const lcn = hName.toLowerCase().includes("sinner") ? 64 : (seed % 69) + 1;
                const channelId = (await pool.query('INSERT INTO channels (name, lcn) VALUES ($1, $2) ON CONFLICT (lcn) DO UPDATE SET lcn=EXCLUDED.lcn RETURNING id', [`Canale ${lcn}`, lcn])).rows[0].id;

                await pool.query(`INSERT INTO matches (player_it_id, opponent_id, match_date, market_odd, opening_odd, channel_id, k_rate, home_rank, away_rank) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, 
                [p1Id, p2Id, match.start_at, mOddAzz, mOddOpp, channelId, edge.toFixed(3), rAzz, rOpp]);
                count++;
            }
        }
        return count;
    } catch (e) { return 0; }
}

app.get('/api/matchs', async (req, res) => {
    const result = await pool.query(`
        SELECT m.*, p1.name AS azzurro, p2.name AS avversario, c.lcn as lcn_channel
        FROM matches m 
        JOIN players p1 ON m.player_it_id = p1.id 
        JOIN players p2 ON m.opponent_id = p2.id 
        LEFT JOIN channels c ON m.channel_id = c.id 
        WHERE m.match_date::date = $1 ORDER BY m.match_date ASC`, [req.query.date]);
    
    res.json(result.rows.map(row => ({
        ...row,
        azz_rank_val: getForcedRank(row.azzurro, row.home_rank),
        opp_rank_val: getForcedRank(row.avversario, row.away_rank),
        temp: 22, humidity: 45, weather_icon: '☀️'
    })));
});

app.get('/api/sync-odds', async (req, res) => {
    const count = await performSync(req.query.date);
    res.json({ success: true, count });
});

app.get('/api/weekly-schedule', async (req, res) => {
    const result = await pool.query(`SELECT m.match_date, p1.name as azzurro, p2.name as avversario, c.lcn as lcn_channel FROM matches m JOIN players p1 ON m.player_it_id = p1.id JOIN players p2 ON m.opponent_id = p2.id JOIN channels c ON m.channel_id = c.id WHERE m.match_date::date >= CURRENT_DATE ORDER BY m.match_date ASC`);
    res.json(result.rows);
});

app.listen(5000, () => console.log('🛡️ MASTER V30.0: RANKING E PROB BLINDATI'));