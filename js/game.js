// ============================================
// game.js — 游戏控制器（关卡递进 + Combo + 标旗 + 飘分 + 回血 + 记录）
// ============================================

// ==================== 关卡配置 ====================
function getLevelConfig(level) {
    // 平缓曲线：普通人10~15关卡住，高手可冲25+
    if (level <= 3)  return { w: 6, h: 6, mines: 3 + level,     time: 60 };
    if (level <= 7)  return { w: 6, h: 6, mines: 5 + level - 3, time: 60 };
    if (level <= 12) return { w: 7, h: 7, mines: 7 + level - 7, time: 55 };
    if (level <= 17) return { w: 7, h: 7, mines: 9 + level - 11,time: 55 };
    if (level <= 22) return { w: 8, h: 8, mines: 11 + level - 16, time: 50 };
    // 23+ 无限递增
    return { w: 8, h: 8, mines: Math.min(16 + (level - 22), 22), time: 45 };
}

// ==================== 存档 ====================
const STORAGE_KEY = 'neuromines_records';
function loadRecords() {
    try {
        const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return d || { bestLevel: 0, bestScore: 0 };
    } catch { return { bestLevel: 0, bestScore: 0 }; }
}
function saveRecords(records) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
}

// ==================== 飘分系统 ====================
class FloatManager {
    constructor(container) {
        this.container = container;
    }
    spawn(text, x, y, color) {
        const el = document.createElement('div');
        el.className = 'float-num';
        el.textContent = text;
        el.style.left = x + 'px';
        el.style.top = y + 'px';
        if (color) el.style.color = color;
        this.container.appendChild(el);
        el.addEventListener('animationend', () => el.remove());
    }
}

// ==================== 主游戏 ====================
class Game {
    constructor() {
        this.canvas = document.getElementById('board');
        this.renderer = new Renderer(this.canvas);
        this.floats = new FloatManager(document.getElementById('floats'));

        this.MAX_LIVES = 3;

        // 持久状态（跨关卡）
        this.level = 1;
        this.totalScore = 0;
        this.lives = this.MAX_LIVES;
        this.combo = 0;
        this.records = loadRecords();

        // 单关状态
        this.state = 'idle';
        this.board = null;
        this.time = 0;
        this.lastTick = 0;
        this.levelScore = 0;

        // 标旗模式
        this.flagMode = false;

        // UI
        this.el = {
            lives:     document.getElementById('lives'),
            level:     document.getElementById('level'),
            timer:     document.getElementById('timer'),
            score:     document.getElementById('score'),
            hint:      document.getElementById('hint'),
            comboText: document.getElementById('comboText'),
            flagBtn:   document.getElementById('flagBtn'),
            overlay:   document.getElementById('overlay'),
            title:     document.getElementById('overlayTitle'),
            oScore:    document.getElementById('overlayScore'),
            msg:       document.getElementById('overlayMsg'),
            record:    document.getElementById('overlayRecord'),
            nextBtn:   document.getElementById('nextBtn'),
            restart:   document.getElementById('restartBtn'),
        };

        this.audioCtx = null;

        this._setupInput();
        this._startLevel();
        this._loop();
    }

    // ==================== 输入 ====================

    _setupInput() {
        let touched = false;
        let lastClickTime = 0;
        let lastClickPos = null;

        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault(); touched = true;
        }, { passive: false });

        this.canvas.addEventListener('touchend', e => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (!t) return;
            const r = this.canvas.getBoundingClientRect();
            const px = t.clientX - r.left, py = t.clientY - r.top;
            const now = Date.now();
            const pos = this.renderer.hitTest(px, py);

            // 双击检测（chord操作）
            if (pos && lastClickPos && pos.x === lastClickPos.x && pos.y === lastClickPos.y && now - lastClickTime < 350) {
                this._onDoubleClick(pos);
                lastClickPos = null;
            } else {
                this._onClick(px, py);
                lastClickPos = pos;
                lastClickTime = now;
            }
            setTimeout(() => { touched = false; }, 300);
        }, { passive: false });

        this.canvas.addEventListener('click', e => {
            if (touched) return;
            const r = this.canvas.getBoundingClientRect();
            const px = e.clientX - r.left, py = e.clientY - r.top;
            const now = Date.now();
            const pos = this.renderer.hitTest(px, py);

            if (pos && lastClickPos && pos.x === lastClickPos.x && pos.y === lastClickPos.y && now - lastClickTime < 350) {
                this._onDoubleClick(pos);
                lastClickPos = null;
            } else {
                this._onClick(px, py);
                lastClickPos = pos;
                lastClickTime = now;
            }
        });

        // 右键标旗（桌面端）
        this.canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (this.state === 'ended') return;
            const r = this.canvas.getBoundingClientRect();
            const pos = this.renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
            if (pos) this._doFlag(pos);
        });

        this.canvas.addEventListener('mousemove', e => {
            const r = this.canvas.getBoundingClientRect();
            this.renderer.hoverCell = this.renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
        });
        this.canvas.addEventListener('mouseleave', () => { this.renderer.hoverCell = null; });

        window.addEventListener('resize', () => this.renderer.resize());

        // 标旗模式切换
        this.el.flagBtn.addEventListener('click', () => {
            this.flagMode = !this.flagMode;
            this.el.flagBtn.textContent = this.flagMode ? '🚩' : '⛏️';
            this.el.flagBtn.classList.toggle('active', this.flagMode);
            this.renderer.flagMode = this.flagMode;
        });

        this.el.nextBtn.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level++;
            this._startLevel();
        });

        this.el.restart.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level = 1;
            this.totalScore = 0;
            this.lives = this.MAX_LIVES;
            this.combo = 0;
            this._startLevel();
        });
    }

    // ==================== 关卡控制 ====================

    _startLevel() {
        const cfg = getLevelConfig(this.level);
        const seed = Date.now() ^ ((Math.random() * 0xFFFFFFFF) | 0);
        this.board = new Board(cfg.w, cfg.h, cfg.mines, seed);
        this.renderer.setBoard(this.board);

        this.time = cfg.time;
        this.state = 'idle';
        this.lastTick = 0;
        this.levelScore = 0;

        // 重置标旗模式
        this.flagMode = false;
        this.el.flagBtn.textContent = '⛏️';
        this.el.flagBtn.classList.remove('active');
        this.renderer.flagMode = false;

        this._uiAll();
        this.el.hint.textContent = `第${this.level}关 · 点击开始`;
        this.el.hint.classList.remove('hidden');
        this.el.overlay.classList.remove('active');
    }

    _onClick(px, py) {
        if (this.state === 'ended') return;
        const pos = this.renderer.hitTest(px, py);
        if (!pos) return;

        if (this.state === 'idle') {
            this.state = 'playing';
            this.lastTick = performance.now();
            this.el.hint.classList.add('hidden');
            this._initAudio();
        }

        if (this.flagMode) {
            this._doFlag(pos);
            return;
        }

        this._doReveal(pos);
    }

    _doFlag(pos) {
        if (this.state !== 'playing' && this.state !== 'idle') return;
        if (this.state === 'idle') {
            this.state = 'playing';
            this.lastTick = performance.now();
            this.el.hint.classList.add('hidden');
        }
        const ok = this.board.toggleFlag(pos.x, pos.y);
        if (ok && this.flagMode) {
            // 标完自动切回挖掘模式
            this.flagMode = false;
            this.el.flagBtn.textContent = '⛏️';
            this.el.flagBtn.classList.remove('active');
            this.renderer.flagMode = false;
        }
    }

    _doReveal(pos) {
        const c = this.board.cell(pos.x, pos.y);
        if (!c) return;

        // 如果点击已翻开的数字格 → chord
        if (c.revealed && c.adj > 0) {
            this._onDoubleClick(pos);
            return;
        }

        const result = this.board.reveal(pos.x, pos.y);
        if (!result) return;

        if (result.type === 'mine') {
            this._onMine(result);
        } else {
            this._onSafeReveal(result.cells);
        }
    }

    _onDoubleClick(pos) {
        if (this.state !== 'playing') return;
        const result = this.board.chord(pos.x, pos.y);
        if (!result) return;

        if (result.reveals.length > 0) this._onSafeReveal(result.reveals);
        for (const m of result.mines) this._onMine(m);
    }

    _onMine(result) {
        this.lives--;
        this.combo = 0;
        const penalty = 50;
        this.totalScore = Math.max(0, this.totalScore - penalty);

        this._uiLives();
        this._uiScore();
        this._uiCombo();

        this.renderer.animateReveal([{ x: result.x, y: result.y, dist: 0 }]);
        this.renderer.animateExplosion(result.x, result.y);
        this._playSound('boom');

        // 飘扣分
        const { px, py } = this._boardToFloat(result.x, result.y);
        this.floats.spawn(`-${penalty}`, px, py, '#F85149');

        if (this.lives <= 0) this._endGame('dead');
    }

    _onSafeReveal(cells) {
        const n = cells.length;
        // Combo 倍率
        this.combo += n;
        const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
        const points = (n * 10 + Math.max(0, n - 1) * 5) * mult;
        this.levelScore += points;
        this.totalScore += points;

        this._uiScore();
        this._uiCombo();

        this.renderer.animateReveal(cells);
        this._playSound('pop', n);

        // 飘分
        const mid = cells[Math.floor(cells.length / 2)];
        const { px, py } = this._boardToFloat(mid.x, mid.y);
        const color = mult >= 3 ? '#F0C040' : mult >= 2 ? '#3FB950' : '#58A6FF';
        const prefix = mult > 1 ? `×${mult} ` : '';
        this.floats.spawn(`${prefix}+${points}`, px, py, color);

        if (this.board.isComplete()) {
            const timeBonus = Math.ceil(this.time) * 10;
            this.totalScore += timeBonus;
            this.levelScore += timeBonus;
            this._uiScore();
            this._endGame('win');
        }
    }

    _boardToFloat(cellX, cellY) {
        const cr = this.canvas.getBoundingClientRect();
        const fc = document.getElementById('floats').getBoundingClientRect();
        const { px, py } = this.renderer.cellCenter(cellX, cellY);
        return { px: cr.left - fc.left + px, py: cr.top - fc.top + py };
    }

    _endGame(reason) {
        this.state = 'ended';

        const isWin = reason === 'win';

        if (isWin) {
            // 回血（上限3）
            this.lives = Math.min(this.MAX_LIVES, this.lives + 1);
            this._uiLives();
            this.renderer.animateVictory();
            this._playSound('win');
        } else {
            const mines = this.board.revealMines();
            if (mines.length > 0) this.renderer.animateRevealMines(mines);
        }

        // 更新记录
        let isNewRecord = false;
        const reachedLevel = isWin ? this.level + 1 : this.level;
        if (reachedLevel > this.records.bestLevel || this.totalScore > this.records.bestScore) {
            this.records.bestLevel = Math.max(this.records.bestLevel, reachedLevel);
            this.records.bestScore = Math.max(this.records.bestScore, this.totalScore);
            saveRecords(this.records);
            isNewRecord = true;
        }

        // 结算 UI
        const delay = isWin ? 900 : 600;
        setTimeout(() => {
            if (isWin) {
                this.el.title.textContent = '🎉 通关！';
                this.el.msg.textContent = `第${this.level}关完成 · 时间奖励 +${Math.ceil(this.time) * 10} · 回复1❤️`;
                this.el.nextBtn.classList.remove('hidden');
                this.el.restart.textContent = '重新开始';
            } else {
                this.el.title.textContent = reason === 'time' ? '⏰ 时间到' : '💥 游戏结束';
                this.el.msg.textContent = `到达第${this.level}关`;
                this.el.nextBtn.classList.add('hidden');
                this.el.restart.textContent = '再来一次';
            }
            this.el.oScore.textContent = this.totalScore;
            this.el.record.textContent = isNewRecord
                ? '🏆 新纪录！'
                : `最高: 第${this.records.bestLevel}关 · ${this.records.bestScore}分`;
            this.el.record.classList.toggle('new-record', isNewRecord);
            this.el.overlay.classList.add('active');
        }, delay);
    }

    // ==================== UI ====================

    _uiAll() {
        this._uiLives(); this._uiScore(); this._uiTimer(); this._uiLevel(); this._uiCombo();
    }

    _uiLives() {
        this.el.lives.textContent = '❤️'.repeat(this.lives) + '🖤'.repeat(this.MAX_LIVES - this.lives);
    }

    _uiLevel() {
        this.el.level.textContent = `第${this.level}关`;
    }

    _uiTimer() {
        const s = Math.max(0, Math.ceil(this.time));
        const m = (s / 60) | 0, sec = s % 60;
        this.el.timer.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        this.el.timer.classList.toggle('urgent', this.time <= 10 && this.state === 'playing');
    }

    _uiScore() {
        this.el.score.textContent = this.totalScore;
        this.el.score.classList.remove('score-bump');
        void this.el.score.offsetWidth;
        this.el.score.classList.add('score-bump');
    }

    _uiCombo() {
        if (this.combo >= 3) {
            const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
            this.el.comboText.textContent = `×${this.combo} Combo${mult > 1 ? ` · ${mult}倍` : ''}`;
            this.el.comboText.classList.add('active');
            this.el.comboText.classList.toggle('hot', mult >= 2);
            this.el.comboText.classList.toggle('fire', mult >= 3);
        } else {
            this.el.comboText.classList.remove('active', 'hot', 'fire');
        }
    }

    // ==================== 音效 ====================

    _initAudio() {
        if (this.audioCtx) return;
        try { this.audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }

    _playSound(type, count) {
        this._initAudio();
        const ctx = this.audioCtx;
        if (!ctx) return;
        const t = ctx.currentTime;

        if (type === 'pop') {
            const n = Math.min(count || 1, 15);
            for (let i = 0; i < n; i++) {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = 600 + i * 80 + this.combo * 8;
                const s = t + i * 0.03;
                g.gain.setValueAtTime(0.06, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.07);
                osc.start(s); osc.stop(s + 0.09);
            }
        } else if (type === 'boom') {
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, t);
            osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
            g.gain.setValueAtTime(0.15, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            osc.start(t); osc.stop(t + 0.35);
        } else if (type === 'win') {
            // 胜利和弦：C-E-G-C 上行
            [523, 659, 784, 1047].forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const s = t + i * 0.12;
                g.gain.setValueAtTime(0.08, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.35);
                osc.start(s); osc.stop(s + 0.4);
            });
        }
    }

    // ==================== 主循环 ====================

    _loop() {
        const tick = (now) => {
            if (this.state === 'playing') {
                const dt = Math.min((now - this.lastTick) / 1000, 0.1);
                this.lastTick = now;
                this.time -= dt;
                this._uiTimer();
                if (this.time <= 0) {
                    this.time = 0;
                    this._endGame('time');
                }
            }
            this.renderer.draw(now);
            requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    }
}

new Game();
