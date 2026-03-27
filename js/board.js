// ============================================
// board.js — 棋盘逻辑 & 种子生成
// ============================================

/**
 * Mulberry32 — 种子驱动伪随机数生成器
 * 相同种子产生相同序列（同图比分的基础）
 */
class SeededRandom {
    constructor(seed) {
        this.s = seed | 0;
    }
    next() {
        this.s = (this.s + 0x6D2B79F5) | 0;
        let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

/**
 * Board — 扫雷棋盘核心逻辑
 */
class Board {
    constructor(width, height, mineCount, seed) {
        this.width = width;
        this.height = height;
        this.mineCount = mineCount;
        this.seed = seed;
        this.generated = false;
        this.revealedSafe = 0;
        this.totalSafe = width * height - mineCount;

        this.cells = new Array(width * height);
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = {
                x: i % width,
                y: (i / width) | 0,
                mine: false,
                adj: 0,
                revealed: false,
                flagged: false,
            };
        }
    }

    cell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
        return this.cells[y * this.width + x];
    }

    /** 首次点击后生成棋盘，保证 3×3 安全区 */
    generate(safeX, safeY) {
        const rng = new SeededRandom(this.seed);

        // 收集可放雷位置（排除安全区）
        const cands = [];
        for (let i = 0; i < this.cells.length; i++) {
            const c = this.cells[i];
            if (Math.abs(c.x - safeX) <= 1 && Math.abs(c.y - safeY) <= 1) continue;
            cands.push(i);
        }

        // Fisher-Yates 洗牌
        for (let i = cands.length - 1; i > 0; i--) {
            const j = (rng.next() * (i + 1)) | 0;
            [cands[i], cands[j]] = [cands[j], cands[i]];
        }

        // 放雷
        const n = Math.min(this.mineCount, cands.length);
        for (let i = 0; i < n; i++) this.cells[cands[i]].mine = true;

        // 计算邻接数
        for (const c of this.cells) {
            if (c.mine) continue;
            let count = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nb = this.cell(c.x + dx, c.y + dy);
                    if (nb && nb.mine) count++;
                }
            }
            c.adj = count;
        }

        this.generated = true;
    }

    /**
     * 翻开格子。首次调用自动生成棋盘。
     * 返回: { type:'mine', x, y } | { type:'reveal', cells:[{x,y,dist}] } | null
     */
    reveal(x, y) {
        if (!this.generated) this.generate(x, y);

        const c = this.cell(x, y);
        if (!c || c.revealed || c.flagged) return null;

        // 踩雷
        if (c.mine) {
            c.revealed = true;
            return { type: 'mine', x, y };
        }

        // BFS 连锁展开
        const result = [];
        const queue = [{ x, y, dist: 0 }];
        const visited = new Set([`${x},${y}`]);

        while (queue.length > 0) {
            const cur = queue.shift();
            const cell = this.cell(cur.x, cur.y);
            if (cell.revealed) continue;

            cell.revealed = true;
            this.revealedSafe++;
            result.push({ x: cur.x, y: cur.y, dist: cur.dist });

            if (cell.adj === 0) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = cur.x + dx, ny = cur.y + dy;
                        const key = `${nx},${ny}`;
                        if (visited.has(key)) continue;
                        const nb = this.cell(nx, ny);
                        if (!nb || nb.revealed || nb.flagged || nb.mine) continue;
                        visited.add(key);
                        queue.push({ x: nx, y: ny, dist: cur.dist + 1 });
                    }
                }
            }
        }

        return { type: 'reveal', cells: result };
    }

    /** 揭示所有未翻开的雷（游戏结束时） */
    revealMines() {
        const mines = [];
        for (const c of this.cells) {
            if (c.mine && !c.revealed) {
                c.revealed = true;
                mines.push({ x: c.x, y: c.y, dist: 0 });
            }
        }
        return mines;
    }

    isComplete() {
        return this.revealedSafe >= this.totalSafe;
    }
}
