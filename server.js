const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};

class ServerPlayer {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    this.color = color;
  }
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);
    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0');
    players[socket.id] = new ServerPlayer(100, 500, randomColor);
    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            io.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
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