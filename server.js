const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const ROUND_START_DELAY = 30000;
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

function createRoom() {
    return {
        state: 'waiting',
        players: {},
        platforms: [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }],
        peakY: 0,
        cea: null,
        countdownTimer: null,
    };
}

const rooms = {
    'server-1': createRoom(),
    'server-2': createRoom(),
    'server-3': createRoom(),
};

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePlatforms(platforms, target) {
    if (platforms.length === 0) return;
    var highest = platforms.reduce((min, p) => p.y < min.y ? p : min, platforms[0]);
    var current = highest.y;

    while (current > target) {
        const gap = random(60, 130);
        current -= gap;

        const width = random(60, 180);
        const xap = random(0, 550);
        const x = random(Math.max(xap, 0), Math.min(xap, 800 - width));
        const ty = random(0, 11);
        var typ;
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

function cleanPlatforms(room) {
    const bottom = room.peakY + DIP;
    room.platforms = room.platforms.filter(p => p.y < bottom);
}

function getLeadY(players) {
    var leadY = null;
    for (var id in players) {
        if (players[id].alive !== false && (leadY === null || players[id].y < leadY)) {
            leadY = players[id].y;
        }
    }
    return leadY;
}

function checkWinner(room) {
    return null;
}

function startCountdown(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    clearTimeout(room.countdownTimer);
    room.state = 'waiting';
    room.cea = Date.now() + ROUND_START_DELAY;

    io.to(roomName).emit('rstate', { state: room.state, cea: room.cea });

    room.countdownTimer = setTimeout(() => {
        room.state = 'active';
        io.to(roomName).emit('rstate', { state: room.state, cea: null });
    }, ROUND_START_DELAY);
}

function resetRoom(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
    room.peakY = 0;

    for (const id in room.players) {
        room.players[id].x = 100;
        room.players[id].y = 500;
        room.players[id].alive = true;
    }

    io.to(roomName).emit('currentPlayers', room.players);
    io.to(roomName).emit('platforms', room.platforms);
    startCountdown(roomName);
}

function checkRoundEnd(roomName) {
    const room = rooms[roomName];
    if (!room || room.state !== 'active') return;

    const ids = Object.keys(room.players);
    if (ids.length === 0) return;

    const allDead = ids.every(id => room.players[id].alive === false);
    const winnerId = checkWinner(room);

    if (allDead || winnerId) {
        io.to(roomName).emit('roundEnded', { winnerId: winnerId || null });
        resetRoom(roomName);
    }
}

function checkEmptyRoom(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    if (Object.keys(room.players).length === 0) {
        clearTimeout(room.countdownTimer);
        room.state = 'waiting';
        room.cea = null;
        room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
        room.peakY = 0;
    }
}

function joinRoom(socket, roomName) {
    const room = rooms[roomName];
    if (!room) return;

    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const color = 'rgb(' + r + ', ' + g + ', ' + b + ')';
    room.players[socket.id] = new ServerPlayer(100, 500, color);

    socket.join(roomName);
    socket.data.room = roomName;

    if (Object.keys(room.players).length === 1 && !room.cea) {
        startCountdown(roomName);
    }

    socket.emit('currentPlayers', room.players);
    socket.emit('platforms', room.platforms);
    socket.emit('rstate', { state: room.state, cea: room.cea });
    socket.to(roomName).emit('newPlayer', { id: socket.id, player: room.players[socket.id] });
}

function leaveRoom(socket) {
    const roomName = socket.data.room;
    if (!roomName || !rooms[roomName]) return;

    delete rooms[roomName].players[socket.id];
    socket.leave(roomName);
    io.to(roomName).emit('playerDisconnected', socket.id);
    checkEmptyRoom(roomName);
    socket.data.room = null;
}
setInterval(() => {
    for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.state !== 'active') continue;

        const leadY = getLeadY(room.players);
        if (leadY === null) continue;

        room.peakY = Math.min(room.peakY, leadY);

        const before = room.platforms.length;
        generatePlatforms(room.platforms, leadY - LOOKAHEAD);
        const afterGenerate = room.platforms.length;
        cleanPlatforms(room);
        const afterClean = room.platforms.length;

        if (afterGenerate !== before || afterClean !== afterGenerate) {
            io.to(roomName).emit('platforms', room.platforms);
        }

        checkRoundEnd(roomName);
    }
}, 300);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('joinRoom', (roomName) => joinRoom(socket, roomName));

    socket.on('switchRoom', (newRoomName) => {
        leaveRoom(socket);
        joinRoom(socket, newRoomName);
    });

    socket.on('playerMovement', (movementData) => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room && room.players[socket.id]) {
            room.players[socket.id].x = movementData.x;
            room.players[socket.id].y = movementData.y;
            io.to(roomName).emit('playerMoved', { id: socket.id, x: movementData.x, y: movementData.y });
        }
    });

    socket.on('playerDied', () => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room && room.players[socket.id] && room.players[socket.id].alive) {
            room.players[socket.id].alive = false;
            socket.to(roomName).emit('playerDied', socket.id);
            checkRoundEnd(roomName);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        leaveRoom(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`localhost:${PORT}`));
//server.listen(PORT, () => console.log(`Running on port ${PORT}`)); 