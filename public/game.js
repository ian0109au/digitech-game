const socket = io();
let canvas;
let ctx;
const fric = 0.1;
const accel = 1;
const maxSpeed = 5;
const jumpHeight = 6;
const camera = {
    y: 0,
    width: 800,
    height: 600,
    scroll: 0.1,
    paddingTop: 150,
    paddingBottom: 250,
    peak: 0,
    dip: 900
};
let grav = 0.1;
let platforms = [
    { x: 0, y: 580, width: 800, height: 20, type: 'solid' }
];

let players = {};
let localPlayer = null;
let myId = null;

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
    static resolveBoost(player){
        player.jump -= 8
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
    }
    getHitbox() {
        return {
            x: this.x + this.hitbox.offsetX,
            y: this.y + this.hitbox.offsetY,
            width: this.hitbox.width,
            height: this.hitbox.height
        };
    }
    update() {
        let check = false;
        this.grounded = false;
        for (let platform of platforms) {
            if (platform.type === 'solid') {
                check = col.resolveSolid(this, platform);
            } 
            else if (platform.type === 'pass') {
                check = col.resolvePass(this, platform);
            }
            else if (platform.type === 'boost') {
                check = col.resolveBoost(this, platform);
                if (check) {
                    col.resolveBoost(this)
                }
            }
            if (check) {
                break;
            }
        }
        
        let moved = false;
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

        if (moved) {
            socket.emit('playerMovement', { x: this.x, y: this.y });         
        }
    }
}

class Platform {
    constructor(x, y, width, height, type) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type;
    }
}

function topPlayer(players) {
    let topPlay = null;
    for (let id in players) {
        if (topPlay === null || players[id].y < topPlay.y) {
            topPlay = players[id];
        }
    }
    return topPlay;
}

function cameraU() {
    let limit = 0; 
    const leadPlayer = topPlayer(players);
    if (leadPlayer != null) {
        const screenY = leadPlayer.y - camera.y;
        if (screenY < 0 + camera.paddingTop) {
            limit = leadPlayer.y - camera.paddingTop;
        }
        else if (screenY > camera.height - camera.paddingBottom) {  
            limit = leadPlayer.y - camera.height + camera.paddingBottom;
        }
        else {
            limit = camera.y;
        }
        if (camera.peak == 0) {
            camera.peak = limit;
        }
        let bottom = camera.peak + camera.dip;
        if (limit > bottom) {
            limit = bottom;
        }
        if (limit > 0) {
            limit = 0;
        }
        camera.y += (limit - camera.y) * camera.scroll;
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
    socket.emit('requestPlayers'); 
});

socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    if (players[myId] && !localPlayer) {
        const sData = players[myId];
        localPlayer = new Player(sData.x, sData.y, sData.color);
    }
});
socket.on('newPlayer', (data) => {
    players[data.id] = data.player; 
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

function random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generate(target) {
    if (platforms.length === 0) return;
    let highest = platforms.reduce((min, p) => p.y < min.y ? p : min, platforms[0]);
    let current = highest.y;

    while (current > target) {
        const gap = random(60, 130);
        current -= gap;

        const width = random(60, 180);
        const x = random(0, canvas.width - width);
        const ty = random(0, 2);
        if (ty === 0){
             typ = 'solid' 
        } else if (ty === 1) {
            typ = 'pass'
        } else {
            typ = 'boost'
        }
        
        platforms.push({ x, y: current, width, height: 15, type: typ });
    }
}
function clean() {
    let bottom = camera.peak + camera.dip;
    platforms = platforms.filter(p => p.y < bottom);
}

function update() {
    if (localPlayer) {
        localPlayer.update();
    }
    cameraU();
    generate(camera.y - 200);
    clean();

    if (ctx && canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(0, -Math.floor(camera.y));

        for (let id in players) {
            if (id === myId && localPlayer) {
                ctx.fillStyle = localPlayer.color || 'rgb(0, 255, 0)';
                ctx.fillRect(localPlayer.x, localPlayer.y, 20, 20);
            }
            else {
                ctx.fillStyle = players[id].color || 'rgb(255, 255, 255)';
                ctx.fillRect(players[id].x, players[id].y, 20, 20);
            }
        }

        platforms.forEach(platform => {
            ctx.fillStyle = platform.type === 'solid' ? 'rgb(139, 69, 19)' : 'rgb(34, 139, 34)';
            ctx.fillStyle = platform.type === 'boost' ? 'rgb(0, 150, 255)' : ctx.fillStyle;
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
        });
        ctx.restore();
    }

    requestAnimationFrame(update);
}

window.onload = () => {
    canvas = document.getElementById('gameCanvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
        canvas.width = camera.width;
        canvas.height = camera.height;
        update();
    }
};