const express = require('express');
const path = require('path');

const app = express();
const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, 'public');

app.use(express.static(publicDirectory));

app.get('/', (_req, res) => {
	res.sendFile(path.join(publicDirectory, 'index.html'));
});

app.get('/lobby', (_req, res) => {
	res.sendFile(path.join(publicDirectory, 'lobby.html'));
});

app.get('/poker-table', (_req, res) => {
	res.sendFile(path.join(publicDirectory, 'poker-table.html'));
});

app.listen(port, '0.0.0.0', () => {
	console.log(`Poker777 frontend listening on port ${port}`);
});

module.exports = app;
