const axios = require('axios');

async function test() {
    try {
        const dateStr = new Date().toISOString().split('T')[0];
        const res = await axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${dateStr}`);
        const event = res.data.events[0];
        if (!event) return console.log("No events");
        
        console.log("Found Event ID:", event.id, event.homeTeam.name, "vs", event.awayTeam.name);
        
        let ground = "Hardcourt";
        if (event.tournament?.uniqueTournament?.groundType) {
            ground = event.tournament.uniqueTournament.groundType;
        }
        console.log("GroundType:", ground);
        
        const odds = await axios.get(`https://api.sofascore.com/api/v1/event/${event.id}/odds/1/all`);
        const market = odds.data.markets.find(m => m.marketName === 'Full time');
        if (market) {
            const h = market.choices.find(c => c.name === "1");
            const a = market.choices.find(c => c.name === "2");
            
            const parseFrac = (f) => {
                const parts = f.split('/');
                return (parseFloat(parts[0]) / parseFloat(parts[1])) + 1;
            };
            
            console.log("Odd 1 (Home):", parseFrac(h.fractionalValue).toFixed(2));
            console.log("Odd 2 (Away):", parseFrac(a.fractionalValue).toFixed(2));
        } else {
            console.log("No Full Time market found");
        }
    } catch(e) {
        console.error("Failed:", e.message);
    }
}
test();
