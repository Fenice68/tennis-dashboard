const axios = require('axios');

const TRACKED_PLAYERS = [
    "sinner", "paolini", "musetti", "cobolli", "arnaldi", 
    "darderi", "berrettini", "sonego", "fognini", "errani"
];

async function testParallelSync() {
    console.time("7-days-sync");
    const promises = [];
    const today = new Date();
    
    for(let i=1; i<=7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() + i);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dt = String(d.getDate()).padStart(2, '0');
        const targetDate = `${yyyy}-${mm}-${dt}`;
        
        const p = axios.get(`https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${targetDate}`)
            .then(res => ({ date: targetDate, events: res.data.events || [] }))
            .catch(e => ({ date: targetDate, events: [] }));
            
        promises.push(p);
    }
    
    const results = await Promise.all(promises);
    const schedule = [];
    
    for(const res of results) {
        for(const match of res.events) {
            const hNames = match.homeTeam?.name?.toLowerCase() || "";
            const aNames = match.awayTeam?.name?.toLowerCase() || "";
            if(!hNames && !aNames) continue;
            
            const isIta = TRACKED_PLAYERS.some(ita => hNames.includes(ita) || aNames.includes(ita));
            if(isIta) {
                const seed = parseInt(match.id) || 1000;
                schedule.push({
                    target_date: res.date,
                    match_date: new Date(match.startTimestamp * 1000).toISOString(),
                    azzurro: match.homeTeam.name,
                    avversario: match.awayTeam.name,
                    lcn_channel: (seed % 70) + 1,
                    tournament: `${match.tournament?.category?.name || ''} - ${match.tournament?.name || ''}`
                });
            }
        }
    }
    console.timeEnd("7-days-sync");
    console.log("Future Schedule:", JSON.stringify(schedule, null, 2));
}

testParallelSync();
