const socket = io();
var canvas;
var ctx;
const fric = 0.1;
const accel = 1;
const maxSpeed = 5;
var jumpHeight = 5;
var skyb = 255;
var skyg = 200;
var skyr = 200;
const camera = {
    y: 0,
    width: 800,
    height: 600,
    scroll: 0.1,
    paddingTop: 150,
    paddingBottom: 250,
    peak: 0,
    dip: 600
};
var grav = 0.1;

var platforms = [
    { x: 0, y: 580, width: 800, height: 20, type: 'solid' }
];

var players = {};
var alivePlayers = {};

var localPlayer = null;
var myId = null;
var lastFrameTime = null;

var sgame = false;
var sloop = false;
var currentRoom = null;
var rstate = 'waiting';
var cea = null;

class col {
    static checkAABB(a, b) {
        return a.x < b.x + b.width &&
               a.x + a.width > b.x &&
               a.y < b.y + b.height &&
               a.y + a.height > b.y;
    }
    static resolvePass(player, platform) {
        const box = player.getHitbox();

        if (this.checkAABB(box, platform)) {
            const isFalling = player.jump > 0;
            const playerFeet = box.y + box.height;
            const wasAboveBefore = (playerFeet - player.jump) <= platform.y + 4;

            if (isFalling && wasAboveBefore) {
                player.y = platform.y - player.hitbox.offsetY - player.hitbox.height;
                return true;
            }
        }
        return false;
    }
    static resolveSolid(player, platform) {
        const box = player.getHitbox();

        if (!this.checkAABB(box, platform)) return false;

        if (platform.type === 'boost') {
            jumpHeight = 8;
        }

        const overlapX = Math.min(box.x + box.width, platform.x + platform.width) - Math.max(box.x, platform.x);
        const overlapY = Math.min(box.y + box.height, platform.y + platform.height) - Math.max(box.y, platform.y);

        if (overlapX < overlapY) {
            if (box.x + box.width / 2 < platform.x + platform.width / 2) {
                player.x -= overlapX;
            } else {
                player.x += overlapX;
            }
            player.speed = 0;
        } else {
            if (box.y + box.height / 2 < platform.y + platform.height / 2) {
                player.y -= overlapY;
            } else {
                player.y += overlapY;
                player.jump = 0;

            }
        }
        return true;
    }
}

class Player {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.speed = 0;
        this.jump = 0;
        this.color = color;
        this.grounded = false;
        this.hitbox = {
            offsetX: 0,
            offsetY: 0,
            width: 20,
            height: 20
        };
        this.screenY = 0;
        this.alive = true;
        this.offScreenTimer = 0;
    }
    getHitbox() {
        return {
            x: this.x + this.hitbox.offsetX,
            y: this.y + this.hitbox.offsetY,
            width: this.hitbox.width,
            height: this.hitbox.height
        };
    }
    die() {
        if (!this.alive) return;
        this.alive = false;
        this.speed = 0;
        this.jump = 0;
        this.offScreenTimer = 0;
        socket.emit('playerDied');
        setMenuView('select');
    }
    update(dt) {
        if (!this.alive) return;
        dt = dt || 1 / 60;

        var check = false;
        this.grounded = false;
        for (var platform of platforms) {
            if (platform.type === 'solid') {
                check = col.resolveSolid(this, platform);
            }
            else if (platform.type === 'pass') {
                check = col.resolvePass(this, platform);
            }
            else if (platform.type === 'boost') {
                check = col.resolveSolid(this, platform);
            }
            if (check) {
                break;
            }
        }

        var moved = false;
        if (check) {
            this.jump = 0;
            this.grounded = true;
        }
        else {
            this.grounded = false;
        }

        const wallLeft = 0;
        const wallRight = canvas.width - 20;
        if (this.x <= wallLeft) {
            this.x = wallLeft;
            this.speed = 0;
        }
        else if (this.x >= wallRight) {
            this.x = wallRight;
            this.speed = 0;
        }
        if ((keys.ArrowUp || keys2.W || keys.Space) && this.grounded) {
            this.jump -= jumpHeight;
            moved = true;
            if (jumpHeight == 8) {
                jumpHeight = 5;
            }
        }
        if (keys.ArrowDown || keys2.S) {
            grav = 0.5;
        }
        else {
            grav = 0.1;
        }
        if (keys.ArrowLeft || keys2.A) {
            this.speed = Math.min(this.speed + accel, maxSpeed);
            moved = true;
        }
        if (keys.ArrowRight || keys2.D) {
            this.speed = Math.max(this.speed - accel, -maxSpeed);
            moved = true;
        }
        this.jump += grav;
        if (this.speed > 0) {
            this.speed = Math.max(this.speed - fric, 0);
        }
        else if (this.speed < 0) {
            this.speed = Math.min(this.speed + fric, 0);
        }
        this.y += this.jump;
        this.x -= this.speed;

        this.screenY = this.y - camera.y;
        if (rstate === 'active') {
            const box = this.getHitbox();
            const screenBottom = camera.y + camera.height;
            if (box.y > screenBottom) {
                this.offScreenTimer += dt;
                if (this.offScreenTimer >= 3) {
                    this.die();
                }
            } else {
                this.offScreenTimer = 0;
            }
        }

        if (moved) {
            socket.emit('playerMovement', { x: this.x, y: this.y });
        }
    }
}

function topPlayer(playerSet) {
    var topPlay = null;
    for (var id in playerSet) {
        if (topPlay === null || playerSet[id].y < topPlay.y) {
            topPlay = playerSet[id];
        }
    }
    return topPlay;
}
function skycol() {
    skyb = Math.max(0, 255 - Math.abs(camera.y) / 20);
    skyg = Math.max(0, 200 - Math.abs(camera.y) / 15);
    skyr = Math.max(0, 200 - Math.abs(camera.y) / 15);
}

function alivePeople() {
    const alive = {};
    for (var id in players) {
        if (players[id] && players[id].alive !== false) {
            alive[id] = players[id];
        }
    }
    return alive;
}

function cameraU(dt) {
    var limit = camera.y;
    const leadPlayer = topPlayer(alivePlayers);

    if (leadPlayer != null) {
        const screenY = leadPlayer.y - camera.y;

        if (screenY < camera.paddingTop) {
            limit = leadPlayer.y - camera.paddingTop;
        }
        else if (screenY > camera.height - camera.paddingBottom) {
            limit = leadPlayer.y - camera.height + camera.paddingBottom;
        }
        else {
            limit = camera.y;
        }

        camera.peak = Math.min(camera.peak, limit);
        var bottom = camera.peak + camera.dip;
        if (limit > bottom) {
            limit = bottom;
        }
        if (limit > 0) {
            limit = 0;
        }

        const smoothing = 1 - Math.pow(1 - camera.scroll, dt * 60);
        camera.y += (limit - camera.y) * smoothing;
    }
}

const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, Space: false};
const keys2 = { W: false, A: false, S: false, D: false};
window.addEventListener('keydown', (e) => {
    if (e.key in keys) keys[e.key] = true;
    if (e.code === 'Space') keys.Space = true;
    const keyUpper = e.key.toUpperCase();
    if (keyUpper in keys2) keys2[keyUpper] = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key in keys) keys[e.key] = false;
    if (e.code === 'Space') keys.Space = false;
    const keyUpper = e.key.toUpperCase();
    if (keyUpper in keys2) keys2[keyUpper] = false;
});

socket.on('connect', () => {
    myId = socket.id;
});

socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    for (var id in players) {
        if (players[id].alive === undefined) players[id].alive = true;
    }

    const sData = players[myId];
    if (sData) {
        if (!localPlayer) {
            localPlayer = new Player(sData.x, sData.y, sData.color);
        } else {
            localPlayer.x = sData.x;
            localPlayer.y = sData.y;
            localPlayer.color = sData.color;
            localPlayer.alive = sData.alive;
            localPlayer.speed = 0;
            localPlayer.jump = 0;
            localPlayer.offScreenTimer = 0;
        }
    }
    tryStartLoop();
});
socket.on('newPlayer', (data) => {
    players[data.id] = { alive: true, ...data.player };
});
socket.on('playerMoved', (data) => {
    if (players[data.id]) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
    }
});
socket.on('playerDisconnected', (id) => {
    delete players[id];
});
socket.on('playerDied', (id) => {
    if (players[id]) {
        players[id].alive = false;
    }
});
socket.on('platforms', (serverPlatforms) => {
    platforms = serverPlatforms;
});
socket.on('rstate', (data) => {
    rstate = data.state;
    cea = data.cea;
    setMenuView(rstate === 'waiting' ? 'waiting' : 'none');
});
socket.on('roundEnded', () => {
});

function chooseServer(roomName) {
    sgame = true;
    if (currentRoom) {
        socket.emit('switchRoom', roomName);
    } else {
        socket.emit('joinRoom', roomName);
    }
    currentRoom = roomName;
}

function setMenuView(view) {
    const menu = document.getElementById('menu');
    const select = document.getElementById('serverSelect');
    const waiting = document.getElementById('waitingRoom');
    if (!menu || !select || !waiting) return;

    if (view === 'none') {
        menu.classList.add('hidden');
        return;
    }
    menu.classList.remove('hidden');
    select.classList.toggle('hidden', view !== 'select');
    waiting.classList.toggle('hidden', view !== 'waiting');
}

function update(timestamp) {
    var dt = 1 / 60;
    if (lastFrameTime !== null) {
        dt = (timestamp - lastFrameTime) / 1000;
        dt = Math.min(dt, 0.1);
    }
    lastFrameTime = timestamp;

    if (localPlayer) {
        localPlayer.update(dt);
        if (players[myId]) {
            players[myId].x = localPlayer.x;
            players[myId].y = localPlayer.y;
            players[myId].color = localPlayer.color;
            players[myId].alive = localPlayer.alive;
        }
    }

    alivePlayers = alivePeople();
    cameraU(dt);
    skycol();

    if (rstate === 'waiting' && cea) {
        const secondsLeft = Math.max(0, Math.ceil((cea - Date.now()) / 1000));
        const countdownEl = document.getElementById('countdownText');
        if (countdownEl) countdownEl.textContent = `Game starts in: ${secondsLeft}s`;
    }

    if (ctx && canvas) {
        ctx.fillStyle = 'rgb(' +skyr + skyg + skyb + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(0, -camera.y);

        for (var id in players) {
            const p = players[id];
            const isSelf = id === myId && localPlayer;
            const px = isSelf ? localPlayer.x : p.x;
            const py = isSelf ? localPlayer.y : p.y;
            const isAlive = isSelf ? localPlayer.alive : p.alive !== false;
            const baseColor = isSelf ? (localPlayer.color || 'rgb(0, 255, 0)') : (p.color || 'rgb(255, 255, 255)');

            ctx.fillStyle = isAlive ? baseColor : 'rgba(120, 120, 120, 0.4)';
            ctx.fillRect(px, py, 20, 20);
        }

        platforms.forEach(platform => {
            ctx.fillStyle = platform.type === 'solid' ? 'rgb(139, 69, 19)' : 'rgb(34, 139, 34)';
            ctx.fillStyle = platform.type === 'boost' ? 'rgb(0, 150, 255)' : ctx.fillStyle;
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
        });
        ctx.restore();

        if (localPlayer && !localPlayer.alive) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('You Died', canvas.width / 2, canvas.height / 2);
            ctx.restore();
        }
    }

    requestAnimationFrame(update);
}

function tryStartLoop() {
    if (sgame && localPlayer && !sloop) {
        sloop = true;
        requestAnimationFrame(update);
    }
}

window.onload = () => {
    canvas = document.getElementById('gameCanvas');

    if (canvas) {
        ctx = canvas.getContext('2d');
        canvas.width = camera.width;
        canvas.height = camera.height;
    }

    document.querySelectorAll('.serverBtn').forEach((btn) => {
        btn.addEventListener('click', () => chooseServer(btn.dataset.room));
    });

    setMenuView('select');
};