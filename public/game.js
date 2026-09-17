const socket = io()
var canvas
var ctx
var fric = 0.1
var accel = 1
var maxSpeed = 5
var camera = {y:0,width:800,height:600,scroll:0.1,paddingTop:150,paddingBottom:250,peak:0,dip:600}
var grav = 0.1
var plats = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }]
var players = {}
var alive = {}
var me = false
var myId = false
var last = false

// a bit rougher, but still works

var start = false
var lstart = false
var room = false
var rstate = 'waiting'
var countEnd = false
var spec = false
var cash = Number(localStorage.getItem('gameCash')) || 0
var countTimer = false

var settingsSchema = [
    { id: 'screenShake', label: 'Screen shake', type: 'toggle', default: true },
    { id: 'cameraSpeed', label: 'Camera speed', type: 'range', min: 1, max: 10, default: 5 }
]
class Character {
    constructor(id, name, price, description, jumpHeight, maxSpeed, acceleration, gravity, color) {
        this.id = id
        this.name = name
        this.price = price
        this.description = description
        this.stats = { jumpHeight, maxSpeed, acceleration, gravity, color }
    }
}
var shopItems = [
    new Character('starter', 'Starter', 0, 'The free all-rounder. Nothing fancy, just gets the job done.', 5, 5, 1, 0.1, 'rgb(79, 216, 196)'),
    new Character('sprinter', 'Sprinter', 100, 'A quick character that is good at getting across small gaps.', 5, 7, 1.4, 0.1, 'rgb(255, 159, 91)'),
    new Character('jumper', 'Jumper', 250, 'A lighter character with a big jump and a little less control in the air.', 8, 5, 1, 0.08, 'rgb(126, 168, 255)'),
    new Character('tank', 'Tank', 500, 'A heavy character that falls faster but keeps a steady pace.', 4, 4, 0.8, 0.16, 'rgb(192, 132, 252)')
]

var selectedItemId = localStorage.getItem('shopSelectedItem') || 'starter'
var openItemId = selectedItemId

function getCharacter(id) {
    return shopItems.find((item) => item.id == id) || shopItems[0]
}

function getSets() {
    var stored = {}
    try {
        stored = JSON.parse(localStorage.getItem('gameSettings')) || {}
    } catch (e) {
        stored = {}
    }
    var values = {}
    settingsSchema.forEach((s) => {
        values[s.id] = stored[s.id] != false ? stored[s.id] : s.default
    })
    return values
}
function getStats() {
    var stored = {}
    try {
        stored = JSON.parse(localStorage.getItem('gameStats')) || {}
    } catch (e) {
        stored = {}
    }
    return {
        wins: Number(stored.wins) || 0,
        kills: Number(stored.kills) || 0,
        timeSurvived: Number(stored.timeSurvived) || 0,
        money: Number(stored.money) || cash
    }
}
function saveSet() {
    localStorage.setItem('gameSettings', JSON.stringify(settings))
}
function saveStats() {
    localStorage.setItem('gameStats', JSON.stringify(playerStats))
}
function getSet(id) {
    return settings[id]
}
const settings = getSets()
var playerStats = getStats()



class Player {
    constructor(x, y, color) {
        const char = getCharacter(selectedItemId)
        this.x = x
        this.y = y
        this.speed = 0
        this.jump = 0
        this.jumpHeight = char.stats.jumpHeight
        this.jumpPower = char.stats.jumpHeight
        this.maxSpeed = char.stats.maxSpeed
        this.acceleration = char.stats.acceleration
        this.gravity = char.stats.gravity
        this.color = char.stats.color || char.color || color
        this.grounded = false
        this.hitbox = {offsetX: 0, offsetY: 0, width: 20, height: 20}
        this.screenY = 0
        this.alive = true
        this.offScreenTimer = 0
    }
    getHitbox() {
        return {x: this.x + this.hitbox.offsetX, y: this.y + this.hitbox.offsetY, width: this.hitbox.width, height: this.hitbox.height}
    }
    die() {
        if (this.alive == false) return
        this.alive = false
        this.speed = 0
        this.jump = 0
        this.offScreenTimer = 0
        socket.emit('die')
        view('select')
    }
    update(dt) {
        if (this.alive == false) return
        dt = dt || 1 / 60
        var check = false
        var wall = false
        var wallSide = 0
        this.grounded = false
        for (var platform of plats) {
            if (platform.type == 'pass') {
                check = col.passThrough(this, platform)
            } else {
                check = col.solid(this, platform)
            }
            if (platform.type == 'wall' && check == true) {
                wall = true
                wallSide = platform.x < canvas.width / 2 ? -1 : 1
            }
            if (check == true) break
        }
        var moved = false
        if (check == true && wall == false) {
            this.jump = 0
            this.grounded = true
        } else {
            this.grounded = false
        }
        var wallLeft = 0
        var wallRight = canvas.width - 20
        if (this.x <= wallLeft) {
            this.x = wallLeft
            this.speed = 0
        } else if (this.x >= wallRight) {
            this.x = wallRight
            this.speed = 0
        }
        if ((keys.ArrowUp == true || keys2.W == true || keys.Space == true) && (this.grounded == true || wall == true)) {
            const jumpForce = this.jumpPower || this.jumpHeight
            this.jump -= jumpForce
            if (wall == true && this.grounded == false) this.speed = wallSide < 0 ? -this.maxSpeed : this.maxSpeed
            moved = true
            this.jumpPower = this.jumpHeight
        }
        if (keys.ArrowDown == true || keys2.S == true) {
            grav = this.gravity * 5
        } else {
            grav = this.gravity
        }
        if (keys.ArrowLeft == true || keys2.A == true) {
            this.speed = Math.min(this.speed + this.acceleration, this.maxSpeed)
            moved = true
        }
        if (keys.ArrowRight == true || keys2.D == true) {
            this.speed = Math.max(this.speed - this.acceleration, -this.maxSpeed)
            moved = true
        }
        this.jump += grav
        if (this.speed > 0) {
            this.speed = Math.max(this.speed - fric, 0)
        } else if (this.speed < 0) {
            this.speed = Math.min(this.speed + fric, 0)
        }
        this.y += this.jump
        this.x -= this.speed
        this.screenY = this.y - camera.y
        if (rstate == 'active') {
            const box = this.getHitbox()
            const screenBottom = camera.y + camera.height
            if (box.y > screenBottom) {
                this.offScreenTimer += dt
                if (this.offScreenTimer >= 3) {
                    this.die()
                }
            } else {
                this.offScreenTimer = 0
            }
        }
        if (moved == true) {
            socket.emit('move', { x: this.x, y: this.y })
        }
    }
}
function topPlayer(set) {
    var topPlay = false
    for (var id in set) {
        if (topPlay == false || set[id].y < topPlay.y) {
            topPlay = set[id]
        }
    }
    return topPlay
}
function getAlive() {
    var alive = {}
    for (var id in players) {
        if (players[id] != false && players[id].alive != false) {
            alive[id] = players[id]
        }
    }
    return alive
}
function cameraU(dt) {
    var limit = camera.y
    const leadPlayer = topPlayer(getAlive())

    if (leadPlayer != false) {
        const screenY = leadPlayer.y - camera.y

        if (screenY < camera.paddingTop) {
            limit = leadPlayer.y - camera.paddingTop
        } else if (screenY > camera.height - camera.paddingBottom) {
            limit = leadPlayer.y - camera.height + camera.paddingBottom
        } else {
            limit = camera.y
        }
        camera.peak = Math.min(camera.peak, limit)
        var bottom = camera.peak + camera.dip
        if (limit > bottom) {
            limit = bottom
        }
        if (limit > 0) {
            limit = 0
        }
        const smoothing = 1 - Math.pow(1 - camera.scroll, dt * 60)
        camera.y += (limit - camera.y) * smoothing
    }
}
const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false, Space: false}
const keys2 = { W: false, A: false, S: false, D: false}
window.addEventListener('keydown', (e) => {
    if (e.key in keys) keys[e.key] = true
    if (e.code == 'Space') keys.Space = true
    const keyUpper = e.key.toUpperCase()
    if (keyUpper in keys2) keys2[keyUpper] = true
})
window.addEventListener('keyup', (e) => {
    if (e.key in keys) keys[e.key] = false
    if (e.code == 'Space') keys.Space = false
    const keyUpper = e.key.toUpperCase()
    if (keyUpper in keys2) keys2[keyUpper] = false
})
socket.on('connect', () => {
    myId = socket.id
})
socket.on('currentPlayers', (serverPlayers) => {
    players = serverPlayers
    for (var id in players) {
        if (players[id].alive == undefined) players[id].alive = true
    }
    var sData = players[myId]
    if (sData != false && spec == false) {
        if (me == false) {
            me = new Player(sData.x, sData.y, sData.color)
        } else {
            me.x = sData.x
            me.y = sData.y
            me.color = sData.color
            me.alive = sData.alive
            me.speed = 0
            me.jump = 0
            me.offScreenTimer = 0
        }
        cash = sData.money != false ? sData.money : cash
        playerStats.money = Number(cash) || 0
        if (sData.stats != null && typeof sData.stats === 'object') {
            playerStats.wins = Number(sData.stats.wins) || playerStats.wins
            playerStats.kills = Number(sData.stats.kills) || playerStats.kills
            playerStats.timeSurvived = Number(sData.stats.timeSurvived) || playerStats.timeSurvived
        }
        saveStats()
        localStorage.setItem('gameCash', cash)
        updateMoneyHud()
    }
    loopStart()
})
socket.on('new', (data) => {
    players[data.id] = {alive: true, ...data.player}
})
socket.on('move', (data) => {
    if (players[data.id] != false) {
        players[data.id].x = data.x
        players[data.id].y = data.y
    }
})
socket.on('disconnect', (id) => {
    delete players[id]
})
socket.on('die', (id) => {
    if (players[id] != false) {
        players[id].alive = false
    }
})
socket.on('money', (data) => {
    if (data[myId] != false) {
        cash = data[myId]
        playerStats.money = Number(cash) || 0
        saveStats()
        localStorage.setItem('gameCash', cash)
        updateMoneyHud()
    }
})
socket.on('characterBought', (data) => {
    selectedItemId = data.id
    openItemId = data.id
    cash = data.money
    localStorage.setItem('shopSelectedItem', selectedItemId)
    localStorage.setItem('gameCash', cash)
    updateMoneyHud()
    renderShop()
})
socket.on('purchaseDenied', () => {
    renderShop()
})
socket.on('platforms', (serverPlatforms) => {
    plats = serverPlatforms
})
socket.on('roomState', (data) => {
    rstate = data.state;
    countEnd = data.countdownEndsAt || false;
    if (countTimer != false) clearInterval(countTimer)
    countTimer = false
    if (rstate == 'waiting') {
        resetView()
        showCount()
        view('waiting')
    } else {
        view('none')
    }
});
socket.on('leftRoom', () => {
    clearClientRoom()
})
function clearClientRoom() {
    if (countTimer != false) clearInterval(countTimer)
    countTimer = false
    start = false
    lstart = false
    room = false
    rstate = 'waiting'
    countEnd = false
    spec = false
    me = false
    players = {}
    plats = [{ x: 0, y: 580, width: 800, height: 20, type: 'solid' }]
    resetView()
    updateMoneyHud()
    view('select')
}
socket.on('spectating', (val) => {
    spec = !!val;
    if (spec == true) {
        me = false;
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
    view('waiting')
    socket.emit('joinRoom', rname, selectedItemId);
}
function Spectate(rname) {
    start = true;
    room = rname;
    view('waiting')
    socket.emit('spectate', rname);
}
function join() {
    start = true;
    view('waiting')
    socket.emit('join', selectedItemId);
}
function leave() {
    socket.emit('leaveRoom')
    clearClientRoom()
}
function resetView() {
    camera.y = 0
    camera.peak = 0
    camera.dip = 600
    last = false
}
function showCount() {
    var count = document.getElementById('countdownText')
    if (count == false) return
    if (countTimer != false) clearInterval(countTimer)
    var tickCount = () => {
        if (rstate != 'waiting') {
            count.textContent = 'Game starts in: 0s'
            return
        }
        if (countEnd == false) {
            count.textContent = 'Game starts in: 30s'
            return
        }
        var left = Math.max(0, Math.ceil((countEnd - Date.now()) / 1000))
        count.textContent = `Game starts in: ${left}s`
    }
    tickCount()
    countTimer = setInterval(tickCount, 250)
}
function roomList(list) {
    const container = document.getElementById('roomListEl');
    if (container == false) return;
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
        meta.textContent = `${r.playerCount} players`;
        info.appendChild(name);
        info.appendChild(meta);

        const status = document.createElement('span');
        if (r.state == 'waiting') {
            const left = r.countdownEndsAt
                ? Math.max(0, Math.ceil((r.countdownEndsAt - Date.now()) / 1000))
                : false;
            status.textContent = left != false ? `starts in ${left}s` : 'waiting';
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
    if (hud == false) return;
    hud.textContent = `$${Math.floor(cash)}`;
    hud.classList.toggle('hidden', spec == true);
}
function renderSettings() {
    const container = document.getElementById('settingsListEl');
    if (container == false) return;
    container.innerHTML = '';
    const selected = getCharacter(selectedItemId)
    var stats = document.createElement('div')
    stats.className = 'option-row'
    stats.style.display = 'block'
    stats.innerHTML = '<strong>Player stats</strong><br>' +
        `Wins: ${playerStats.wins}<br>` +
        `Kills: ${playerStats.kills}<br>` +
        `Time survived: ${Math.floor(playerStats.timeSurvived)}s<br>` +
        `Money: $${Math.floor(cash)}<br>` +
        `Selected class: ${selected.name}`
    container.appendChild(stats)
}
function renderShop() {
    const container = document.getElementById('shopListEl');
    if (container == false) return;
    container.innerHTML = '';
    const balance = document.createElement('p');
    balance.className = 'shop-balance';
    balance.textContent = `Balance: $${Math.floor(cash)}`;
    container.appendChild(balance);
    const chosen = getCharacter(openItemId)
    if (chosen != false) {
        const details = document.createElement('div')
        details.className = 'option-row'
        details.style.display = 'block'
        const title = document.createElement('div')
        title.className = 'room-name'
        title.textContent = chosen.name
        const desc = document.createElement('p')
        desc.className = 'room-meta'
        desc.textContent = chosen.description
        const stats = document.createElement('div')
        stats.className = 'room-meta'
        const color = chosen.stats.color || chosen.color || 'rgb(255, 255, 255)'
        stats.textContent = `Jump height: ${chosen.stats.jumpHeight} | Max speed: ${chosen.stats.maxSpeed} | Acceleration: ${chosen.stats.acceleration} | Gravity: ${chosen.stats.gravity} | Color: ${color}`
        details.appendChild(title)
        details.appendChild(desc)
        details.appendChild(stats)
        container.appendChild(details)
    }
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
        row.addEventListener('click', () => {
            openItemId = item.id
            renderShop()
        })
        const info = document.createElement('div');
        info.className = 'room-info';
        const name = document.createElement('span');
        name.className = 'room-name';
        name.textContent = item.name;
        info.appendChild(name);
        if (item.price != false) {
            const price = document.createElement('span');
            price.className = 'room-meta';
            price.textContent = item.price == 0 ? 'Free' : `$${item.price}`;
            info.appendChild(price);
        }
        row.appendChild(info);
        const btn = document.createElement('button');
        btn.className = 'serverBtn small';
        btn.textContent = item.id === selectedItemId ? 'Selected' : item.price == 0 ? 'Free' : `Buy $${item.price}`;
        btn.addEventListener('click', () => {
            if (item.id == selectedItemId) return
            socket.emit('buyCharacter', item.id)
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
    const leaveButton = document.getElementById('leaveButton')
    if (menu == false || select == false || waiting == false) return;
    if (leaveButton != false) leaveButton.classList.toggle('hidden', start == false)
    if (view == 'none') {
        menu.classList.add('hidden');
        return;
    }
    menu.classList.remove('hidden');
    select.classList.toggle('hidden', view != 'select');
    waiting.classList.toggle('hidden', view != 'waiting');
    if (settingsPanel != false) settingsPanel.classList.toggle('hidden', view != 'settings');
    if (shopPanel != false) shopPanel.classList.toggle('hidden', view != 'shop');
}
function draw() {
    if (ctx == false || canvas == false) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.translate(0, -camera.y)

    for (var id in players) {
        var p = players[id]
        var self = id == myId && me
        var x = self ? me.x : p.x
        var y = self ? me.y : p.y
        var ok = self ? me.alive : p.alive != false
        var color = self ? (me.color || 'rgb(0, 255, 0)') : (p.color || 'rgb(255, 255, 255)')
        ctx.fillStyle = ok ? color : 'rgba(120, 120, 120, 0.4)'
        ctx.fillRect(x, y, 20, 20)
    }

    plats.forEach((p) => {
        var color = p.type == 'solid' ? 'rgb(139, 69, 19)' : 'rgb(34, 139, 34)'
        if (p.type == 'boost') color = 'rgb(0, 150, 255)'
        ctx.fillStyle = color
        ctx.fillRect(p.x, p.y, p.width, p.height)
    })
    ctx.restore()

    if (me != false && me.alive == false) {
        ctx.save()
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.fillStyle = 'white'
        ctx.font = 'bold 36px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('You Died', canvas.width / 2, canvas.height / 2)
        ctx.restore()
    }
    if (spec == true) {
        ctx.save()
        ctx.fillStyle = 'white'
        ctx.font = 'bold 16px sans-serif'
        ctx.textAlign = 'left'
        ctx.fillText(`Spectating ${room || ''}`, 10, 24)
        ctx.restore()
    }
}
function update(timestamp) {
    var dt = 1 / 60
    if (last != false) {
        dt = (timestamp - last) / 1000
        dt = Math.min(dt, 0.1)
    }
    last = timestamp
    if (me != false) {
        me.update(dt)
        if (players[myId] != false) {
            players[myId].x = me.x
            players[myId].y = me.y
            players[myId].color = me.color
            players[myId].alive = me.alive
        }
    }
    alive = getAlive()
    cameraU(dt)
    draw()
    requestAnimationFrame(update);
}
function loopStart() {
    if (start == true && (me != false || spec == true) && lstart == false) {
        lstart = true;
        requestAnimationFrame(update);
    }
}
window.onload = () => {
    canvas = document.getElementById('gameCanvas')
    if (canvas != false) {
        ctx = canvas.getContext('2d')
        canvas.width = camera.width
        canvas.height = camera.height
    }
    const joinButton = document.getElementById('joinButton')
    if (joinButton != false) joinButton.addEventListener('click', join)
    const settingsButton = document.getElementById('settingsButton')
    if (settingsButton != false) settingsButton.addEventListener('click', () => { renderSettings(); view('settings') })
    const shopButton = document.getElementById('shopButton')
    if (shopButton != false) shopButton.addEventListener('click', () => { renderShop(); view('shop') })
    const settingsBackButton = document.getElementById('settingsBackButton')
    if (settingsBackButton != false) settingsBackButton.addEventListener('click', () => view('select'))
    const shopBackButton = document.getElementById('shopBackButton')
    if (shopBackButton != false) shopBackButton.addEventListener('click', () => view('select'))
    const leaveButton = document.getElementById('leaveButton')
    if (leaveButton != false) leaveButton.addEventListener('click', leave)
    updateMoneyHud()
    view('select')
}