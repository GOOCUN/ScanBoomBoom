// ============================================
// board.js — 棋盘逻辑 + 种子生成 + 求解器
// ============================================

class SeededRandom {
    constructor(seed) { this.s = seed | 0; }
    next() {
        this.s = (this.s + 0x6D2B79F5) | 0;
        let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

class Board {
    constructor(width, height, mineCount, seed) {
        this.width = width;
        this.height = height;
        this.mineCount = mineCount;
        this.seed = seed;
        this.generated = false;
        this.revealedSafe = 0;
        this.totalSafe = width * height - mineCount;
        this._initCells();
    }

    _initCells() {
        this.cells = new Array(this.width * this.height);
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = {
                x: i % this.width,
                y: (i / this.width) | 0,
                mine: false, adj: 0,
                revealed: false, flagged: false,
            };
        }
    }

    cell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
        return this.cells[y * this.width + x];
    }

    /** 首次点击后生成棋盘（保证有解） */
    generate(safeX, safeY) {
        const MAX_ATTEMPTS = 50;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            this._initCells();
            this.revealedSafe = 0;
            this._placeMines(safeX, safeY, this.seed + attempt);
            this._calcAdjacent();
            if (this._isSolvable(safeX, safeY)) {
                this.generated = true;
                this.seed = this.seed + attempt; // 记录实际使用的种子
                return;
            }
        }
        // 兜底：使用最后一次生成（极罕见）
        this.generated = true;
    }

    _placeMines(safeX, safeY, seed) {
        const rng = new SeededRandom(seed);
        const cands = [];
        for (let i = 0; i < this.cells.length; i++) {
            const c = this.cells[i];
            if (Math.abs(c.x - safeX) <= 1 && Math.abs(c.y - safeY) <= 1) continue;
            cands.push(i);
        }
        for (let i = cands.length - 1; i > 0; i--) {
            const j = (rng.next() * (i + 1)) | 0;
            [cands[i], cands[j]] = [cands[j], cands[i]];
        }
        const n = Math.min(this.mineCount, cands.length);
        for (let i = 0; i < n; i++) this.cells[cands[i]].mine = true;
    }

    _calcAdjacent() {
        for (const c of this.cells) {
            if (c.mine) { c.adj = -1; continue; }
            let count = 0;
            this._neighbors(c.x, c.y, nb => { if (nb.mine) count++; });
            c.adj = count;
        }
    }

    _neighbors(x, y, fn) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue;
                const nb = this.cell(x + dx, y + dy);
                if (nb) fn(nb);
            }
        }
    }

    // ==================== 逻辑求解器 ====================
    /** 检查从 (safeX, safeY) 开始是否能纯逻辑解出所有安全格 */
    _isSolvable(safeX, safeY) {
        const w = this.width, h = this.height, total = w * h;
        // 模拟状态：0=未知, 1=已翻开, 2=标记为雷
        const state = new Uint8Array(total);
        const adj = new Int8Array(total);
        for (let i = 0; i < total; i++) adj[i] = this.cells[i].adj;
        const isMine = i => this.cells[i].mine;
        const idx = (x, y) => y * w + x;

        // BFS 翻开 (safeX, safeY) 的连锁
        const revealQueue = [idx(safeX, safeY)];
        let revealed = 0;

        const revealCell = (i) => {
            if (state[i] !== 0 || isMine(i)) return;
            state[i] = 1;
            revealed++;
            if (adj[i] === 0) {
                const x = i % w, y = (i / w) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            const ni = idx(nx, ny);
                            if (state[ni] === 0) revealQueue.push(ni);
                        }
                    }
                }
            }
        };

        while (revealQueue.length > 0) revealCell(revealQueue.shift());

        // 迭代逻辑推导
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < total; i++) {
                if (state[i] !== 1 || adj[i] <= 0) continue;
                const x = i % w, y = (i / w) | 0;
                let unknowns = [], flags = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        const ni = idx(nx, ny);
                        if (state[ni] === 0) unknowns.push(ni);
                        else if (state[ni] === 2) flags++;
                    }
                }
                if (unknowns.length === 0) continue;

                // 规则1：剩余雷数 == 未知数 → 全是雷
                if (adj[i] - flags === unknowns.length) {
                    for (const ni of unknowns) {
                        if (state[ni] === 0) { state[ni] = 2; changed = true; }
                    }
                }
                // 规则2：已标够雷 → 未知格全安全
                if (adj[i] === flags && unknowns.length > 0) {
                    for (const ni of unknowns) revealQueue.push(ni);
                    while (revealQueue.length > 0) {
                        revealCell(revealQueue.shift());
                        changed = true;
                    }
                }
            }
        }

        return revealed >= this.totalSafe;
    }

    // ==================== 游戏操作 ====================

    reveal(x, y) {
        if (!this.generated) this.generate(x, y);
        const c = this.cell(x, y);
        if (!c || c.revealed || c.flagged) return null;

        if (c.mine) {
            c.revealed = true;
            return { type: 'mine', x, y };
        }

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

    toggleFlag(x, y) {
        const c = this.cell(x, y);
        if (!c || c.revealed) return false;
        c.flagged = !c.flagged;
        return true;
    }

    /** chord 操作：双击已翻开数字格，如果周围旗子数==adj，自动翻开其余 */
    chord(x, y) {
        const c = this.cell(x, y);
        if (!c || !c.revealed || c.adj <= 0) return null;

        let flags = 0;
        this._neighbors(x, y, nb => { if (nb.flagged) flags++; });
        if (flags !== c.adj) return null;

        // 翻开周围所有未标记未翻开格
        const results = { reveals: [], mines: [] };
        this._neighbors(x, y, nb => {
            if (nb.revealed || nb.flagged) return;
            const r = this.reveal(nb.x, nb.y);
            if (r) {
                if (r.type === 'mine') results.mines.push(r);
                else results.reveals.push(...r.cells);
            }
        });
        return (results.reveals.length > 0 || results.mines.length > 0) ? results : null;
    }

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
