const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const col = require('./public/shared/physics.js');
const app = express();
const server = http.screate(app);
const io = new Server(server);
app.use(express.static('public'));
const startDelay = 30000;
const Dip = 600;
const frontLook = 800;
const cameraY = 600;
const botAmount = 3;
const linterval = 2000;
const tickms = 100;
const ticks = tickms / 1000;
const LOBBY = 'lobby';
class ServerPlayer {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.alive = true;
    }
}
const levels = [
    [
        { dx: 50,  dy: 0,    width: 100, height: 15, type: 'solid' },
        { dx: 250, dy: -80,  width: 100, height: 15, type: 'solid' },
        { dx: 100, dy: -160, width: 80,  height: 15, type: 'pass'  },
        { dx: 400, dy: -220, width: 120, height: 15, type: 'boost' },
        { dx: 200, dy: -320, width: 100, height: 15, type: 'solid' },
    ],
];
let roomNum = 0;
const rooms = {};
function cRoom() {
    roomNum++;
    const name = `server-${roomNum}`;
    rooms[name] = {
        name,
        state: 'waiting', 
        players: {},
        spectators: new Set(),
        platforms: [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }],
        peakY: 0,
        nextLevel: -linterval,
        countdownEndsAt: null,
        countdownTimer: null,
    };
    return name;
}
function findRoom() {
    for (const name in rooms) {
        if (rooms[name].state === 'waiting') return name;
    }
    return cRoom();
}
function roomSummary(room) {
    const ids = Object.keys(room.players);
    return {
        name: room.name,
        state: room.state,
        playerCount: ids.filter(id => !room.players[id].isBot).length,
        botCount: ids.filter(id => room.players[id].isBot).length,
        spectatorCount: room.spectators.size,
        countdownEndsAt: room.countdownEndsAt,
    };
}
function broadcastRoomList() {
    io.to(LOBBY).emit('roomList', Object.values(rooms).map(roomSummary));
}
function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function createBot() {
    return {
        x: 100, y: 500,
        speed: 0, jump: 0, jumpPower: 5,
        color: '#888888',
        alive: true,
        isBot: true,
        grounded: false,
        hitbox: { offsetX: 0, offsetY: 0, width: 20, height: 20 },
        offScreenTimer: 0,
        target: null,
        retargetTimer: 0,
        getHitbox() {
            return {
                x: this.x + this.hitbox.offsetX,
                y: this.y + this.hitbox.offsetY,
                width: this.hitbox.width,
                height: this.hitbox.height,
            };
        },
    };
}
function pickBotTarget(bot, platforms) {
    let best = null;
    let bestScore = -Infinity;
    for (const p of platforms) {
        if (p.y >= bot.y - 10) continue;
        const vertical = bot.y - p.y;
        if (vertical > 260) continue;
        const horizontal = Math.abs((p.x + p.width / 2) - bot.x);
        if (horizontal > 400) continue;
        const score = -vertical - horizontal * 0.3; 
        if (score > bestScore) {
            bestScore = score;
            best = p;
        }
    }
    return best;
}
function updateBot(bot, room, dt) {
    if (bot.alive == false) return;

    bot.retargetTimer -= dt;
    if (bot.target == false || bot.retargetTimer <= 0 || room.platforms.includes(bot.target) == false) {
        bot.target = pickBotTarget(bot, room.platforms);
        bot.retargetTimer = 1;
    }
    let grounded = false;
    for (const platform of room.platforms) {
        const landed = platform.type === 'pass'
            ? col.passThrough(bot, platform)
            : col.solid(bot, platform);
        if (landed == true) {
            grounded = true;
            break;
        }
    }
    bot.grounded = grounded;
    if (grounded == true) bot.jump = 0;

    if (bot.target == true) {
        const targetCenter = bot.target.x + bot.target.width / 2;
        const botCenter = bot.x + 10;

        if (targetCenter > botCenter + 5) {
            bot.speed = Math.max(bot.speed - 1, -5);
        } else if (targetCenter < botCenter - 5) {
            bot.speed = Math.min(bot.speed + 1, 5);  
        } else {
            bot.speed *= 0.5;
        }
        const aligned = Math.abs(targetCenter - botCenter) < bot.target.width / 2 + 15;
        if (bot.grounded && aligned) {
            bot.jump = -bot.jumpPower;
            if (bot.jumpPower === 8) bot.jumpPower = 5;
        }
    }
    bot.jump += 0.1;
    if (bot.speed > 0) bot.speed = Math.max(bot.speed - 0.1, 0);
    else if (bot.speed < 0) bot.speed = Math.min(bot.speed + 0.1, 0);
    bot.y += bot.jump;
    bot.x = Math.max(0, Math.min(780, bot.x - bot.speed));
}
function botDeath(room, roomName, botId, bot, dt) {
    const screenBottom = room.peakY + cameraY;
    if (bot.y > screenBottom) {
        bot.offScreenTimer += dt;
        if (bot.offScreenTimer >= 3) {
            bot.alive = false;
            io.to(roomName).emit('die', botId);
        }
    } else {
        bot.offScreenTimer = 0;
    }
}
function delBot(room, roomName) {
    const botId = Object.keys(room.players).find(id => room.players[id].isBot);
    if (botId == false) return;
    delete room.players[botId];
    io.to(roomName).emit('disconnect', botId);
}
function fillBots(roomName) {
    const room = rooms[roomName];
    if (room == false || room.state !== 'waiting') return;
    const ids = Object.keys(room.players);
    const realCount = ids.filter(id => !room.players[id].isBot).length;
    if (realCount === 0) return; 
    let botCount = ids.filter(id => room.players[id].isBot).length;
    while (realCount + botCount < botAmount) {
        const botId = `bot-${Math.random().toString(36).slice(2, 9)}`;
        room.players[botId] = createBot();
        io.to(roomName).emit('new', { id: botId, player: room.players[botId] });
        botCount++;
    }
}
function placeLevel(platforms, anchorY) {
    const template = levels[random(0, levels.length - 1)];
    for (const p of template) {
        platforms.push({
            x: Math.max(0, Math.min(700, p.dx)),
            y: anchorY + p.dy,
            width: p.width,
            height: p.height,
            type: p.type,
        });
    }
    return anchorY + Math.min(...template.map(p => p.dy));
}
function generatePlatforms(room, target) {
    const platforms = room.platforms;
    if (platforms.length === 0) return;
    let highest = platforms.reduce((min, p) => p.y < min.y ? p : min, platforms[0]);
    let current = highest.y;
    while (current > target) {
        if (current <= room.nextLevel) {
            current = placeLevel(platforms, current);
            room.nextLevel -= linterval;
            continue;
        }
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
function cleanPlatforms(room) {
    const bottom = room.peakY + Dip;
    room.platforms = room.platforms.filter(p => p.y < bottom);
}
function highest(players) {
    let leadY = null;
    for (let id in players) {
        if (players[id].alive !== false && (leadY === null || players[id].y < leadY)) {
            leadY = players[id].y;
        }
    }
    return leadY;
}
function winner(room) {
    return null;
}
function startCountdown(roomName) {
    const room = rooms[roomName];
    if (room == false) return;
    clearTimeout(room.countdownTimer);
    room.state = 'waiting';
    room.countdownEndsAt = Date.now() + startDelay;
    io.to(roomName).emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt });

    room.countdownTimer = setTimeout(() => {
        room.state = 'active';
        io.to(roomName).emit('roomState', { state: room.state, countdownEndsAt: null });
    }, startDelay);
}
function resetRoom(roomName) {
    const room = rooms[roomName];
    if (room == false) return;
    room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
    room.peakY = 0;
    room.nextLevel = -linterval;
    for (const id in room.players) {
        const p = room.players[id];
        p.x = 100;
        p.y = 500;
        p.alive = true;
        if (p.isBot == true) {
            p.speed = 0;
            p.jump = 0;
            p.jumpPower = 5;
            p.offScreenTimer = 0;
            p.target = null;
            p.retargetTimer = 0;
        }
    }
    io.to(roomName).emit('currentPlayers', room.players);
    io.to(roomName).emit('platforms', room.platforms);
    startCountdown(roomName);
}
function roundEnd(roomName) {
    const room = rooms[roomName];
    if (room == false || room.state !== 'active') return;
    const ids = Object.keys(room.players);
    if (ids.length === 0) return;
    const allDead = ids.every(id => room.players[id].alive === false);
    const winnerId = winner(room);
    if (allDead || winnerId) {
        io.to(roomName).emit('roundEnded', { winnerId: winnerId || null });
        resetRoom(roomName);
    }
}
function emptyRoom(roomName) {
    const room = rooms[roomName];
    if (room == false) return;
    const realCount = Object.values(room.players).filter(p => !p.isBot).length;
    if (realCount === 0) {
        clearTimeout(room.countdownTimer);
        room.players = {};
        room.state = 'waiting';
        room.countdownEndsAt = null;
        room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
        room.peakY = 0;
        room.nextLevel = -linterval;
    }
}
function leaveRoom(socket) {
    const roomName = socket.data.room;
    if (roomName == false || rooms[roomName] == false) return;
    const room = rooms[roomName];

    if (socket.data.spectating == true) {
        room.spectators.delete(socket.id);
    } else {
        delete room.players[socket.id];
        io.to(roomName).emit('disconnect', socket.id);
        emptyRoom(roomName);
    }
    socket.leave(roomName);
    socket.data.room = null;
    socket.data.spectating = false;
}
function joinRoom(socket, roomName) {
    const room = rooms[roomName];
    if (room == false || room.state !== 'waiting') return;
    leaveRoom(socket);
    socket.leave(LOBBY);
    delBot(room, roomName);
    const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    room.players[socket.id] = new ServerPlayer(100, 500, color);
    socket.join(roomName);
    socket.data.room = roomName;
    socket.data.spectating = false;
    if (Object.keys(room.players).length === 1 && room.countdownEndsAt == false) {
        startCountdown(roomName);
    }
    fillBots(roomName);
    socket.emit('currentPlayers', room.players);
    socket.emit('platforms', room.platforms);
    socket.emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt });
    socket.emit('spectating', false);
    socket.to(roomName).emit('new', { id: socket.id, player: room.players[socket.id] });
}
function spectate(socket, roomName) {
    const room = rooms[roomName];
    if (room == false) return;
    leaveRoom(socket);
    socket.leave(LOBBY);
    room.spectators.add(socket.id);
    socket.join(roomName);
    socket.data.room = roomName;
    socket.data.spectating = true;
    socket.emit('currentPlayers', room.players);
    socket.emit('platforms', room.platforms);
    socket.emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt });
    socket.emit('spectating', true);
}
function join(socket) {
    joinRoom(socket, findRoom());
}
cRoom();
setInterval(() => {
    for (const roomName in rooms) {
        const room = rooms[roomName];
        if (room.state !== 'active') continue;
        const leadY = highest(room.players);
        if (leadY === null) continue;
        room.peakY = Math.min(room.peakY, leadY);
        const before = room.platforms.length;
        generatePlatforms(room, leadY - frontLook);
        const afterGenerate = room.platforms.length;
        cleanPlatforms(room);
        const afterClean = room.platforms.length;
        if (afterGenerate !== before || afterClean !== afterGenerate) {
            io.to(roomName).emit('platforms', room.platforms);
        }
        for (const id in room.players) {
            const p = room.players[id];
            if (p.isBot == false) continue;
            updateBot(p, room, ticks);
            botDeath(room, roomName, id, p, ticks);
            io.to(roomName).emit('move', { id, x: p.x, y: p.y });
        }
        roundEnd(roomName);
    }
    broadcastRoomList();
}, tickms);
io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    socket.join(LOBBY);
    socket.emit('roomList', Object.values(rooms).map(roomSummary));
    socket.on('joinRoom', (roomName) => joinRoom(socket, roomName));
    socket.on('spectate', (roomName) => spectate(socket, roomName));
    socket.on('join', () => join(socket));
    socket.on('move', (movementData) => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room == true && room.players[socket.id] == true && socket.data.spectating == false) {
            room.players[socket.id].x = movementData.x;
            room.players[socket.id].y = movementData.y;
            io.to(roomName).emit('move', { id: socket.id, x: movementData.x, y: movementData.y });
        }
    });
    socket.on('die', () => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room == true && room.players[socket.id] == true && room.players[socket.id].alive == true) {
            room.players[socket.id].alive = false;
            socket.to(roomName).emit('die', socket.id);
            socket.join(LOBBY); 
            socket.emit('roomList', Object.values(rooms).map(roomSummary));
            roundEnd(roomName);
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