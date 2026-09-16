const socket = io();
let canvas;
let ctx;
const fric = 0.1;
const accel = 1;
const maxSpeed = 5;
const camera = {y: 0,width: 800,height: 600,scroll: 0.1,paddingTop: 150,paddingBottom: 250,peak: 0,dip: 600};
let grav = 0.1;
let platforms = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }];
let players = {};
let alivePlayers = {};
let localPlayer = null;
let myId = null;
let lastFrameTime = null;
let start = false;
let lstart = false;
let room = null;
let rstate = 'waiting';
let countdownEndsAt = null;
let spectating = false;
let myMoney = 0;

const settingsSchema = [];
const shopItems = [];

let selectedItemId = localStorage.getItem('shopSelectedItem') || null;

function loadSettings() {
    let stored = {};
    try {
        stored = JSON.parse(localStorage.getItem('gameSettings')) || {};
    } catch (e) {
        stored = {};
    }
    const values = {};
    settingsSchema.forEach((s) => {
        values[s.id] = stored[s.id] != null ? stored[s.id] : s.default;
    });
    return values;
}
function saveSettings() {
    localStorage.setItem('gameSettings', JSON.stringify(settingsValues));
}
function getSetting(id) {
    return settingsValues[id];
}
const settingsValues = loadSettings();
class Player {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.speed = 0;
        this.jump = 0;
        this.jumpHeight = 5;
        this.color = color;
        this.grounded = false;
        this.hitbox = {offsetX: 0,offsetY: 0,width: 20,height: 20};
        this.screenY = 0;
        this.alive = true;
        this.offScreenTimer = 0;
    }
    getHitbox() {
        return {x: this.x + this.hitbox.offsetX,y: this.y + this.hitbox.offsetY,width: this.hitbox.width,height: this.hitbox.height};
    }
    die() {
        if (this.alive == false) return;
        this.alive = false;
        this.speed = 0;
        this.jump = 0;
        this.offScreenTimer = 0;
        socket.emit('die');
        view('select'); 
    }
    update(dt) {
        if (this.alive == false) return;
        dt = dt || 1 / 60;
        let check = false;
        this.grounded = false;
        for (let platform of platforms) {
            if (platform.type == 'pass') {
                check = col.passThrough(this, platform);
            } else {
                check = col.solid(this, platform);
            }
            if (check == true) {
                break;
            }
        }
        let moved = false;
        if (check == true) {
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
        if ((keys.ArrowUp == true || keys2.W == true || keys.Space == true) && this.grounded == true) {
            this.jump -= this.jumpHeight;
            moved = true;
            if (this.jumpHeight == 8) {
                this.jumpHeight = 5;
            }
        }
        if (keys.ArrowDown == true || keys2.S == true) {
            grav = 0.5;
        }
        else {
            grav = 0.1;
        }
        if (keys.ArrowLeft == true || keys2.A == true) {
            this.speed = Math.min(this.speed + accel, maxSpeed);
            moved = true;
        }
        if (keys.ArrowRight == true|| keys2.D == true) {
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
        if (rstate == 'active') {
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
        if (moved == true) {
            socket.emit('move', { x: this.x, y: this.y });
        }
    }
}
function topPlayer(set) {
    let topPlay = null;
    for (let id in set) {
        if (topPlay == null || set[id].y < topPlay.y) {
            topPlay = set[id];
        }
    }
    return topPlay;
}
function alive() {
    const alive = {};
    for (let id in players) {
        if (players[id] != null && players[id].alive != false) {
            alive[id] = players[id];
        }
    }
    return alive;
}
function cameraU(dt) {
    let limit = camera.y;
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
        let bottom = camera.peak + camera.dip;
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
    if (e.code == 'Space') keys.Space = true;
    const keyUpper = e.key.toUpperCase();
    if (keyUpper in keys2) keys2[keyUpper] = true;
});
window.addEventListener('keyup', (e) => {
    if (e.key in keys) keys[e.key] = false;
    if (e.code == 'Space') keys.Space = false;
    const keyUpper = e.key.toUpperCase();
    if (keyUpper in keys2) keys2[keyUpper] = false;
});
socket.on('connect', () => {
    myId = socket.id;
});
socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers;
    for (let id in players) {
        if (players[id].alive == undefined) players[id].alive = true;
    }
    const sData = players[myId];
    if (sData != null && spectating == false) {
        if (localPlayer == null) {
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
        myMoney = sData.money || 0;
        updateMoneyHud();
    }
    loopStart();
});
socket.on('new', (data) => {
    players[data.id] = { alive: true, ...data.player };
});
socket.on('move', (data) => {
    if (players[data.id] != null) {
        players[data.id].x = data.x;
        players[data.id].y = data.y;
    }
});
socket.on('disconnect', (id) => {
    delete players[id];
});
socket.on('die', (id) => {
    if (players[id] != null) {
        players[id].alive = false;
    }
});
socket.on('money', (data) => {
    if (data[myId] != null) {
        myMoney = data[myId];
        updateMoneyHud();
    }
});
socket.on('platforms', (serverPlatforms) => {
    platforms = serverPlatforms;
});
socket.on('roomState', (data) => {
    rstate = data.state;
    countdownEndsAt = data.countdownEndsAt;
    view(rstate == 'waiting' ? 'waiting' : 'none');
});
socket.on('spectating', (val) => {
    spectating = !!val;
    if (spectating == true) {
        localPlayer = null;
    }
    updateMoneyHud();
    view('none');
    loopStart();
});
socket.on('roomList', (list) => {
    roomList(list);
});
socket.on('roundEnded', () => {
});
function choose(rname) {
    start = true;
    room = rname;
    socket.emit('joinRoom', rname);
}
function Spectate(rname) {
    start = true;
    room = rname;
    socket.emit('spectate', rname);
}
function join() {
    start = true;
    socket.emit('join');
}
function roomList(list) {
    const container = document.getElementById('roomListEl');
    if (container == null) return;
    container.innerHTML = '';
    list.forEach((r) => {
        const row = document.createElement('div');
        row.className = 'room-row';

        const info = document.createElement('div');
        info.className = 'room-info';
        const name = document.createElement('span');
        name.className = 'room-name';
        name.textContent = r.name;
        const meta = document.createElement('span');
        meta.className = 'room-meta';
        meta.textContent = `${r.playerCount} players, ${r.botCount} bots`;
        info.appendChild(name);
        info.appendChild(meta);

        const status = document.createElement('span');
        if (r.state == 'waiting') {
            const left = r.countdownEndsAt
                ? Math.max(0, Math.ceil((r.countdownEndsAt - Date.now()) / 1000))
                : null;
            status.textContent = left != null ? `starts in ${left}s` : 'waiting';
            status.className = 'room-status waiting';
        } else {
            status.textContent = 'in progress';
            status.className = 'room-status active';
        }

        const btn = document.createElement('button');
        btn.className = 'serverBtn small';
        if (r.state == 'waiting') {
            btn.textContent = 'Join';
            btn.addEventListener('click', () => choose(r.name));
        } else {
            btn.textContent = 'Spectate';
            btn.addEventListener('click', () => Spectate(r.name));
        }

        row.appendChild(info);
        row.appendChild(status);
        row.appendChild(btn);
        container.appendChild(row);
    });
}
function updateMoneyHud() {
    const hud = document.getElementById('moneyHud');
    if (hud == null) return;
    hud.textContent = `$${Math.floor(myMoney)}`;
    hud.classList.toggle('hidden', spectating == true);
}
function renderSettings() {
    const container = document.getElementById('settingsListEl');
    if (container == null) return;
    container.innerHTML = '';
    if (settingsSchema.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No settings yet — add entries to settingsSchema in game.js.';
        container.appendChild(empty);
        return;
    }
    settingsSchema.forEach((s) => {
        const row = document.createElement('div');
        row.className = 'option-row';
        const label = document.createElement('span');
        label.textContent = s.label;
        row.appendChild(label);

        let input;
        if (s.type === 'toggle') {
            input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!settingsValues[s.id];
            input.addEventListener('change', () => {
                settingsValues[s.id] = input.checked;
                saveSettings();
            });
        } else if (s.type === 'range') {
            input = document.createElement('input');
            input.type = 'range';
            input.min = s.min != null ? s.min : 0;
            input.max = s.max != null ? s.max : 100;
            input.value = settingsValues[s.id];
            input.addEventListener('input', () => {
                settingsValues[s.id] = Number(input.value);
                saveSettings();
            });
        } else if (s.type === 'select') {
            input = document.createElement('select');
            (s.options || []).forEach((opt) => {
                const o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                input.appendChild(o);
            });
            input.value = settingsValues[s.id];
            input.addEventListener('change', () => {
                settingsValues[s.id] = input.value;
                saveSettings();
            });
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = settingsValues[s.id] != null ? settingsValues[s.id] : '';
            input.addEventListener('input', () => {
                settingsValues[s.id] = input.value;
                saveSettings();
            });
        }
        row.appendChild(input);
        container.appendChild(row);
    });
}
function renderShop() {
    const container = document.getElementById('shopListEl');
    if (container == null) return;
    container.innerHTML = '';
    const balance = document.createElement('p');
    balance.className = 'shop-balance';
    balance.textContent = `Balance: $${Math.floor(myMoney)}`;
    container.appendChild(balance);
    if (shopItems.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty-state';
        empty.textContent = 'No items yet — add entries to shopItems in game.js.';
        container.appendChild(empty);
        return;
    }
    shopItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'option-row';
        const info = document.createElement('div');
        info.className = 'room-info';
        const name = document.createElement('span');
        name.className = 'room-name';
        name.textContent = item.name;
        info.appendChild(name);
        if (item.price != null) {
            const price = document.createElement('span');
            price.className = 'room-meta';
            price.textContent = `$${item.price}`;
            info.appendChild(price);
        }
        row.appendChild(info);
        const btn = document.createElement('button');
        btn.className = 'serverBtn small';
        btn.textContent = item.id === selectedItemId ? 'Selected' : 'Select';
        btn.addEventListener('click', () => {
            selectedItemId = item.id;
            localStorage.setItem('shopSelectedItem', selectedItemId);
            renderShop();
        });
        row.appendChild(btn);
        container.appendChild(row);
    });
}
function view(view) {
    const menu = document.getElementById('menu');
    const select = document.getElementById('serverSelect');
    const waiting = document.getElementById('waitingRoom');
    const settingsPanel = document.getElementById('settingsPanel');
    const shopPanel = document.getElementById('shopPanel');
    if (menu == null || select == null || waiting == null) return;
    if (view == 'none') {
        menu.classList.add('hidden');
        return;
    }
    menu.classList.remove('hidden');
    select.classList.toggle('hidden', view != 'select');
    waiting.classList.toggle('hidden', view != 'waiting');
    if (settingsPanel != null) settingsPanel.classList.toggle('hidden', view != 'settings');
    if (shopPanel != null) shopPanel.classList.toggle('hidden', view != 'shop');
}
function update(timestamp) {
    let dt = 1 / 60;
    if (lastFrameTime != null) {
        dt = (timestamp - lastFrameTime) / 1000;
        dt = Math.min(dt, 0.1);
    }
    lastFrameTime = timestamp;
    if (localPlayer != null) {
        localPlayer.update(dt);
        if (players[myId] != null) {
            players[myId].x = localPlayer.x;
            players[myId].y = localPlayer.y;
            players[myId].color = localPlayer.color;
            players[myId].alive = localPlayer.alive;
        }
    }
    alivePlayers = alive();
    cameraU(dt);
    if (rstate == 'waiting' && countdownEndsAt != null) {
        const left = Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000));
        const count = document.getElementById('countdownText');
        if (count != null) count.textContent = `Game starts in: ${left}s`;
    }
    if (ctx != null && canvas != null) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(0, -camera.y);
        for (let id in players) {
            const p = players[id];
            const isSelf = id == myId && localPlayer;
            const px = isSelf ? localPlayer.x : p.x;
            const py = isSelf ? localPlayer.y : p.y;
            const isAlive = isSelf ? localPlayer.alive : p.alive != false;
            const baseColor = isSelf ? (localPlayer.color || 'rgb(0, 255, 0)') : (p.color || 'rgb(255, 255, 255)');
            ctx.fillStyle = isAlive ? baseColor : 'rgba(120, 120, 120, 0.4)';
            ctx.fillRect(px, py, 20, 20);
        }
        platforms.forEach(platform => {ctx.fillStyle = platform.type == 'solid' ? 'rgb(139, 69, 19)' : 'rgb(34, 139, 34)';ctx.fillStyle = platform.type == 'boost' ? 'rgb(0, 150, 255)' : ctx.fillStyle;ctx.fillRect(platform.x, platform.y, platform.width, platform.height);});
        ctx.restore();
        if (localPlayer != null && localPlayer.alive == false) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 36px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('You Died', canvas.width / 2, canvas.height / 2);
            ctx.restore();
        }
        if (spectating == true) {
            ctx.save();
            ctx.fillStyle = 'white';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`Spectating ${room || ''}`, 10, 24);
            ctx.restore();
        }
    }
    requestAnimationFrame(update);
}
function loopStart() {
    if (start == true && (localPlayer != null || spectating == true) && lstart == false) {
        lstart = true;
        requestAnimationFrame(update);
    }
}
window.onload = () => {
    canvas = document.getElementById('gameCanvas');
    if (canvas != null) {
        ctx = canvas.getContext('2d');
        canvas.width = camera.width;
        canvas.height = camera.height;
    }
    const joinButton = document.getElementById('joinButton');
    if (joinButton != null) joinButton.addEventListener('click', join);
    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton != null) settingsButton.addEventListener('click', () => { renderSettings(); view('settings'); });
    const shopButton = document.getElementById('shopButton');
    if (shopButton != null) shopButton.addEventListener('click', () => { renderShop(); view('shop'); });
    const settingsBackButton = document.getElementById('settingsBackButton');
    if (settingsBackButton != null) settingsBackButton.addEventListener('click', () => view('select'));
    const shopBackButton = document.getElementById('shopBackButton');
    if (shopBackButton != null) shopBackButton.addEventListener('click', () => view('select'));
    updateMoneyHud();
    view('select');
};