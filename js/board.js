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
        this.forceUnsolvable = false;
        this.blueMineRatio = 0;
        this._initCells();
    }

    _initCells() {
        this.cells = new Array(this.width * this.height);
        for (let i = 0; i < this.cells.length; i++) {
            this.cells[i] = {
                x: i % this.width,
                y: (i / this.width) | 0,
                mine: false, blue: false, adj: 0,
                revealed: false, flagged: false,
            };
        }
    }

    cell(x, y) {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
        return this.cells[y * this.width + x];
    }

    /** 首次点击后生成棋盘 */
    generate(safeX, safeY) {
        const MAX_ATTEMPTS = 100;
        let bestAttempt = null;
        let bestScore = -1;  // 普通模式：最高可解率；赌徒模式：最接近0.55

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            this._initCells();
            this.revealedSafe = 0;
            this._placeMines(safeX, safeY, this.seed + attempt);
            this._calcAdjacent();
            const solved = this._solveCount(safeX, safeY);
            const ratio = solved / this.totalSafe;

            if (this.forceUnsolvable) {
                // 赌徒模式：要求 40%~70% 可解（半可解棋盘）
                if (ratio >= 0.4 && ratio <= 0.7) {
                    this.generated = true;
                    this.seed = this.seed + attempt;
                    if (this.blueMineRatio > 0) this._assignBlueMines();
                    return;
                }
                // 记录最接近目标区间的尝试
                const score = -Math.abs(ratio - 0.55);
                if (ratio < 1.0 && score > bestScore) {
                    bestScore = score;
                    bestAttempt = attempt;
                }
            } else {
                // 普通模式：要求完全可解
                if (ratio >= 1.0) {
                    this.generated = true;
                    this.seed = this.seed + attempt;
                    if (this.blueMineRatio > 0) this._assignBlueMines();
                    return;
                }
                // 记录可解率最高的尝试作为回退
                if (ratio > bestScore) {
                    bestScore = ratio;
                    bestAttempt = attempt;
                }
            }
        }

        // 回退：用最佳尝试重新生成
        if (bestAttempt !== null) {
            this._initCells();
            this.revealedSafe = 0;
            this._placeMines(safeX, safeY, this.seed + bestAttempt);
            this._calcAdjacent();
            this.seed = this.seed + bestAttempt;
        }
        this.generated = true;
        if (this.blueMineRatio > 0) this._assignBlueMines();
    }

    _assignBlueMines() {
        const mines = this.cells.filter(c => c.mine);
        const blueCount = Math.max(1, Math.round(mines.length * this.blueMineRatio));
        // Fisher-Yates shuffle
        for (let i = mines.length - 1; i > 0; i--) {
            const j = Math.random() * (i + 1) | 0;
            [mines[i], mines[j]] = [mines[j], mines[i]];
        }
        for (let i = 0; i < blueCount; i++) mines[i].blue = true;
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

    /**
     * 通用约束求解器，返回能推理出的安全格数量
     * @param {Uint8Array} state - 0=未知, 1=已翻开, 2=标雷
     * @param {boolean} earlyExit - true 时找到第一个安全格即返回
     * @param {boolean} useSubset - 是否启用子集约束推理（较慢但更强）
     */
    _constraintSolve(state, earlyExit, useSubset) {
        const w = this.width, h = this.height, total = w * h;
        const isMine = i => this.cells[i].mine;
        let revealed = 0;
        const revealQueue = [];

        const revealCell = (i) => {
            if (state[i] !== 0 || isMine(i)) return;
            state[i] = 1;
            revealed++;
            if (this.cells[i].adj === 0) {
                const x = i % w, y = (i / w) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            const ni = ny * w + nx;
                            if (state[ni] === 0) revealQueue.push(ni);
                        }
                    }
                }
            }
        };

        while (revealQueue.length > 0) revealCell(revealQueue.shift());

        const getConstraint = (i) => {
            const x = i % w, y = (i / w) | 0;
            let unknowns = [], flags = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                    const ni = ny * w + nx;
                    if (state[ni] === 0) unknowns.push(ni);
                    else if (state[ni] === 2) flags++;
                }
            }
            return { unknowns, flags, mines: this.cells[i].adj - flags };
        };

        let changed = true;
        while (changed) {
            changed = false;

            // 规则 1 & 2：基础单格约束
            for (let i = 0; i < total; i++) {
                if (state[i] !== 1 || this.cells[i].adj <= 0) continue;
                const c = getConstraint(i);
                if (c.unknowns.length === 0) continue;

                if (c.mines === c.unknowns.length) {
                    for (const ni of c.unknowns) {
                        if (state[ni] === 0) { state[ni] = 2; changed = true; }
                    }
                }
                if (c.mines === 0 && c.unknowns.length > 0) {
                    for (const ni of c.unknowns) revealQueue.push(ni);
                    while (revealQueue.length > 0) {
                        revealCell(revealQueue.shift());
                        changed = true;
                    }
                    if (earlyExit && revealed > 0) return revealed;
                }
            }

            if (changed || !useSubset) continue;

            // 规则 3：子集约束（仅比较距离≤2的格对，远距离不可能共享未知邻居）
            for (let i = 0; i < total; i++) {
                if (state[i] !== 1 || this.cells[i].adj <= 0) continue;
                const cA = getConstraint(i);
                if (cA.unknowns.length === 0) continue;
                const xi = i % w, yi = (i / w) | 0;
                const setA = new Set(cA.unknowns);

                // 只检查距离 ≤ 2 范围内的格
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        if (!dx && !dy) continue;
                        const nx = xi + dx, ny = yi + dy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        const j = ny * w + nx;
                        if (j <= i) continue; // 避免重复比较
                        if (state[j] !== 1 || this.cells[j].adj <= 0) continue;
                        const cB = getConstraint(j);
                        if (cB.unknowns.length === 0) continue;

                        const setB = new Set(cB.unknowns);
                        // 尝试 A ⊂ B 和 B ⊂ A
                        for (const [sub, sup, subC, supC] of [
                            [setA, setB, cA, cB],
                            [setB, setA, cB, cA],
                        ]) {
                            if (sub.size >= sup.size) continue;
                            let isSubset = true;
                            for (const v of sub) { if (!sup.has(v)) { isSubset = false; break; } }
                            if (!isSubset) continue;

                            const diff = [];
                            for (const v of sup) { if (!sub.has(v)) diff.push(v); }
                            const diffMines = supC.mines - subC.mines;

                            if (diffMines === diff.length) {
                                for (const ni of diff) {
                                    if (state[ni] === 0) { state[ni] = 2; changed = true; }
                                }
                            } else if (diffMines === 0) {
                                for (const ni of diff) revealQueue.push(ni);
                                while (revealQueue.length > 0) {
                                    revealCell(revealQueue.shift());
                                    changed = true;
                                }
                                if (earlyExit && revealed > 0) return revealed;
                            }
                        }
                        if (changed) break;
                    }
                    if (changed) break;
                }
                if (changed) break;
            }
        }

        return revealed;
    }

    /** 检查从 (safeX, safeY) 开始能纯逻辑解出多少安全格，返回已解出数量 */
    _solveCount(safeX, safeY) {
        const w = this.width, total = w * this.height;
        const state = new Uint8Array(total);
        const startIdx = safeY * w + safeX;
        // 先模拟首次点击的 BFS
        const queue = [startIdx];
        let initRevealed = 0;
        const revealInit = (i) => {
            if (state[i] !== 0 || this.cells[i].mine) return;
            state[i] = 1;
            initRevealed++;
            if (this.cells[i].adj === 0) {
                const x = i % w, y = (i / w) | 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < this.height) {
                            const ni = ny * w + nx;
                            if (state[ni] === 0) queue.push(ni);
                        }
                    }
                }
            }
        };
        while (queue.length > 0) revealInit(queue.shift());

        return initRevealed + this._constraintSolve(state, false, false);
    }

    _isSolvable(safeX, safeY) {
        return this._solveCount(safeX, safeY) >= this.totalSafe;
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

    /** 检查当前局面是否存在可通过逻辑推导确定的安全格 */
    hasSafeMove() {
        // 缓存：同一 revealedSafe 数不重复计算
        if (this._safeCache === this.revealedSafe) return this._safeCacheResult;

        const w = this.width, total = w * this.height;
        const state = new Uint8Array(total);
        for (let i = 0; i < total; i++) {
            const c = this.cells[i];
            if (c.revealed) state[i] = c.mine ? 2 : 1;
            else if (c.flagged) state[i] = 2;
        }

        const found = this._constraintSolve(state, true, true) > 0;
        this._safeCache = this.revealedSafe;
        this._safeCacheResult = found;
        return found;
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
