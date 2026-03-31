const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'tennis_db', 
  password: 'Vannoe', // <--- Inserisci la tua password di pgAdmin
  port: 5432,
});

app.get('/api/matchs', async (req, res) => {
  console.log("Richiesta ricevuta: lettura database in corso...");
  try {
    const result = await pool.query(`
      SELECT m.id, m.match_date, m.market_odd, m.result, 
             p1.name AS azzurro, p2.name AS avversario, 
             c.name AS tv, c.lcn
      FROM matches m
      JOIN players p1 ON m.player_it_id = p1.id
      JOIN players p2 ON m.opponent_id = p2.id
      JOIN channels c ON m.channel_id = c.id
      ORDER BY m.match_date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Errore Query:", err.message);
    res.status(500).json({ error: "Errore nel caricamento dei match" });
  }
});

app.listen(5000, () => {
  console.log("==========================================");
  console.log("SERVER TENNIS ONLINE - PORTA 5000");
  console.log("==========================================");
});