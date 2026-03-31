const axios = require('axios');

const TRACKED_PLAYERS = [
    "sinner", "musetti", "cobolli", "darderi", "arnaldi", "sonego", "berrettini", "fognini",
    "nardi", "bellucci", "passaro", "gigante", "zeppieri", "napolitano", "vavassori", "bolelli",
    "maestrelli", "pellegrino", "agamenone", "travaglia", "gaio", "cecchinato", "caruso",
    "paolini", "cocciaretto", "bronzetti", "errani", "trevisan", "stefanini", "brancaccio", 
    "pigato", "pedone", "rosatello"
];

async function testWeekly() {
    const today = new Date();
    for(let i=0; i<7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const targetDate = d.toISOString().split('T')[0];
        try {
            const res = await axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`);
            const events = res.data.events || [];
            
            const ita = events.filter(m => {
                const h = m.homeTeam?.name?.toLowerCase() || "";
                const a = m.awayTeam?.name?.toLowerCase() || "";
                return TRACKED_PLAYERS.some(p => h.includes(p) || a.includes(p));
            });
            console.log(`Date: ${targetDate} - Events: ${events.length} - ITA: ${ita.length}`);
            ita.forEach(m => console.log(`  -> ${m.homeTeam.name} vs ${m.awayTeam.name}`));
        } catch (e) {
            console.log(`Date: ${targetDate} - FAILED`);
        }
    }
}

testWeekly();
