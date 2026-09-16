(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory()
    } else {
        root.col = factory()
    }
}(typeof self !== 'undefined' ? self : this, function () {
    class col {
        static checkAABB(a, b) {
            return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
        }
        static passThrough(entity, platform) {
            const box = entity.getHitbox()

            if (this.checkAABB(box, platform) == true) {
                const isFalling = entity.jump > 0
                const feet = box.y + box.height
                const above = (feet - entity.jump) <= platform.y + 4

                if (isFalling && above) {
                    entity.y = platform.y - entity.hitbox.offsetY - entity.hitbox.height
                    return true
                }
            }
            return false
        }
        static solid(entity, platform) {
            const box = entity.getHitbox()
            if (this.checkAABB(box, platform) == false) return false

            if (platform.type === 'boost') {
                entity.jumpPower = 10
                entity.jumpHeight = 8
            }

            const overlapX = Math.min(box.x + box.width, platform.x + platform.width) - Math.max(box.x, platform.x);
            const overlapY = Math.min(box.y + box.height, platform.y + platform.height) - Math.max(box.y, platform.y);

            if (platform.type == 'wall') {
                if (box.x < platform.x + platform.width / 2) {
                    entity.x -= overlapX
                } else {
                    entity.x += overlapX
                }
                entity.speed = 0
                return true
            }

            if (overlapX < overlapY) {
                if (box.x + box.width / 2 < platform.x + platform.width / 2) {
                    entity.x -= overlapX;
                } else {
                    entity.x += overlapX;
                }
                entity.speed = 0;
            } else {
                if (box.y + box.height / 2 < platform.y + platform.height / 2) {
                    entity.y -= overlapY;
                } else {
                    entity.y += overlapY;
                    entity.jump = 0;
                }
            }

            if (platform.type !== 'boost' && entity.jumpPower != false) {
                entity.jumpPower = entity.jumpHeight || 5;
            }
            return true;
        }
    }
    return col;
}));