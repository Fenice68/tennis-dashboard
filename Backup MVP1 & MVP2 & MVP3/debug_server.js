const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.listen(5001, () => console.log('DEBUG SERVER RUNNING ON 5001'));
