const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const col = require('./public/shared/physics.js')
const app = express()
const server = http.createServer(app)
const io = new Server(server)
app.use(express.static('public'))
const startDelay = 30000
const Dip = 600
const look = 800
const cameraY = 600
const levelGap = 2000
const tick = 100
const ticks = tick / 1000
const LOBBY = 'lobby'
const surviveRate = 1
const leaderRate = 2
const killReward = 50
const winReward = 500
const winGoalY = -5000
class ServerPlayer {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.alive = true;
        this.money = 0;
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
    [
        { dx: 600, dy: 0,    width: 90,  height: 15, type: 'solid' },
        { dx: 400, dy: -90,  width: 90,  height: 15, type: 'pass'  },
        { dx: 550, dy: -180, width: 70,  height: 15, type: 'boost' },
        { dx: 300, dy: -260, width: 110, height: 15, type: 'solid' },
        { dx: 500, dy: -340, width: 90,  height: 15, type: 'pass'  },
        { dx: 350, dy: -420, width: 100, height: 15, type: 'solid' },
    ],
];
var roomNo = 0
const rooms = {}
function cRoom() {
    roomNo++
    const name = `server-${roomNo}`
    rooms[name] = {
        name,
        state: 'waiting',
        players: {},
        spectators: new Set(),
        platforms: [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }],
        peakY: 0,
        nextLevel: -levelGap,
        countdownEndsAt: false,
        countdownTimer: false,
        winnerId: false,
    }
    return name
}
function findRoom() {
    for (const name in rooms) {
        if (rooms[name].state === 'waiting') return name
    }
    return cRoom()
}
function roomSummary(room) {
    const ids = Object.keys(room.players)
    return {
        name: room.name,
        state: room.state,
        playerCount: ids.length,
        spectatorCount: room.spectators.size,
        countdownEndsAt: room.countdownEndsAt,
    }
}
function broadcastRoomList() {
    io.to(LOBBY).emit('roomList', Object.values(rooms).map(roomSummary))
}
function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}
function killPlayer(room, roomName, id) {
    const player = room.players[id]
    if (player == false || player.alive === false) return
    const before = leader(room.players)
    player.alive = false
    io.to(roomName).emit('die', id)
    if (before != false && before.id !== id) {
        const killer = room.players[before.id]
        if (killer != false) {
            killer.money += killReward
        }
    }
    roundEnd(roomName)
}
function placeLevel(platforms, anchorY) {
    const template = levels[random(0, levels.length - 1)]
    for (const p of template) {
        platforms.push({
            x: Math.max(0, Math.min(700, p.dx)),
            y: anchorY + p.dy,
            width: p.width,
            height: p.height,
            type: p.type,
        })
    }
    return anchorY + Math.min(...template.map(p => p.dy))
}
function generatePlatforms(room, target) {
    const platforms = room.platforms
    if (platforms.length === 0) return
    var highest = platforms.reduce((min, p) => p.y < min.y ? p : min, platforms[0])
    var current = highest.y
    while (current > target) {
        if (current <= room.nextLevel) {
            current = placeLevel(platforms, current)
            room.nextLevel -= levelGap
            continue
        }
        const gap = random(60, 105)
        current -= gap
        const width = random(60, 180)
        const xap = random(0, 550)
        const x = random(Math.max(xap, 0), Math.min(xap, 800 - width))
        const ty = random(0, 11)
        var typ
        if (ty >= 7) {
            typ = 'solid'
        } else if (ty >= 2) {
            typ = 'pass'
        } else {
            typ = 'boost'
        }
        platforms.push({ x, y: current, width, height: 15, type: typ })
    }
}
function cleanPlatforms(room) {
    const bottom = room.peakY + Dip
    room.platforms = room.platforms.filter(p => p.y < bottom)
}
function leader(players) {
    var leadId = false
    var leadY = false
    for (var id in players) {
        if (players[id].alive !== false && (leadY === false || players[id].y < leadY)) {
            leadY = players[id].y
            leadId = id
        }
    }
    return leadId == false ? false : { id: leadId, y: leadY }
}

function boostPlayer(room, id) {
    const player = room.players[id]
    if (player == false) return
    player.money += 2
}

function winner(room) {
    return room.winnerId
}
function startCountdown(roomName) {
    const room = rooms[roomName]
    if (room == false) return
    clearTimeout(room.countdownTimer)
    room.state = 'waiting'
    room.countdownEndsAt = Date.now() + startDelay
    io.to(roomName).emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt })

    room.countdownTimer = setTimeout(() => {
        room.state = 'active'
        io.to(roomName).emit('roomState', { state: room.state, countdownEndsAt: false })
    }, startDelay)
}
function resetRoom(roomName) {
    const room = rooms[roomName]
    if (room == false) return
    room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }]
    room.peakY = 0
    room.nextLevel = -levelGap
    room.winnerId = false
    for (const id in room.players) {
        const p = room.players[id]
        p.x = 100
        p.y = 500
        p.alive = true
    }
    io.to(roomName).emit('currentPlayers', room.players)
    io.to(roomName).emit('platforms', room.platforms)
    startCountdown(roomName)
}
function roundEnd(roomName) {
    const room = rooms[roomName]
    if (room == false || room.state !== 'active') return
    const ids = Object.keys(room.players)
    if (ids.length === 0) return
    const allDead = ids.every(id => room.players[id].alive === false)
    const winnerId = winner(room)
    if (allDead || winnerId) {
        io.to(roomName).emit('roundEnded', { winnerId: winnerId || false })
        resetRoom(roomName)
    }
}
function emptyRoom(roomName) {
    const room = rooms[roomName]
    if (room == false) return
    const realCount = Object.values(room.players).length
    if (realCount === 0) {
        clearTimeout(room.countdownTimer)
        room.players = {}
        room.state = 'waiting'
        room.countdownEndsAt = false
        room.platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }]
        room.peakY = 0
        room.nextLevel = -levelGap
        room.winnerId = false
    }
}
function leaveRoom(socket) {
    const roomName = socket.data.room
    if (roomName == false || rooms[roomName] == false) return
    const room = rooms[roomName]

    if (socket.data.spectating == true) {
        room.spectators.delete(socket.id)
    } else {
        delete room.players[socket.id]
        io.to(roomName).emit('disconnect', socket.id)
        emptyRoom(roomName)
    }
    socket.leave(roomName)
    socket.data.room = false
    socket.data.spectating = false
}
function joinRoom(socket, roomName) {
    const room = rooms[roomName]
    if (room == false || room.state !== 'waiting') return
    leaveRoom(socket)
    socket.leave(LOBBY)
    const color = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
    room.players[socket.id] = new ServerPlayer(100, 500, color)
    socket.join(roomName)
    socket.data.room = roomName
    socket.data.spectating = false
    if (Object.keys(room.players).length === 1 && room.countdownEndsAt == false) {
        startCountdown(roomName)
    }
    socket.emit('currentPlayers', room.players)
    socket.emit('platforms', room.platforms)
    socket.emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt })
    socket.emit('spectating', false)
    socket.to(roomName).emit('new', { id: socket.id, player: room.players[socket.id] })
}
function spectate(socket, roomName) {
    const room = rooms[roomName]
    if (room == false) return
    leaveRoom(socket)
    socket.leave(LOBBY)
    room.spectators.add(socket.id)
    socket.join(roomName)
    socket.data.room = roomName
    socket.data.spectating = true
    socket.emit('currentPlayers', room.players)
    socket.emit('platforms', room.platforms)
    socket.emit('roomState', { state: room.state, countdownEndsAt: room.countdownEndsAt })
    socket.emit('spectating', true)
}
function join(socket) {
    joinRoom(socket, findRoom())
}
function sendMoves(name, room) {
    for (const id in room.players) {
        const p = room.players[id]
        io.to(name).emit('move', { id, x: p.x, y: p.y })
    }
}
function payPlayers(name, room, lead) {
    const changes = {}
    for (const id in room.players) {
        const p = room.players[id]
        if (p.alive === false) continue
        p.money += surviveRate * ticks
        if (id === lead.id) p.money += leaderRate * ticks
        if (room.winnerId == false && p.y <= winGoalY) {
            room.winnerId = id
            p.money += winReward
        }
        changes[id] = Math.floor(p.money)
    }
    if (Object.keys(changes).length > 0) io.to(name).emit('money', changes)
}
cRoom()
setInterval(() => {
    for (const roomName in rooms) {
        const room = rooms[roomName]
        if (room.state !== 'active') continue
        const lead = leader(room.players)
        if (lead == false) continue
        room.peakY = Math.min(room.peakY, lead.y)
        const before = room.platforms.length
        generatePlatforms(room, lead.y - look)
        const afterGenerate = room.platforms.length
        cleanPlatforms(room)
        const afterClean = room.platforms.length
        if (afterGenerate !== before || afterClean !== afterGenerate) {
            io.to(roomName).emit('platforms', room.platforms)
        }
        sendMoves(roomName, room)

        for (const id in room.players) {
            const p = room.players[id]
            if (p != false && p.y < room.peakY) {
                boostPlayer(room, id)
            }
        }

        payPlayers(roomName, room, lead)
        roundEnd(roomName)
    }
    broadcastRoomList()
}, tick)
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
        if (room != null && room.players[socket.id] != null && socket.data.spectating == false) {
            room.players[socket.id].x = movementData.x;
            room.players[socket.id].y = movementData.y;
            io.to(roomName).emit('move', { id: socket.id, x: movementData.x, y: movementData.y });
        }
    });
    socket.on('die', () => {
        const roomName = socket.data.room;
        const room = rooms[roomName];
        if (room != null && room.players[socket.id] != null && room.players[socket.id].alive == true) {
            killPlayer(room, roomName, socket.id);
            socket.join(LOBBY);
            socket.emit('roomList', Object.values(rooms).map(roomSummary));
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