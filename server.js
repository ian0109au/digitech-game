const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const startdelay = 30000;
const dip = 600;
const lookahead = 800;
const blacksky = -51000;
const perlevel = 2;

const levels = [
    [
        { x: 0, y: 0, width: 800, height: 15, type: 'pass' },
        { x: 0, y: -90, width: 800, height: 15, type: 'pass' },
        { x: 0, y: -180, width: 800, height: 15, type: 'pass' },
        { x: 0, y: -270, width: 800, height: 15, type: 'pass' },
    ],
    [
        { x: 100, y: 260, width: 700, height: 10, type: 'solid' },
        { x: 0, y: 0, width: 700, height: 200, type: 'solid' },
        { x: 700, y: 0, width: 40, height: 200, type: 'solid' },
        { x: 600, y: 50, width: 40, height: 200, type: 'solid' },
        { x: 500, y: 0, width: 40, height: 200, type: 'solid' },
        { x: 400, y: 50, width: 40, height: 200, type: 'solid' },
        { x: 300, y: 0, width: 40, height: 200, type: 'solid' },
        { x: 200, y: 50, width: 40, height: 200, type: 'solid' }
    ]
];

class guy {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.alive = true;
    }
}

function createroom() {
    const room = {
        state: 'waiting',
        players: {},
        platforms: [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }],
        peakY: 0,
        cea: null,
        countdownTimer: null,
        normalCount: 0,
        nextLevelY: null,
        winLevelY: null,
        goalSpawned: false,
    };
    preparound(room);
    return room;
}

const rooms = {
    'server-1': createroom(),
    'server-2': createroom(),
    'server-3': createroom(),
};

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function preparound(room) {
    room.normalCount = 0;
    room.nextLevelY = -random(350, 600);
    room.winLevelY = -random(20000, Math.abs(blacksky));
    room.goalSpawned = false;
}

function addlevel(room, levelY) {
    const level = levels[random(0, levels.length - 1)];
    const levelPlatforms = level.map((platform) => ({
        x: platform.x,
        y: levelY + platform.y,
        width: platform.width,
        height: platform.height,
        type: platform.type,
    }));

    room.platforms = room.platforms.filter((platform) => {
        if (platform.level) return true;

        return !levelPlatforms.some((levelPlatform) =>
            platform.x < levelPlatform.x + levelPlatform.width &&
            platform.x + platform.width > levelPlatform.x &&
            platform.y < levelPlatform.y + levelPlatform.height &&
            platform.y + platform.height > levelPlatform.y
        );
    });

    var top = levelY;
    for (const platform of levelPlatforms) {
        room.platforms.push({
            x: platform.x,
            y: platform.y,
            width: platform.width,
            height: platform.height,
            type: platform.type,
            level: true,
            goal: levelY === room.winLevelY,
        });
        top = Math.min(top, platform.y);
    }
    return top;
}

function genplats(room, target) {
    const platforms = room.platforms;
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
        room.normalCount++;

        if (!room.goalSpawned && current <= room.winLevelY + 150) {
            current = addlevel(room, room.winLevelY);
            room.goalSpawned = true;
        } else if (room.normalCount % perlevel === 0 && current <= room.nextLevelY) {
            current = addlevel(room, current - random(40, 90));
            room.nextLevelY = current - random(900, 1500);
        }
    }
}

function cleanplats(room) {
    const bottom = room.peakY + dip;
    room.platforms = room.platforms.filter(p => p.y < bottom);
}

function leady(players) {
    var leadY = null;
    for (var id in players) {
        if (players[id].alive !== false && (leadY === null || players[id].y < leadY)) {
            leadY = players[id].y;
        }
    }
    return leadY;
}

function checkwin(room) {
    if (room.winLevelY === null) return null;
    for (const id in room.players) {
        const player = room.players[id];
        if (player.alive !== false && player.y <= room.winLevelY + 20) {
            return id;
        }
    }
    return null;
}

function startcount(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    clearTimeout(room.countdownTimer);
    room.state = 'waiting';
    room.cea = Date.now() + startdelay;

    io.to(roomName).emit('rstate', { state: room.state, cea: room.cea });

    room.countdownTimer = setTimeout(() => {
        room.state = 'active';
        io.to(roomName).emit('rstate', { state: room.state, cea: null });
    }, startdelay);
}

function resetroom(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
    room.peakY = 0;
    preparound(room);

    for (const id in room.players) {
        room.players[id].x = 100;
        room.players[id].y = 500;
        room.players[id].alive = true;
    }

    io.to(roomName).emit('existers', room.players);
    io.to(roomName).emit('platforms', room.platforms);
    startcount(roomName);
}

function checkround(roomName) {
    const room = rooms[roomName];
    if (!room || room.state !== 'active') return;

    const ids = Object.keys(room.players);
    if (ids.length === 0) return;

    const allDead = ids.every(id => room.players[id].alive === false);
    const winnerId = checkwin(room);

    if (allDead || winnerId) {
        io.to(roomName).emit('roundEnded', { winnerId: winnerId || null });
        resetroom(roomName);
    }
}

function emptyroom(roomName) {
    const room = rooms[roomName];
    if (!room) return;
    if (Object.keys(room.players).length === 0) {
        clearTimeout(room.countdownTimer);
        room.state = 'waiting';
        room.cea = null;
        room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
        room.peakY = 0;
        preparound(room);
    }
}

function joinroom(socket, roomName) {
    const room = rooms[roomName];
    if (!room) return;

    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const color = 'rgb(' + r + ', ' + g + ', ' + b + ')';
    room.players[socket.id] = new guy(100, 500, color);

    socket.join(roomName);
    socket.data.room = roomName;

    if (Object.keys(room.players).length === 1 && !room.cea) {
        startcount(roomName);
    }

    socket.emit('existers', room.players);
    socket.emit('platforms', room.platforms);
    socket.emit('rstate', { state: room.state, cea: room.cea });
    socket.to(roomName).emit('newguy', { id: socket.id, player: room.players[socket.id] });
}

function leaveroom(socket) {
    const roomName = socket.data.room;
    if (!roomName || !rooms[roomName]) return;

    delete rooms[roomName].players[socket.id];
    socket.leave(roomName);
    io.to(roomName).emit('guyleft', socket.id);
    emptyroom(roomName);
    socket.data.room = null;
}
setInterval(() => {
    for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.state !== 'active') continue;

        const leadY = leady(room.players);
        if (leadY === null) continue;

        room.peakY = Math.min(room.peakY, leadY);

        const before = room.platforms.length;
        genplats(room, leadY - lookahead);
        const afterGenerate = room.platforms.length;
        cleanplats(room);
        const afterClean = room.platforms.length;

        if (afterGenerate !== before || afterClean !== afterGenerate) {
            io.to(roomName).emit('platforms', room.platforms);
        }

        checkround(roomName);
    }
}, 300);

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('joinRoom', (roomName) => joinroom(socket, roomName));

    socket.on('switchRoom', (newRoomName) => {
        leaveroom(socket);
        joinroom(socket, newRoomName);
    });

    socket.on('leaveRoom', () => {
        leaveroom(socket);
    });

    socket.on('guymove', (movementData) => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room && room.players[socket.id]) {
            room.players[socket.id].x = movementData.x;
            room.players[socket.id].y = movementData.y;
            io.to(roomName).emit('guymoved', { id: socket.id, x: movementData.x, y: movementData.y });
        }
    });

    socket.on('guydied', () => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room && room.players[socket.id] && room.players[socket.id].alive) {
            room.players[socket.id].alive = false;
            socket.to(roomName).emit('guydied', socket.id);
            checkround(roomName);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        leaveroom(socket);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`localhost:${PORT}`));
//server.listen(PORT, () => console.log(`Running on port ${PORT}`)); 