-- FILE: C:\Drive y\Siti Web\Progetto statistiche Tennis\sviluppo\schema.sql

-- 1. Tabella Infrastruttura 70 Canali DTT + Premium (Protocollo 5.1, sez 2.3)
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    lcn INT,                       -- Posizione telecomando (1-70 per DTT)
    name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50),      -- DTT, Satellite, OTT (Sky, DAZN)
    is_tennis_active BOOLEAN DEFAULT FALSE -- Filtro sportivo
);

-- 2. Tabella Atleti e KPI Tecnici (Protocollo 5.1, sez 3.3)
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    ranking_live INT,
    surface_win_rate DECIMAL(5,2),  -- Peso 30% nel calcolo probabilità
    first_serve_pct DECIMAL(5,2),   -- KPI per Gap Analysis
    ace_per_set DECIMAL(5,2),       -- KPI per Gap Analysis
    tie_break_win_rate DECIMAL(5,2),-- KPI per Gap Analysis
    is_italian BOOLEAN DEFAULT FALSE
);

-- 3. Tabella Match e Variabili (Protocollo 5.1, sez 2.3)
CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    player_it_id INT REFERENCES players(id),
    opponent_id INT REFERENCES players(id),
    channel_id INT REFERENCES channels(id),
    match_date DATE NOT NULL,       -- Sincronizzazione per data selezionata
    surface_type VARCHAR(50),       -- Terra, Cemento, Erba
    temp DECIMAL(4,1),              -- Parametro Meteo
    market_odd DECIMAL(5,2),        -- Quota Bookmaker (es. 1.85)
    is_live BOOLEAN DEFAULT FALSE
);

-- DATI DI TEST (SEED)
INSERT INTO channels (lcn, name, provider_type, is_tennis_active) VALUES 
(64, 'SuperTennis', 'DTT', TRUE), (201, 'Sky Sport Tennis', 'Satellite', TRUE);

INSERT INTO players (name, ranking_live, surface_win_rate, is_italian) VALUES 
('Jannik Sinner', 1, 85.50, TRUE), ('Carlos Alcaraz', 3, 82.00, FALSE);

INSERT INTO matches (player_it_id, opponent_id, channel_id, match_date, surface_type, market_odd, is_live) VALUES 
(1, 2, 2, '2026-03-26', 'Hard', 1.90, TRUE);