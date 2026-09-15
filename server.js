const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};

// --- Shared, server-authoritative platforms -------------------------------
let platforms = [
    { x: 0, y: 580, width: 800, height: 20, type: 'solid' }
];
let peakY = 0;  
const DIP = 600; 
const LOOKAHEAD = 800; 

class ServerPlayer {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.alive = true;
    }
}

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePlatforms(target) {
    if (platforms.length === 0) return;
    let highest = platforms.reduce((min, p) => p.y < min.y ? p : min, platforms[0]);
    let current = highest.y;

    while (current > target) {
        const gap = random(60, 130);
        current -= gap;

        const width = random(60, 180);
        const xap = random(0, 550);
        const x = random(Math.max(xap, 0), Math.min(xap, 800 - width));
        const ty = random(0, 11);
        let typ;
        if (ty >= 6 || xap * gap >= 50000 || gap >= 115 || xap >= 500) {
            typ = 'solid';
        } else if (ty >= 2) {
            typ = 'pass';
        } else {
            typ = 'boost';
        }

        platforms.push({ x, y: current, width, height: 15, type: typ });
    }
}

function cleanPlatforms() {
    const bottom = peakY + DIP;
    platforms = platforms.filter(p => p.y < bottom);
}

function getLeadY() {
    let leadY = null;
    for (let id in players) {
        if (players[id].alive !== false && (leadY === null || players[id].y < leadY)) {
            leadY = players[id].y;
        }
    }
    return leadY;
}
setInterval(() => {
    const leadY = getLeadY();
    if (leadY === null) return;

    peakY = Math.min(peakY, leadY);

    const beforeCount = platforms.length;
    generatePlatforms(leadY - LOOKAHEAD);
    const afterGenerate = platforms.length;
    cleanPlatforms();
    const afterClean = platforms.length;

    if (afterGenerate !== beforeCount || afterClean !== afterGenerate) {
        io.emit('platforms', platforms);
    }
}, 300);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    players[socket.id] = new ServerPlayer(100, 500, randomColor);
    socket.emit('currentPlayers', players);
    socket.emit('platforms', platforms); // sync the newcomer to the current shared layout
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            io.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    socket.on('playerDied', () => {
        if (players[socket.id] && players[socket.id].alive) {
            players[socket.id].alive = false;
            // Sender already marked itself dead locally, so only the others need telling.
            socket.broadcast.emit('playerDied', socket.id);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`localhost:${PORT}`));
//server.listen(PORT, () => console.log(`Running on port ${PORT}`)); 