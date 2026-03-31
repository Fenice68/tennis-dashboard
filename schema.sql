-- SCHEMA COMPLETO TENNIS ANALYTICS V6.0 (Cyber-Tennis)

-- 1. Tabella Canali
CREATE TABLE IF NOT EXISTS channels (
    id SERIAL PRIMARY KEY,
    lcn INT UNIQUE,
    name VARCHAR(100) NOT NULL,
    provider_type VARCHAR(50),
    is_tennis_active BOOLEAN DEFAULT FALSE
);

-- 2. Tabella Atleti e Ranking
CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    ranking_live INT,
    surface_win_rate DECIMAL(5,2),
    is_italian BOOLEAN DEFAULT FALSE
);

-- 3. Tabella Match e Proiezioni (V6.0)
CREATE TABLE IF NOT EXISTS matches (
    id SERIAL PRIMARY KEY,
    player_it_id INT REFERENCES players(id),
    opponent_id INT REFERENCES players(id),
    channel_id INT REFERENCES channels(id),
    match_date VARCHAR(50) NOT NULL,
    target_date VARCHAR(20),       -- Etichetta per il filtro temporale
    venue_city VARCHAR(100),
    temp INT,
    humidity INT,
    wind INT,
    weather_icon VARCHAR(10),
    tournament VARCHAR(150),
    match_round VARCHAR(50),
    surface VARCHAR(50),
    market_odd DECIMAL(5,2),       -- Quota reale
    opening_odd DECIMAL(5,2),      -- Quota avversario
    k_rate DECIMAL(5,3),           -- Kelly Rate (Vantaggio)
    home_rank INT,
    away_rank INT
);

-- 4. Tabella Storico Scommesse (V6.0 con Note)
CREATE TABLE IF NOT EXISTS bets (
    id SERIAL PRIMARY KEY,
    match_date VARCHAR(50),
    azzurro VARCHAR(100),
    avversario VARCHAR(100),
    selection VARCHAR(100),
    market_odd NUMERIC,
    probability NUMERIC,
    roi NUMERIC,
    stake_euro NUMERIC,
    expected_profit NUMERIC,
    note VARCHAR(500),             -- Nota Storica per memoria futura
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);