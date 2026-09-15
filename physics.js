(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.col = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    class col {
        static checkAABB(a, b) {
            return a.x < b.x + b.width &&
                   a.x + a.width > b.x &&
                   a.y < b.y + b.height &&
                   a.y + a.height > b.y;
        }
        static resolvePass(entity, platform) {
            const box = entity.getHitbox();

            if (this.checkAABB(box, platform)) {
                const isFalling = entity.jump > 0;
                const feet = box.y + box.height;
                const wasAboveBefore = (feet - entity.jump) <= platform.y + 4;

                if (isFalling && wasAboveBefore) {
                    entity.y = platform.y - entity.hitbox.offsetY - entity.hitbox.height;
                    return true;
                }
            }
            return false;
        }
        static resolveSolid(entity, platform) {
            const box = entity.getHitbox();
            if (!this.checkAABB(box, platform)) return false;

            if (platform.type === 'boost') {
                entity.jumpPower = 8;
            }

            const overlapX = Math.min(box.x + box.width, platform.x + platform.width) - Math.max(box.x, platform.x);
            const overlapY = Math.min(box.y + box.height, platform.y + platform.height) - Math.max(box.y, platform.y);

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
            return true;
        }
    }
    return col;
}));