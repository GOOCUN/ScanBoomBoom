// ============================================
// renderer.js — Canvas 渲染 + 动画 + 飘分 + 标旗 + 胜利特效
// ============================================

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.board = null;

        this.cellSize = 0;
        this.gap = 3;
        this.boardW = 0;
        this.boardH = 0;

        // 动画队列
        this.reveals = [];
        this.explosion = null;
        this.shakeEnd = 0;
        this.shakeDur = 200;
        this.shakeAmp = 6;

        // 胜利翻金动画
        this.victoryAnim = null; // { start, dur }

        // 勇气奖励动画
        this.courageAnim = null;

        // 超时全屏红闪
        this.timeoutFlash = null;

        // 桌面悬停
        this.hoverCell = null;

        // 标旗模式视觉
        this.flagMode = false;

        // 小丑雷回退动画
        this.jokerReverts = [];
        this.jokerFlash = null;

        // 岩浆雷溅射动画
        this.magmaSplashes = [];
        this.magmaFlash = null;

        // 时间紧张呼吸光晕
        this.timeWarning = false;

        // 脏标记：有动画或状态变化时需要重绘
        this.dirty = true;

        // 无伤通关特效
        this.noDmgAnim = null;

        // 配色
        this.C = {
            hidden:   '#2A313A',
            hiddenLit:'#343D48',
            hiddenShd:'#1B2028',
            hover:    '#3A4450',
            revealed: '#131920',
            border:   '#3A4450',
            mine:     '#F85149',
            flag:     '#F0883E',
            flagBg:   '#2D1F0E',
            gold:     '#F0C040',
            num: [null,'#58A6FF','#3FB950','#F85149','#BC8CFF','#F0883E','#79C0FF','#F0F6FC','#8B949E'],
        };
    }

    setBoard(board) {
        this.board = board;
        this.reveals = [];
        this.explosion = null;
        this.shakeEnd = 0;
        this.shakeDur = 200;
        this.shakeAmp = 6;
        this.victoryAnim = null;
        this.courageAnim = null;
        this.timeoutFlash = null;
        this.jokerReverts = [];
        this.jokerFlash = null;
        this.magmaSplashes = [];
        this.magmaFlash = null;
        this.timeWarning = false;
        this.noDmgAnim = null;
        this.dirty = true;
        this.canvas.style.transform = '';
        this.resize();
    }

    resize() {
        if (!this.board) return;
        this.dpr = window.devicePixelRatio || 1;
        const maxW = Math.min(window.innerWidth - 32, 420);
        const maxH = window.innerHeight * 0.65;
        const cols = this.board.width, rows = this.board.height;
        const fromW = (maxW - (cols - 1) * this.gap) / cols;
        const fromH = (maxH - (rows - 1) * this.gap) / rows;
        this.cellSize = Math.floor(Math.min(fromW, fromH));
        this.boardW = cols * this.cellSize + (cols - 1) * this.gap;
        this.boardH = rows * this.cellSize + (rows - 1) * this.gap;
        this.canvas.style.width = this.boardW + 'px';
        this.canvas.style.height = this.boardH + 'px';
        this.canvas.width = this.boardW * this.dpr;
        this.canvas.height = this.boardH * this.dpr;
    }

    hitTest(px, py) {
        if (!this.board) return null;
        const step = this.cellSize + this.gap;
        const x = (px / step) | 0, y = (py / step) | 0;
        if (x < 0 || x >= this.board.width || y < 0 || y >= this.board.height) return null;
        if (px - x * step > this.cellSize || py - y * step > this.cellSize) return null;
        return { x, y };
    }

    /** 获取格子的画布中心像素坐标 */
    cellCenter(x, y) {
        const step = this.cellSize + this.gap;
        return { px: x * step + this.cellSize / 2, py: y * step + this.cellSize / 2 };
    }

    // ==================== 动画触发 ====================

    animateReveal(cells) {
        const now = performance.now();
        for (const { x, y, dist } of cells)
            this.reveals.push({ x, y, start: now, delay: dist * 40, dur: 200 });
        this.dirty = true;
    }

    animateExplosion(x, y, color) {
        this.explosion = { x, y, start: performance.now(), dur: 300, color: color || this.C.mine };
        this.shakeEnd = performance.now() + 200;
        this.shakeDur = 200;
        this.shakeAmp = 6;
        this.dirty = true;
    }

    animateRevealMines(mines) {
        const now = performance.now();
        for (let i = 0; i < mines.length; i++)
            this.reveals.push({ x: mines[i].x, y: mines[i].y, start: now, delay: i * 60, dur: 200 });
        this.dirty = true;
    }

    /** 时间到：依次翻出所有雷 + 每颗雷爆炸 + 强震 */
    animateTimeoutExplosion(mines) {
        const now = performance.now();
        // 快速依次翻出
        for (let i = 0; i < mines.length; i++) {
            this.reveals.push({ x: mines[i].x, y: mines[i].y, start: now, delay: i * 80, dur: 150 });
        }
        // 全部翻出后集体爆炸闪红 + 强震
        const totalDelay = mines.length * 80 + 200;
        this.timeoutFlash = { start: now + totalDelay, dur: 600 };
        this.shakeEnd = now + totalDelay + 600;
        this.shakeDur = 600;
        this.shakeAmp = 14;
    }

    animateVictory() {
        this.victoryAnim = { start: performance.now(), dur: 800 };
    }

    animateNoDamage() {
        this.noDmgAnim = { start: performance.now(), dur: 1200 };
    }

    animateCourage(intensity) {
        // intensity: 0 = light (no anim), 1 = medium, 2 = strong
        intensity = intensity || 1;
        const dur = intensity >= 2 ? 2000 : 1200;
        const amp = intensity >= 2 ? 16 : 8;
        this.courageAnim = { start: performance.now(), dur };
        this.shakeEnd = performance.now() + Math.min(dur, 800);
        this.shakeDur = Math.min(dur, 800);
        this.shakeAmp = amp;
    }

    animateJokerRevert(cells) {
        const now = performance.now();
        this.jokerReverts = [];
        for (let i = 0; i < cells.length; i++) {
            this.jokerReverts.push({
                x: cells[i].x, y: cells[i].y,
                start: now + 300,
                delay: Math.random() * 400,
                dur: 400
            });
        }
        this.jokerFlash = { start: now + 300, dur: 800 };
        this.shakeEnd = now + 800;
        this.shakeDur = 800;
        this.shakeAmp = 10;
    }

    animateMagmaSplash(ox, oy, cells) {
        const now = performance.now();
        this.magmaSplashes = [];
        for (let i = 0; i < cells.length; i++) {
            this.magmaSplashes.push({
                x: cells[i].x, y: cells[i].y,
                mine: cells[i].mine,
                start: now + 200,
                delay: i * 100,
                dur: 400
            });
            // 溅射翻开动画
            this.reveals.push({
                x: cells[i].x, y: cells[i].y,
                start: now + 200,
                delay: i * 100,
                dur: 250
            });
        }
        this.magmaFlash = { start: now + 200, dur: 800 };
        this.shakeEnd = Math.max(this.shakeEnd, now + 600);
        this.shakeDur = 600;
        this.shakeAmp = Math.max(this.shakeAmp, 10);
    }

    // ==================== 主绘制 ====================

    draw(now) {
        const ctx = this.ctx, board = this.board;
        if (!board) return;

        // 检查是否有活跃动画
        const hasAnim = this.reveals.length > 0 || this.explosion ||
            now < this.shakeEnd || this.victoryAnim || this.courageAnim ||
            this.timeoutFlash || this.jokerReverts.length > 0 || this.jokerFlash ||
            this.magmaSplashes.length > 0 || this.magmaFlash || this.timeWarning ||
            this.noDmgAnim;

        if (!this.dirty && !hasAnim) return;
        this.dirty = false;

        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.boardW, this.boardH);

        // 震动（衰减：从强到弱）
        if (now < this.shakeEnd) {
            const t = (this.shakeEnd - now) / this.shakeDur;
            const amp = this.shakeAmp * t;
            const sx = Math.sin(now * 0.05) * amp;
            const sy = Math.cos(now * 0.07) * amp;
            this.canvas.style.transform = `translate(${sx}px,${sy}px)`;
        } else if (this.canvas.style.transform) {
            this.canvas.style.transform = '';
        }

        // 动画查找表
        const animMap = new Map();
        const done = [];
        for (let i = 0; i < this.reveals.length; i++) {
            const a = this.reveals[i], t = this._progress(a, now);
            if (t >= 1) { done.push(i); continue; }
            animMap.set(a.x * 1000 + a.y, t);
        }
        for (let i = done.length - 1; i >= 0; i--) this.reveals.splice(done[i], 1);

        // 胜利翻金进度
        let victoryT = -1;
        if (this.victoryAnim) {
            victoryT = (now - this.victoryAnim.start) / this.victoryAnim.dur;
            if (victoryT >= 1) victoryT = 1;
        }

        // 绘制格子
        for (let y = 0; y < board.height; y++) {
            for (let x = 0; x < board.width; x++) {
                const c = board.cell(x, y);
                const px = x * (this.cellSize + this.gap);
                const py = y * (this.cellSize + this.gap);
                const animT = animMap.get(x * 1000 + y);

                if (!c.revealed && !c.flagged) {
                    this._drawHidden(ctx, px, py, x, y);
                } else if (c.flagged && !c.revealed) {
                    this._drawFlagged(ctx, px, py);
                } else if (animT !== undefined && animT >= 0) {
                    // 3D 翻牌效果：前半收窄（隐藏面），后半展开（显示内容）
                    if (animT < 0.5) {
                        // 前半：隐藏面缩窄
                        const flipT = animT / 0.5; // 0→1
                        const scaleX = 1 - flipT;  // 1→0
                        ctx.save();
                        const ccx = px + this.cellSize / 2;
                        ctx.translate(ccx, 0);
                        ctx.scale(Math.max(0.02, scaleX), 1);
                        ctx.translate(-ccx, 0);
                        this._drawHidden(ctx, px, py, x, y);
                        ctx.restore();
                    } else {
                        // 后半：内容面展开
                        const flipT = (animT - 0.5) / 0.5; // 0→1
                        const scaleX = flipT; // 0→1
                        ctx.save();
                        const ccx = px + this.cellSize / 2;
                        ctx.translate(ccx, 0);
                        ctx.scale(Math.max(0.02, scaleX), 1);
                        ctx.translate(-ccx, 0);
                        this._drawRevealed(ctx, px, py, c);
                        ctx.restore();
                    }
                } else if (animT !== undefined) {
                    this._drawHidden(ctx, px, py, x, y);
                } else {
                    this._drawRevealed(ctx, px, py, c);
                }

                // 胜利翻金叠加
                if (victoryT >= 0 && c.revealed && !c.mine) {
                    const cellDelay = (x + y) / (board.width + board.height);
                    const localT = Math.max(0, Math.min(1, (victoryT - cellDelay * 0.5) / 0.5));
                    if (localT > 0) {
                        ctx.save();
                        ctx.globalAlpha = 0.3 * Math.sin(localT * Math.PI);
                        ctx.fillStyle = this.C.gold;
                        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
                        ctx.fill();
                        ctx.restore();
                    }
                }

                // 爆炸闪光
                if (this.explosion && this.explosion.x === x && this.explosion.y === y) {
                    const t = this._progress(this.explosion, now);
                    if (t >= 0 && t < 1) {
                        ctx.save();
                        ctx.globalAlpha = 0.7 * (1 - t);
                        ctx.fillStyle = this.explosion.color || this.C.mine;
                        this._roundRect(ctx, px - 2, py - 2, this.cellSize + 4, this.cellSize + 4, 6);
                        ctx.fill();
                        ctx.restore();
                    } else if (t >= 1) this.explosion = null;
                }
            }
        }

        // 勇气奖励全屏金色脉冲
        if (this.courageAnim) {
            const t = (now - this.courageAnim.start) / this.courageAnim.dur;
            if (t < 1) {
                ctx.save();
                const pulse = Math.sin(t * Math.PI * 6) * 0.25 + 0.15;
                ctx.globalAlpha = pulse * (1 - t * t);
                ctx.fillStyle = '#FFD700';
                ctx.fillRect(0, 0, this.boardW, this.boardH);
                ctx.restore();
            } else {
                this.courageAnim = null;
            }
        }

        // 超时全屏红闪
        if (this.timeoutFlash) {
            const t = (now - this.timeoutFlash.start) / this.timeoutFlash.dur;
            if (t >= 0 && t < 1) {
                ctx.save();
                const pulse = Math.sin(t * Math.PI * 3) * 0.35;
                ctx.globalAlpha = Math.max(0, pulse * (1 - t));
                ctx.fillStyle = '#F85149';
                ctx.fillRect(0, 0, this.boardW, this.boardH);
                ctx.restore();
            } else if (t >= 1) {
                this.timeoutFlash = null;
            }
        }

        // 小丑雷回退紫色闪光（每格）
        for (let i = this.jokerReverts.length - 1; i >= 0; i--) {
            const a = this.jokerReverts[i];
            const t = this._progress(a, now);
            if (t >= 1) { this.jokerReverts.splice(i, 1); continue; }
            if (t < 0) continue;
            const rpx = a.x * (this.cellSize + this.gap);
            const rpy = a.y * (this.cellSize + this.gap);
            ctx.save();
            ctx.globalAlpha = 0.5 * Math.sin(t * Math.PI);
            ctx.fillStyle = '#BC8CFF';
            this._roundRect(ctx, rpx, rpy, this.cellSize, this.cellSize, 4);
            ctx.fill();
            ctx.restore();
        }

        // 小丑雷全屏紫色脉冲
        if (this.jokerFlash) {
            const t = (now - this.jokerFlash.start) / this.jokerFlash.dur;
            if (t >= 0 && t < 1) {
                ctx.save();
                ctx.globalAlpha = 0.2 * (1 - t);
                ctx.fillStyle = '#BC8CFF';
                ctx.fillRect(0, 0, this.boardW, this.boardH);
                ctx.restore();
            } else if (t >= 1) {
                this.jokerFlash = null;
            }
        }

        // 岩浆雷溅射橙色闪光（每格）
        for (let i = this.magmaSplashes.length - 1; i >= 0; i--) {
            const a = this.magmaSplashes[i];
            const t = this._progress(a, now);
            if (t >= 1) { this.magmaSplashes.splice(i, 1); continue; }
            if (t < 0) continue;
            const rpx = a.x * (this.cellSize + this.gap);
            const rpy = a.y * (this.cellSize + this.gap);
            ctx.save();
            ctx.globalAlpha = 0.6 * Math.sin(t * Math.PI);
            ctx.fillStyle = a.mine ? '#F85149' : '#F0883E';
            this._roundRect(ctx, rpx, rpy, this.cellSize, this.cellSize, 4);
            ctx.fill();
            ctx.restore();
        }

        // 岩浆雷全屏橙色脉冲
        if (this.magmaFlash) {
            const t = (now - this.magmaFlash.start) / this.magmaFlash.dur;
            if (t >= 0 && t < 1) {
                ctx.save();
                ctx.globalAlpha = 0.2 * (1 - t);
                ctx.fillStyle = '#F0883E';
                ctx.fillRect(0, 0, this.boardW, this.boardH);
                ctx.restore();
            } else if (t >= 1) {
                this.magmaFlash = null;
            }
        }

        // 时间紧张呼吸光晕（≤10s 红色脉冲边缘）
        if (this.timeWarning) {
            ctx.save();
            const pulse = Math.sin(now * 0.004) * 0.5 + 0.5; // 0~1 oscillation
            const alpha = 0.12 + pulse * 0.18;
            const grad = ctx.createRadialGradient(
                this.boardW / 2, this.boardH / 2, Math.min(this.boardW, this.boardH) * 0.35,
                this.boardW / 2, this.boardH / 2, Math.max(this.boardW, this.boardH) * 0.7
            );
            grad.addColorStop(0, 'rgba(248,81,73,0)');
            grad.addColorStop(1, `rgba(248,81,73,${alpha})`);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, this.boardW, this.boardH);
            ctx.restore();
        }

        // 无伤通关金色波纹 + 盾牌
        if (this.noDmgAnim) {
            const t = (now - this.noDmgAnim.start) / this.noDmgAnim.dur;
            if (t >= 0 && t < 1) {
                ctx.save();
                // 金色波纹从中心向外扩散
                const waveR = t * Math.max(this.boardW, this.boardH) * 0.8;
                const waveAlpha = 0.35 * (1 - t);
                const waveGrad = ctx.createRadialGradient(
                    this.boardW / 2, this.boardH / 2, Math.max(0, waveR - 30),
                    this.boardW / 2, this.boardH / 2, waveR
                );
                waveGrad.addColorStop(0, 'rgba(240,192,64,0)');
                waveGrad.addColorStop(0.5, `rgba(240,192,64,${waveAlpha})`);
                waveGrad.addColorStop(1, 'rgba(240,192,64,0)');
                ctx.fillStyle = waveGrad;
                ctx.fillRect(0, 0, this.boardW, this.boardH);

                // 中央盾牌图标
                if (t < 0.7) {
                    const shieldAlpha = t < 0.15 ? t / 0.15 : (0.7 - t) / 0.55;
                    const shieldSize = (Math.min(this.boardW, this.boardH) * 0.25) | 0;
                    ctx.globalAlpha = shieldAlpha * 0.9;
                    ctx.font = `${shieldSize}px serif`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🛡️', this.boardW / 2, this.boardH / 2);
                }
                ctx.restore();
            } else if (t >= 1) {
                this.noDmgAnim = null;
            }
        }
    }

    // ==================== 绘制方法 ====================

    _drawHidden(ctx, px, py, x, y) {
        const hover = this.hoverCell && this.hoverCell.x === x && this.hoverCell.y === y;
        const s = this.cellSize;
        // 主体
        ctx.fillStyle = hover
            ? (this.flagMode ? '#3D2A10' : this.C.hover)
            : this.C.hidden;
        this._roundRect(ctx, px, py, s, s, 4);
        ctx.fill();
        // 3D 高光（左上亮边）
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = this.C.hiddenLit;
        ctx.fillRect(px + 2, py + 1, s - 4, 2);
        ctx.fillRect(px + 1, py + 2, 2, s - 4);
        // 3D 阴影（右下暗边）
        ctx.fillStyle = this.C.hiddenShd;
        ctx.fillRect(px + 2, py + s - 3, s - 4, 2);
        ctx.fillRect(px + s - 3, py + 2, 2, s - 4);
        ctx.restore();
    }

    _drawFlagged(ctx, px, py) {
        ctx.fillStyle = this.C.flagBg;
        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
        ctx.fill();
        const cx = px + this.cellSize / 2, cy = py + this.cellSize / 2;
        const fs = (this.cellSize * 0.45) | 0;
        ctx.font = `${fs}px serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🚩', cx, cy + 1);
    }

    _drawRevealed(ctx, px, py, cell) {
        ctx.fillStyle = this.C.revealed;
        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
        ctx.fill();
        // 内陷阴影（顶部暗线）
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#000';
        ctx.fillRect(px + 2, py + 1, this.cellSize - 4, 1.5);
        ctx.fillRect(px + 1, py + 2, 1.5, this.cellSize - 4);
        ctx.restore();

        const cx = px + this.cellSize / 2, cy = py + this.cellSize / 2;
        if (cell.mine) {
            ctx.fillStyle = cell.magma ? '#F0883E' : cell.blue ? '#58A6FF' : this.C.mine;
            ctx.beginPath();
            ctx.arc(cx, cy, this.cellSize * 0.22, 0, Math.PI * 2);
            ctx.fill();
        } else if (cell.adj > 0) {
            const fs = (this.cellSize * 0.48) | 0;
            ctx.font = `700 ${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = this.C.num[cell.adj] || this.C.num[8];
            ctx.fillText(String(cell.adj), cx, cy + 1);
        }
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    _progress(anim, now) {
        const elapsed = now - anim.start - (anim.delay || 0);
        if (elapsed < 0) return -1;
        return Math.min(elapsed / anim.dur, 1);
    }

    _easeOutBack(t) {
        const c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
}
