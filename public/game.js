const socket = io();
var canv;
var cxt;
const fric = 0.1;
const accel = 1;
const maxSpd = 5;
var jumpH = 5;
var skyb = 255;
var skyg = 200;
var skyr = 200;
const cam = {
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

var moi = null;
var myId = null;
var lastfr = null;

var gameon = false;
var loopon = false;
var roomid = null;
var rstate = 'waiting';
var cea = null;
var animid = null;
const winsStorageKey = 'velocify-wins';
var wins = loadWins();

function loadWins() {
    const savedWins = Number.parseInt(localStorage.getItem(winsStorageKey), 10);
    return Number.isFinite(savedWins) && savedWins >= 0 ? savedWins : 0;
}

function saveWins() {
    localStorage.setItem(winsStorageKey, String(wins));
}

function updateWinStat() {
    const winStat = document.getElementById('winStat');
    if (winStat) winStat.textContent = `Wins: ${wins}`;
}

function recordWin() {
    wins += 1;
    saveWins();
    updateWinStat();
    updateServerLocks();
}

function getWinLabelFont() {
    if (wins >= 100) return 'bold 15px Georgia, serif';
    if (wins >= 10) return 'bold 13px "Courier New", monospace';
    return 'bold 11px sans-serif';
}

function updateServerLocks() {
    document.querySelectorAll('.serverBtn').forEach((button) => {
        const requiredWins = Number(button.dataset.requiredWins || 0);
        const locked = wins < requiredWins;
        const label = button.dataset.label || button.textContent;
        button.dataset.label = label.replace(/ \(Need \d+ wins?\)$/, '');
        button.disabled = locked;
        button.textContent = locked ? `${button.dataset.label} (Need ${requiredWins} win${requiredWins === 1 ? '' : 's'})` : button.dataset.label;
        button.title = locked ? `Requires ${requiredWins} win${requiredWins === 1 ? '' : 's'}` : '';
    });
}

class col {
    static checkAABB(a, b) {
        return a.x < b.x + b.width &&
               a.x + a.width > b.x &&
               a.y < b.y + b.height &&
               a.y + a.height > b.y;
    }
    static fixDaPass(player, platform) {
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
    static fixDaSolid(player, platform) {
        const box = player.getHitbox();

        if (!this.checkAABB(box, platform)) return false;

        if (platform.type === 'boost') {
            jumpH = 8;
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
    static fixDaKill(player, platform) {
        if (!this.checkAABB(player.getHitbox(), platform)) return false;

        player.die();
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
        this.plotRelevantlessTime = 0;
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
        this.plotRelevantlessTime = 0;
        socket.emit('guydied');
    }
    update(dt) {
        if (!this.alive) return;
        dt = dt || 1 / 60;

            var check = false;
        this.grounded = false;
        for (var platform of platforms) {
            if (platform.type === 'kill') {
                if (col.fixDaKill(this, platform)) break;
            }
            else if (platform.type === 'solid') {
                check = col.fixDaSolid(this, platform);
            }
            else if (platform.type === 'pass') {
                check = col.fixDaPass(this, platform);
            }
            else if (platform.type === 'boost') {
                check = col.fixDaSolid(this, platform);
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
        const wallRight = canv.width - 20;
        if (this.x <= wallLeft) {
            this.x = wallLeft;
            this.speed = 0;
        }
        else if (this.x >= wallRight) {
            this.x = wallRight;
            this.speed = 0;
        }
        if ((keys.ArrowUp || keys2.W || keys.Space) && this.grounded) {
            this.jump -= jumpH;
            moved = true;
            if (jumpH == 8) {
                jumpH = 5;
            }
        }
        if (keys.ArrowDown || keys2.S) {
            grav = 0.5;
        }
        else {
            grav = 0.1;
        }
        if (keys.ArrowLeft || keys2.A) {
            this.speed = Math.min(this.speed + accel, maxSpd);
            moved = true;
        }
        if (keys.ArrowRight || keys2.D) {
            this.speed = Math.max(this.speed - accel, -maxSpd);
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

        this.screenY = this.y - cam.y;
        if (rstate === 'active') {
            const box = this.getHitbox();
            const screenBottom = cam.y + cam.height;
            if (box.y > screenBottom) {
                this.plotRelevantlessTime += dt;
                if (this.plotRelevantlessTime >= 3) {
                    this.die();
                }
            } else {
                this.plotRelevantlessTime = 0;
            }
        }

        if (moved) {
            socket.emit('guymove', { x: this.x, y: this.y });
        }
    }
}

function topguy(playerSet) {
    var topPlay = null;
    for (var id in playerSet) {
        if (topPlay === null || playerSet[id].y < topPlay.y) {
            topPlay = playerSet[id];
        }
    }
    return topPlay;
}
function skycol() {
    skyb = Math.max(0, 255 - Math.abs(cam.y) / 200);
    skyg = Math.max(0, 200 - Math.abs(cam.y) / 150);
    skyr = Math.max(0, 200 - Math.abs(cam.y) / 150);
}

function liveguys() {
    const alive = {};
    for (var id in players) {
        if (players[id] && players[id].alive !== false) {
            alive[id] = players[id];
        }
    }
    return alive;
}

function cammove(dt) {
    var limit = cam.y;
    const leadPlayer = topguy(alivePlayers);

    if (leadPlayer != null) {
        const screenY = leadPlayer.y - cam.y;

        if (screenY < cam.paddingTop) {
            limit = leadPlayer.y - cam.paddingTop;
        }
        else if (screenY > cam.height - cam.paddingBottom) {
            limit = leadPlayer.y - cam.height + cam.paddingBottom;
        }
        else {
            limit = cam.y;
        }

        cam.peak = Math.min(cam.peak, limit);
        var bottom = cam.peak + cam.dip;
        if (limit > bottom) {
            limit = bottom;
        }
        if (limit > 0) {
            limit = 0;
        }

        const smoothing = 1 - Math.pow(1 - cam.scroll, dt * 60);
        cam.y += (limit - cam.y) * smoothing;
    }
}

function resetView() {
    cam.y = 0;
    cam.peak = 0;
    lastfr = null;
    skyb = 255;
    skyg = 200;
    skyr = 200;
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

socket.on('existers', (serverPlayers) => {
    players = serverPlayers;
    for (var id in players) {
        if (players[id].alive === undefined) players[id].alive = true;
    }

    const sData = players[myId];
    if (sData) {
        if (!moi) {
            moi = new Player(sData.x, sData.y, sData.color);
        } else {
            moi.x = sData.x;
            moi.y = sData.y;
            moi.color = sData.color;
            moi.alive = sData.alive;
            moi.speed = 0;
            moi.jump = 0;
            moi.plotRelevantlessTime = 0;
        }
        moi.wins = wins;
    }
    startloop();
});
socket.on('newguy', (data) => {
    players[data.id] = { alive: true, ...data.player };
});
socket.on('guymoved', (data) => {
    if (players[data.id]) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
    }
});
socket.on('guyleft', (id) => {
    delete players[id];
});
socket.on('guydied', (id) => {
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
    if (rstate === 'waiting') resetView();
    setmenu(rstate === 'waiting' ? 'waiting' : 'none');
});
socket.on('roomLocked', ({ requiredWins }) => {
    gameon = false;
    setmenu('select');
    updateServerLocks();
    const winStat = document.getElementById('winStat');
    if (winStat) winStat.textContent = `Wins: ${wins} (Need ${requiredWins})`;
});
socket.on('roundEnded', (data) => {
    if (data && data.winnerId === myId) recordWin();
    resetView();
});

function pickroom(roomName) {
    const requiredWins = Number(document.querySelector(`[data-room="${roomName}"]`)?.dataset.requiredWins || 0);
    if (wins < requiredWins) return;

    gameon = true;
    if (roomid) {
        socket.emit('switchRoom', { roomName, playerWins: wins });
    } else {
        socket.emit('joinRoom', roomName, wins);
    }
    roomid = roomName;
}

function leaveroom() {
    if (roomid) {
        socket.emit('leaveRoom');
    }

    gameon = false;
    loopon = false;
    roomid = null;
    rstate = 'waiting';
    cea = null;
    moi = null;
    players = {};
    alivePlayers = {};

    if (animid !== null) {
        cancelAnimationFrame(animid);
        animid = null;
    }

    setmenu('select');
}

function setmenu(view) {
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

function upd(timestamp) {
    var dt = 1 / 60;
    if (lastfr !== null) {
        dt = (timestamp - lastfr) / 1000;
        dt = Math.min(dt, 0.1);
    }
    lastfr = timestamp;

    if (moi) {
        moi.update(dt);
        if (players[myId]) {
            players[myId].x = moi.x;
            players[myId].y = moi.y;
            players[myId].color = moi.color;
            players[myId].alive = moi.alive;
        }
    }

    alivePlayers = liveguys();
    cammove(dt);
    skycol();

    if (rstate === 'waiting' && cea) {
        const secondsLeft = Math.max(0, Math.ceil((cea - Date.now()) / 1000));
        const countdownEl = document.getElementById('countdownText');
        if (countdownEl) countdownEl.textContent = `Game starts in: ${secondsLeft}s`;
    }

    if (cxt && canv) {
        cxt.fillStyle = 'rgb(' + skyr + ', ' + skyg + ', ' + skyb + ')';
        cxt.fillRect(0, 0, canv.width, canv.height);
        cxt.save();
        cxt.translate(0, -cam.y);

        for (var id in players) {
            const p = players[id];
            const isSelf = id === myId && moi;
            const px = isSelf ? moi.x : p.x;
            const py = isSelf ? moi.y : p.y;
            const isAlive = isSelf ? moi.alive : p.alive !== false;
            const baseColor = isSelf ? (moi.color || 'rgb(0, 255, 0)') : (p.color || 'rgb(255, 255, 255)');

            cxt.fillStyle = isAlive ? baseColor : 'rgba(120, 120, 120, 0.4)';
            cxt.fillRect(px, py, 20, 20);
            if (isSelf) {
                const winLabel = `WINS: ${wins}`;
                cxt.font = getWinLabelFont();
                cxt.textAlign = 'center';
                cxt.lineWidth = 4;
                cxt.strokeStyle = 'rgb(0, 0, 0)';
                cxt.strokeText(winLabel, px + 10, py - 7);
                cxt.lineWidth = 2;
                cxt.strokeStyle = 'rgb(255, 255, 255)';
                cxt.strokeText(winLabel, px + 10, py - 7);
                cxt.fillStyle = 'rgb(255, 255, 255)';
                cxt.fillText(winLabel, px + 10, py - 7);
            }
        }

        platforms.forEach(platform => {
            if (platform.goal) {
                cxt.fillStyle = 'rgb(255, 190, 30)';
            } else if (platform.type === 'kill') {
                cxt.fillStyle = 'rgb(220, 35, 45)';
            } else if (platform.type === 'boost') {
                cxt.fillStyle = 'rgb(0, 150, 255)';
            } else {
                cxt.fillStyle = platform.type === 'solid' ? 'rgb(139, 69, 19)' : 'rgb(34, 139, 34)';
            }
            cxt.fillRect(platform.x, platform.y, platform.width, platform.height);
        });
        cxt.restore();

        if (moi && !moi.alive) {
            cxt.save();
            cxt.fillStyle = 'rgba(0, 0, 0, 0.5)';
            cxt.fillRect(0, 0, canv.width, canv.height);
            cxt.fillStyle = 'white';
            cxt.font = 'bold 36px sans-serif';
            cxt.textAlign = 'center';
            cxt.fillText('You Died', canv.width / 2, canv.height / 2);
            cxt.restore();
        }
    }

    animid = requestAnimationFrame(upd);
}

function startloop() {
    if (gameon && moi && !loopon) {
        loopon = true;
        animid = requestAnimationFrame(upd);
    }
}

window.onload = () => {
    updateWinStat();
    updateServerLocks();
    canv = document.getElementById('gameCanvas');

    if (canv) {
        cxt = canv.getContext('2d');
        canv.width = cam.width;
        canv.height = cam.height;
    }

    document.querySelectorAll('.serverBtn').forEach((btn) => {
        btn.addEventListener('click', () => pickroom(btn.dataset.room));
    });

    const leaveButton = document.getElementById('leaveRoomBtn');
    if (leaveButton) {
        leaveButton.addEventListener('click', leaveroom);
    }

    const quitButton = document.getElementById('quitBtn');
    if (quitButton) {
        quitButton.addEventListener('click', () => window.close());
    }

    setmenu('select');
};