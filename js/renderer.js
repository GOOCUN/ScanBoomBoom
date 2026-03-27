// ============================================
// renderer.js — Canvas 渲染 & 动画系统
// ============================================

class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.dpr = window.devicePixelRatio || 1;
        this.board = null;

        // 布局
        this.cellSize = 0;
        this.gap = 3;
        this.boardW = 0;
        this.boardH = 0;

        // 动画队列
        this.reveals = [];    // { x, y, start, delay, dur }
        this.explosion = null; // { x, y, start, dur }
        this.shakeEnd = 0;

        // 桌面悬停
        this.hoverCell = null;

        // 配色（极简科技风）
        this.C = {
            hidden:   '#21262D',
            hover:    '#30363D',
            revealed: '#161B22',
            border:   '#30363D',
            mine:     '#F85149',
            num: [
                null,
                '#58A6FF', // 1 蓝
                '#3FB950', // 2 绿
                '#F85149', // 3 红
                '#BC8CFF', // 4 紫
                '#F0883E', // 5 橙
                '#79C0FF', // 6 浅蓝
                '#F0F6FC', // 7 白
                '#8B949E', // 8 灰
            ],
        };
    }

    setBoard(board) {
        this.board = board;
        this.reveals = [];
        this.explosion = null;
        this.shakeEnd = 0;
        this.canvas.style.transform = '';
        this.resize();
    }

    resize() {
        if (!this.board) return;
        this.dpr = window.devicePixelRatio || 1;

        const maxW = Math.min(window.innerWidth - 32, 420);
        const maxH = window.innerHeight * 0.6;
        const cols = this.board.width;
        const rows = this.board.height;

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

    /** 像素坐标 → 棋盘格坐标 */
    hitTest(px, py) {
        if (!this.board) return null;
        const step = this.cellSize + this.gap;
        const x = (px / step) | 0;
        const y = (py / step) | 0;
        if (x < 0 || x >= this.board.width || y < 0 || y >= this.board.height) return null;
        // 精确判断是否在格子内（排除间隙）
        const lx = px - x * step;
        const ly = py - y * step;
        if (lx > this.cellSize || ly > this.cellSize) return null;
        return { x, y };
    }

    // ==================== 动画触发 ====================

    animateReveal(cells) {
        const now = performance.now();
        for (const { x, y, dist } of cells) {
            this.reveals.push({ x, y, start: now, delay: dist * 40, dur: 200 });
        }
    }

    animateExplosion(x, y) {
        this.explosion = { x, y, start: performance.now(), dur: 300 };
        // 屏幕震动（通过 CSS transform 避免 canvas 裁切问题）
        this.shakeEnd = performance.now() + 200;
    }

    animateRevealMines(mines) {
        const now = performance.now();
        for (let i = 0; i < mines.length; i++) {
            this.reveals.push({ x: mines[i].x, y: mines[i].y, start: now, delay: i * 60, dur: 200 });
        }
    }

    // ==================== 主绘制 ====================

    draw(now) {
        const ctx = this.ctx;
        const board = this.board;
        if (!board) return;

        // DPR 变换
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, this.boardW, this.boardH);

        // CSS 震动
        if (now < this.shakeEnd) {
            const t = 1 - (this.shakeEnd - now) / 200;
            const decay = 1 - t;
            const sx = Math.sin(now * 0.05) * 6 * decay;
            const sy = Math.cos(now * 0.07) * 6 * decay;
            this.canvas.style.transform = `translate(${sx}px,${sy}px)`;
        } else if (this.canvas.style.transform) {
            this.canvas.style.transform = '';
        }

        // 构建动画查找表
        const animMap = new Map();
        const done = [];
        for (let i = 0; i < this.reveals.length; i++) {
            const a = this.reveals[i];
            const t = this._progress(a, now);
            if (t >= 1) { done.push(i); continue; }
            animMap.set(a.x * 100 + a.y, t); // 简化 key
        }
        for (let i = done.length - 1; i >= 0; i--) this.reveals.splice(done[i], 1);

        // 绘制格子
        for (let y = 0; y < board.height; y++) {
            for (let x = 0; x < board.width; x++) {
                const c = board.cell(x, y);
                const px = x * (this.cellSize + this.gap);
                const py = y * (this.cellSize + this.gap);
                const animT = animMap.get(x * 100 + y);

                if (!c.revealed) {
                    // 未翻开
                    this._drawHidden(ctx, px, py, x, y);
                } else if (animT !== undefined && animT >= 0) {
                    // 翻开动画中
                    const ease = this._easeOutBack(animT);
                    this._drawHidden(ctx, px, py, x, y);
                    ctx.save();
                    ctx.globalAlpha = Math.min(animT * 2.5, 1);
                    const cx = px + this.cellSize / 2;
                    const cy = py + this.cellSize / 2;
                    ctx.translate(cx, cy);
                    ctx.scale(ease, ease);
                    ctx.translate(-cx, -cy);
                    this._drawRevealed(ctx, px, py, c);
                    ctx.restore();
                } else if (animT !== undefined) {
                    // 等待波纹到达（delay 未过）
                    this._drawHidden(ctx, px, py, x, y);
                } else {
                    // 完全翻开
                    this._drawRevealed(ctx, px, py, c);
                }

                // 爆炸闪光叠加
                if (this.explosion && this.explosion.x === x && this.explosion.y === y) {
                    const t = this._progress(this.explosion, now);
                    if (t >= 0 && t < 1) {
                        ctx.save();
                        ctx.globalAlpha = 0.7 * (1 - t);
                        ctx.fillStyle = this.C.mine;
                        this._roundRect(ctx, px - 2, py - 2, this.cellSize + 4, this.cellSize + 4, 6);
                        ctx.fill();
                        ctx.restore();
                    } else if (t >= 1) {
                        this.explosion = null;
                    }
                }
            }
        }
    }

    // ==================== 私有绘制方法 ====================

    _drawHidden(ctx, px, py, x, y) {
        const hover = this.hoverCell && this.hoverCell.x === x && this.hoverCell.y === y;
        ctx.fillStyle = hover ? this.C.hover : this.C.hidden;
        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
        ctx.fill();
    }

    _drawRevealed(ctx, px, py, cell) {
        // 背景
        ctx.fillStyle = this.C.revealed;
        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
        ctx.fill();

        // 细边框
        ctx.strokeStyle = this.C.border;
        ctx.lineWidth = 0.5;
        this._roundRect(ctx, px, py, this.cellSize, this.cellSize, 4);
        ctx.stroke();

        const cx = px + this.cellSize / 2;
        const cy = py + this.cellSize / 2;

        if (cell.mine) {
            // 雷：红色圆形
            ctx.fillStyle = this.C.mine;
            ctx.beginPath();
            ctx.arc(cx, cy, this.cellSize * 0.22, 0, Math.PI * 2);
            ctx.fill();
        } else if (cell.adj > 0) {
            // 数字
            const fs = (this.cellSize * 0.48) | 0;
            ctx.font = `700 ${fs}px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = this.C.num[cell.adj] || this.C.num[8];
            ctx.fillText(String(cell.adj), cx, cy + 1);
        }
    }

    _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ==================== 工具函数 ====================

    _progress(anim, now) {
        const elapsed = now - anim.start - (anim.delay || 0);
        if (elapsed < 0) return -1;
        return Math.min(elapsed / anim.dur, 1);
    }

    _easeOutBack(t) {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
}
