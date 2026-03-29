// ============================================
// game.js — 游戏控制器
// 关卡递进 + Combo + 标旗 + 飘分 + 回血 + 记录
// + 速推时间奖励 + 暂停 + 勇气奖励
// ============================================

// ==================== 关卡配置 ====================
// 雷密度保底 ≥17%，避免首击连锁铺满全图
function getLevelConfig(level) {
    if (level <= 3)  return { w: 6, h: 6, mines: 5 + level               };  // 6,7,8   → 17-22%
    if (level <= 7)  return { w: 6, h: 6, mines: 5 + level               };  // 9,10,11,12 → 25-33%
    if (level <= 12) return { w: 7, h: 7, mines: 3 + level               };  // 11,12,13,14,15 → 22-31%
    if (level <= 17) return { w: 7, h: 7, mines: Math.min(2 + level, 18) };  // 15,16,17,18,18 → 31-37%
    if (level <= 22) return { w: 8, h: 8, mines: level - 1               };  // 17,18,19,20,21 → 27-33%
    return { w: 8, h: 8, mines: Math.min(level - 2, 24)                  };  // 21→24  → 33-38%
}

const BASE_TIME = 60; // 所有关卡统一60秒

// 链式时间奖励（弱化：只有大片翻开才给）
function getChainTimeBonus(chainLen) {
    if (chainLen >= 5) return 2;
    return 0;
}

// 速推奖励配置（按关卡阶段收紧）
function getRushTiers(level) {
    if (level <= 7)  return [ { steps: 4, window: 10, bonus: 4, label: '速推!' }, { steps: 6, window: 8, bonus: 6, label: '极速!!' } ];
    if (level <= 14) return [ { steps: 4, window: 8,  bonus: 3, label: '速推!' }, { steps: 6, window: 7, bonus: 5, label: '极速!!' } ];
    if (level <= 22) return [ { steps: 4, window: 7,  bonus: 3, label: '速推!' }, { steps: 6, window: 5, bonus: 5, label: '极速!!' } ];
    return                  [ { steps: 4, window: 6,  bonus: 2, label: '速推!' }, { steps: 6, window: 4, bonus: 4, label: '极速!!' } ];
}

// ==================== 修饰器定义 ====================
const MODIFIERS = {
    chill:   { icon: '🤔', name: '优柔寡断', desc: '时间+100%，得分-30%',        mult: 0.7, always: true },
    allIn:   { icon: '🔥', name: '孤注一掷', desc: '生命值=1',              mult: 1.6 },
    rush:    { icon: '⏱️', name: '争分夺秒', desc: '时间缩短20%',           mult: 1.3 },
    noFlag:  { icon: '🚫', name: '盲扫大师', desc: '无法标旗',              mult: 1.3 },
    gambler: { icon: '🎰', name: '赌徒本能', desc: '本局必出死棋',          mult: 1.3 },
};

// 蓝雷比例（按关卡）
function getBlueMineRatio(level) {
    if (level < 6) return 0;
    if (level <= 10) return 0.3;
    return 0.5;
}

// 蓝雷扣时比例（按关卡递增）
function getBlueTimePenalty(level) {
    if (level <= 10) return 1 / 4;
    if (level <= 17) return 1 / 3;
    return 1 / 2;
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
    spawn(text, x, y, color, big) {
        const el = document.createElement('div');
        el.className = 'float-num' + (big ? ' float-big' : '');
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
        this.courageCnt = 0; // 本轮对局勇气时刻次数
        this.records = loadRecords();

        // 单关状态
        this.state = 'idle'; // idle | playing | paused | courage | ended
        this.board = null;
        this.time = 0;
        this.maxTime = 60;
        this.lastTick = 0;
        this.levelScore = 0;

        // 标旗模式
        this.flagMode = false;

        // 速推系统
        this.rushClicks = []; // timestamps of consecutive safe clicks

        // 修饰器系统
        this.activeMods = new Set(); // 当前激活的修饰器 key
        this.scoreMult = 1;          // 总得分倍率
        this.hitMines = 0;           // 本关踩雷次数（无伤通关检测）
        this.noDmgBonus = 0;         // 无伤通关加分

        // UI 引用
        this.el = {
            lives:          document.getElementById('lives'),
            level:          document.getElementById('level'),
            timer:          document.getElementById('timer'),
            score:          document.getElementById('score'),
            hint:           document.getElementById('hint'),
            comboText:      document.getElementById('comboText'),
            flagBtn:        document.getElementById('flagBtn'),
            pauseBtn:       document.getElementById('pauseBtn'),
            pauseOverlay:   document.getElementById('pauseOverlay'),
            resumeBtn:      document.getElementById('resumeBtn'),
            courageOverlay: document.getElementById('courageOverlay'),
            courageScore:   document.getElementById('courageScore'),
            courageTime:    document.getElementById('courageTime'),
            courageParticles: document.getElementById('courageParticles'),
            rushBar:        document.getElementById('rushBar'),
            rushPips:       document.querySelectorAll('.rush-pip'),
            rushLabel:      document.getElementById('rushLabel'),
            overlay:        document.getElementById('overlay'),
            title:          document.getElementById('overlayTitle'),
            oScore:         document.getElementById('overlayScore'),
            msg:            document.getElementById('overlayMsg'),
            record:         document.getElementById('overlayRecord'),
            nextBtn:        document.getElementById('nextBtn'),
            restart:        document.getElementById('restartBtn'),
            modOverlay:     document.getElementById('modifierOverlay'),
            modList:        document.getElementById('modifierList'),
            modMult:        document.getElementById('modifierMult'),
            modLevel:       document.getElementById('modifierLevel'),
            modStartBtn:    document.getElementById('modifierStartBtn'),
            modSkipBtn:     document.getElementById('modifierSkipBtn'),
            aboutBtn:       document.getElementById('aboutBtn'),
            aboutOverlay:   document.getElementById('aboutOverlay'),
            aboutCloseBtn:  document.getElementById('aboutCloseBtn'),
        };

        this.audioCtx = null;

        this._setupInput();
        this._showModifierSelection();
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

        // 右键标旗
        this.canvas.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (this.state === 'ended' || this.state === 'paused' || this.state === 'courage') return;
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

        // 暂停 / 继续
        this.el.pauseBtn.addEventListener('click', () => this._togglePause());
        this.el.resumeBtn.addEventListener('click', () => this._togglePause());

        // 关于按钮
        this.el.aboutBtn.addEventListener('click', () => this._toggleAbout());
        this.el.aboutCloseBtn.addEventListener('click', () => this._toggleAbout());

        // 结算按钮
        this.el.nextBtn.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level++;
            this._showModifierSelection();
        });

        this.el.restart.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level = 1;
            this.totalScore = 0;
            this.lives = this.MAX_LIVES;
            this.combo = 0;
            this.courageCnt = 0;
            this._showModifierSelection();
        });

        // 修饰器选择
        this.el.modStartBtn.addEventListener('click', () => this._confirmModifiers());
        this.el.modSkipBtn.addEventListener('click', () => {
            this.activeMods.clear();
            this._confirmModifiers();
        });

    }

    // ==================== 修饰器选择 ====================

    _showModifierSelection() {
        this.activeMods.clear();
        this.scoreMult = 1;
        this.el.modLevel.textContent = `第${this.level}关`;
        this.el.modMult.textContent = '×1.0';

        // 优柔寡断始终展示 + 随机抽3个其他修饰器
        const allKeys = Object.keys(MODIFIERS);
        const alwaysKeys = allKeys.filter(k => MODIFIERS[k].always);
        const poolKeys = allKeys.filter(k => !MODIFIERS[k].always);
        for (let i = poolKeys.length - 1; i > 0; i--) {
            const j = Math.random() * (i + 1) | 0;
            [poolKeys[i], poolKeys[j]] = [poolKeys[j], poolKeys[i]];
        }
        const shown = [...alwaysKeys, ...poolKeys.slice(0, 3)];

        this.el.modList.innerHTML = '';
        for (const key of shown) {
            const m = MODIFIERS[key];
            const card = document.createElement('div');
            card.className = 'modifier-card';
            card.dataset.mod = key;
            card.innerHTML = `
                <span class="mod-icon">${m.icon}</span>
                <div class="mod-info">
                    <div class="mod-name">${m.name}</div>
                    <div class="mod-desc">${m.desc}</div>
                </div>
                <span class="mod-mult">×${m.mult}</span>`;
            card.addEventListener('click', () => {
                card.classList.toggle('selected');
                if (card.classList.contains('selected')) {
                    this.activeMods.add(key);
                } else {
                    this.activeMods.delete(key);
                }
                this._updateModMult();
            });
            this.el.modList.appendChild(card);
        }

        this.el.modOverlay.classList.add('active');
    }

    _updateModMult() {
        let mult = 1;
        for (const key of this.activeMods) {
            mult *= MODIFIERS[key].mult;
        }
        this.scoreMult = mult;
        this.el.modMult.textContent = `×${mult.toFixed(1)}`;
    }

    _confirmModifiers() {
        this._updateModMult();
        this.el.modOverlay.classList.remove('active');
        this._startLevel();
    }

    // ==================== 暂停 ====================

    _togglePause() {
        if (this.state === 'playing') {
            this.state = 'paused';
            this.el.pauseOverlay.classList.add('active');
            this.el.pauseBtn.textContent = '▶';
        } else if (this.state === 'paused') {
            this.state = 'playing';
            this.lastTick = performance.now(); // 防止计入暂停时间
            this.el.pauseOverlay.classList.remove('active');
            this.el.pauseBtn.textContent = '⏸';
        }
    }

    _toggleAbout() {
        const active = this.el.aboutOverlay.classList.toggle('active');
        if (active && this.state === 'playing') {
            this._prevStateAbout = 'playing';
            this.state = 'paused';
        } else if (!active && this._prevStateAbout) {
            this.state = this._prevStateAbout;
            this.lastTick = performance.now();
            this._prevStateAbout = null;
        }
    }

    // ==================== 关卡控制 ====================

    _startLevel() {
        const cfg = getLevelConfig(this.level);
        const seed = Date.now() ^ ((Math.random() * 0xFFFFFFFF) | 0);
        this.board = new Board(cfg.w, cfg.h, cfg.mines, seed);

        // 蓝雷
        this.board.blueMineRatio = getBlueMineRatio(this.level);

        // 修饰器: 赌徒 → 强制死棋
        if (this.activeMods.has('gambler')) this.board.forceUnsolvable = true;

        this.renderer.setBoard(this.board);

        // 修饰器: 优柔寡断 → 时间+100%
        let timeBase = BASE_TIME;
        if (this.activeMods.has('chill')) timeBase = timeBase * 2;

        // 修饰器: 争分夺秒 → 时间-20%
        if (this.activeMods.has('rush')) timeBase = Math.round(timeBase * 0.8);
        this.time = timeBase;
        this.maxTime = timeBase;

        // 修饰器: 孤注一掷 → 生命=1
        if (this.activeMods.has('allIn')) this.lives = 1;

        this.state = 'idle';
        this.lastTick = 0;
        this.levelScore = 0;
        this.hitMines = 0;
        this.consecutiveCourage = 0;

        // 重置标旗模式
        this.flagMode = false;
        this.el.flagBtn.textContent = '⛏️';
        this.el.flagBtn.classList.remove('active');
        this.renderer.flagMode = false;

        // 修饰器: 盲扫 → 禁用标旗按钮
        if (this.activeMods.has('noFlag')) {
            this.el.flagBtn.disabled = true;
            this.el.flagBtn.style.opacity = '0.3';
        } else {
            this.el.flagBtn.disabled = false;
            this.el.flagBtn.style.opacity = '';
        }

        // 重置暂停按钮
        this.el.pauseBtn.textContent = '⏸';
        this.el.pauseOverlay.classList.remove('active');

        // 重置速推
        this.rushClicks = [];
        this._uiRush();

        this._uiAll();
        const modHint = this.scoreMult > 1 ? ` · ×${this.scoreMult.toFixed(1)}` : '';
        this.el.hint.textContent = `第${this.level}关${modHint} · 点击开始`;
        this.el.hint.classList.remove('hidden');
        this.el.overlay.classList.remove('active');
    }

    // ==================== 点击处理 ====================

    _onClick(px, py) {
        if (this.state === 'ended' || this.state === 'paused' || this.state === 'courage') return;
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
        if (this.activeMods.has('noFlag')) return; // 盲扫模式禁止标旗
        if (this.state === 'idle') {
            this.state = 'playing';
            this.lastTick = performance.now();
            this.el.hint.classList.add('hidden');
        }
        const ok = this.board.toggleFlag(pos.x, pos.y);
        if (ok && this.flagMode) {
            this.flagMode = false;
            this.el.flagBtn.textContent = '⛏️';
            this.el.flagBtn.classList.remove('active');
            this.renderer.flagMode = false;
        }
    }

    _doReveal(pos) {
        const c = this.board.cell(pos.x, pos.y);
        if (!c) return;

        // 点击已翻开数字格 → chord
        if (c.revealed && c.adj > 0) {
            this._onDoubleClick(pos);
            return;
        }

        // ===== 勇气奖励检测（翻开前检查） =====
        const isDeadBoard = this.board.generated && !this.board.hasSafeMove();

        const result = this.board.reveal(pos.x, pos.y);
        if (!result) return;

        if (result.type === 'mine') {
            this._onMine(result);
        } else if (isDeadBoard) {
            this._onCourageReveal(result.cells);
        } else {
            this._onSafeReveal(result.cells);
        }
    }

    _onDoubleClick(pos) {
        if (this.state !== 'playing') return;
        const result = this.board.chord(pos.x, pos.y);
        if (!result) return;
        if (result.reveals.length > 0) this._onSafeReveal(result.reveals);
        for (const m of result.mines) {
            if (this.state !== 'playing') break; // 前一颗雷已结束游戏
            this._onMine(m);
        }
    }

    // ==================== 踩雷 ====================

    _onMine(result) {
        if (this.state !== 'playing') return; // 防止chord多雷重复触发
        this.hitMines++;
        this.combo = 0;
        this.rushClicks = [];
        this._uiRush();

        const cell = this.board.cell(result.x, result.y);
        const isBlue = cell && cell.blue;

        this.renderer.animateReveal([{ x: result.x, y: result.y, dist: 0 }]);

        if (isBlue) {
            // 蓝雷：按关卡扣时间，不扣命
            const timeLoss = Math.ceil(this.time * getBlueTimePenalty(this.level));
            this.time = Math.max(0, this.time - timeLoss);
            this._uiTimer();
            this._uiCombo();

            this.renderer.animateExplosion(result.x, result.y, '#58A6FF');
            this._playSound('blueMine');

            const { px, py } = this._boardToFloat(result.x, result.y);
            this.floats.spawn(`⏱️-${timeLoss}s`, px, py, '#58A6FF');

            if (this.time <= 0) this._endGame('time');
        } else {
            // 红雷：扣命
            this.lives--;
            const penalty = 50;
            this.totalScore = Math.max(0, this.totalScore - penalty);
            this._uiLives();
            this._uiScore();
            this._uiCombo();

            this.renderer.animateExplosion(result.x, result.y);
            this._playSound('boom');

            const { px, py } = this._boardToFloat(result.x, result.y);
            this.floats.spawn(`-${penalty}`, px, py, '#F85149');

            if (this.lives <= 0) this._endGame('dead');
        }
    }

    // ==================== 安全翻开 ====================

    _onSafeReveal(cells) {
        this.consecutiveCourage = 0; // 有推理步骤，重置连续勇气计数
        const n = cells.length;
        this.combo += n;
        const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
        const basePoints = (n * 10 + Math.max(0, n - 1) * 5) * mult;
        const points = Math.round(basePoints * this.scoreMult);
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

        // ===== 链式时间奖励（弱化：只有大片翻开才给） =====
        const chainBonus = getChainTimeBonus(n);
        if (chainBonus > 0) {
            this.time = Math.min(this.time + chainBonus, this.maxTime);
            this._uiTimer();
            this.floats.spawn(`⏰+${chainBonus}s`, px, py - 28, '#79C0FF');
        }

        // ===== 速推时间奖励 =====
        this._rushTick(px, py);

        if (this.board.isComplete()) {
            this._applyWinBonus();
            this._endGame('win');
        }
    }

    // ==================== 胜利加分 ====================

    _applyWinBonus() {
        const tBonus = Math.round(Math.ceil(this.time) * 5 * this.scoreMult);
        this.totalScore += tBonus;
        this.levelScore += tBonus;

        // 无伤通关加成：本关得分 +10%
        if (this.hitMines === 0) {
            const noDmgBonus = Math.round(this.levelScore * 0.1);
            this.totalScore += noDmgBonus;
            this.levelScore += noDmgBonus;
            this.noDmgBonus = noDmgBonus;
        } else {
            this.noDmgBonus = 0;
        }

        this._uiScore();
    }

    // ==================== 勇气奖励 ====================

    _onCourageReveal(cells) {
        const n = cells.length;
        this.combo += n;
        this.courageCnt++;

        const progress = this.board.revealedSafe / this.board.totalSafe;

        // 分数奖励：本关分 × 进度，连续触发递减（中间有推理步骤则重置）
        const decay = Math.pow(0.5, this.consecutiveCourage);
        this.consecutiveCourage++;
        const bonusPoints = Math.round(this.levelScore * progress * decay);
        this.totalScore += bonusPoints;
        this.levelScore += bonusPoints;

        // 生存奖励
        let survivalMsg = '';
        if (progress >= 0.6) {
            // 高进度 → +1命 or 分数
            if (this.lives < this.MAX_LIVES) {
                this.lives++;
                this._uiLives();
                survivalMsg = '❤️ +1生命';
            } else {
                const extraPoints = Math.round(this.levelScore * 0.25);
                this.totalScore += extraPoints;
                this.levelScore += extraPoints;
                survivalMsg = `💰 +${extraPoints}分`;
            }
        } else {
            // 低进度 → 回复时间
            const timeRestore = Math.round(this.maxTime * progress);
            this.time = Math.min(this.time + timeRestore, this.maxTime);
            this._uiTimer();
            survivalMsg = `⏰ +${timeRestore}s`;
        }

        this._uiScore();
        this._uiCombo();

        // 翻开动画
        this.renderer.animateReveal(cells);

        const mid = cells[Math.floor(cells.length / 2)];
        const { px, py } = this._boardToFloat(mid.x, mid.y);

        // 分级反馈
        if (progress >= 0.4) {
            // 中高进度：完整特效
            const intensity = progress >= 0.8 ? 2 : 1;
            this.renderer.animateCourage(intensity);
            this._playSound('courage');
            this.floats.spawn(`🎲 +${bonusPoints}`, px, py, '#FFD700', true);
            setTimeout(() => {
                this.floats.spawn(survivalMsg, px, py - 36, '#79C0FF', true);
            }, 300);
            this.state = 'courage';
            this._showCourageOverlay(bonusPoints, survivalMsg, progress);
        } else {
            // 低进度：轻反馈，不暂停
            this._playSound('pop', 3);
            this.floats.spawn(`🎲 +${bonusPoints}`, px, py, '#F0C040');
            this.floats.spawn(survivalMsg, px, py - 28, '#79C0FF');

            if (this.board.isComplete()) {
                this._applyWinBonus();
                this._endGame('win');
            }
        }
    }

    _showCourageOverlay(bonusPoints, survivalMsg, progress) {
        this.el.courageScore.textContent = `+${bonusPoints}分 · ${survivalMsg}`;
        this.el.courageTime.textContent = progress >= 0.8 ? '🔥 勇气爆发！' : '🎲 勇气奖励';
        if (progress >= 0.6) this._spawnConfetti();
        this.el.courageOverlay.classList.add('active');

        const dur = progress >= 0.6 ? 2500 : 1500;
        setTimeout(() => {
            this.el.courageOverlay.classList.remove('active');
            this.state = 'playing';
            this.lastTick = performance.now();

            if (this.board.isComplete()) {
                this._applyWinBonus();
                this._endGame('win');
            }
        }, dur);
    }

    _spawnConfetti() {
        const container = this.el.courageParticles;
        container.innerHTML = '';
        const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#F0883E', '#BC8CFF', '#FF9A9E'];
        for (let i = 0; i < 50; i++) {
            const p = document.createElement('div');
            p.className = 'confetti';
            p.style.left = '50%';
            p.style.top = '45%';
            p.style.background = colors[(Math.random() * colors.length) | 0];
            const angle = Math.random() * Math.PI * 2;
            const dist = 60 + Math.random() * 200;
            p.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
            p.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
            p.style.animationDelay = (Math.random() * 0.4) + 's';
            // 随机大小
            const size = 5 + Math.random() * 8;
            p.style.width = size + 'px';
            p.style.height = size + 'px';
            p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            container.appendChild(p);
            p.addEventListener('animationend', () => p.remove());
        }
    }



    // ==================== 坐标工具 ====================

    _boardToFloat(cellX, cellY) {
        const cr = this.canvas.getBoundingClientRect();
        const fc = document.getElementById('floats').getBoundingClientRect();
        const { px, py } = this.renderer.cellCenter(cellX, cellY);
        return { px: cr.left - fc.left + px, py: cr.top - fc.top + py };
    }

    // ==================== 结算 ====================

    _endGame(reason) {
        if (this.state === 'ended') return; // 防止重复调用
        this.state = 'ended';
        const isWin = reason === 'win';

        if (isWin) {
            this.lives = Math.min(this.MAX_LIVES, this.lives + 1);
            this._uiLives();
            this.renderer.animateVictory();
            this._playSound('win');
        } else if (reason === 'time') {
            // 时间到：雷依次翻出 + 全屏爆炸
            const mines = this.board.revealMines();
            if (mines.length > 0) this.renderer.animateTimeoutExplosion(mines);
            this._playSound('timeout');
        } else {
            const mines = this.board.revealMines();
            if (mines.length > 0) this.renderer.animateRevealMines(mines);
        }

        let isNewRecord = false;
        const reachedLevel = isWin ? this.level + 1 : this.level;
        if (reachedLevel > this.records.bestLevel || this.totalScore > this.records.bestScore) {
            this.records.bestLevel = Math.max(this.records.bestLevel, reachedLevel);
            this.records.bestScore = Math.max(this.records.bestScore, this.totalScore);
            saveRecords(this.records);
            isNewRecord = true;
        }

        const delay = isWin ? 900 : 600;
        setTimeout(() => {
            if (isWin) {
                this.el.title.textContent = '🎉 通关！';
                const parts = [`第${this.level}关完成`];
                const tBonus = Math.round(Math.ceil(this.time) * 10 * this.scoreMult);
                parts.push(`时间 +${tBonus}`);
                if (this.noDmgBonus > 0) parts.push(`🛡️无伤 +${this.noDmgBonus}`);
                if (this.scoreMult > 1) parts.push(`倍率 ×${this.scoreMult.toFixed(1)}`);
                parts.push('回复1❤️');
                this.el.msg.textContent = parts.join(' · ');
                this.el.nextBtn.classList.remove('hidden');
                this.el.restart.textContent = '重新开始';
            } else {
                if (reason === 'time') {
                    this.el.title.textContent = '💥 时间到，雷爆了！';
                } else {
                    this.el.title.textContent = '💥 游戏结束';
                }
                const courageMsg = this.courageCnt > 0 ? ` · 🎲勇气×${this.courageCnt}` : '';
                this.el.msg.textContent = `到达第${this.level}关${courageMsg}`;
                this.el.nextBtn.classList.add('hidden');
                this.el.restart.textContent = '再来一次';
            }
            this.el.oScore.textContent = this.totalScore;
            this.el.record.textContent = isNewRecord
                ? '🏆 新纪录！'
                : `最高: 第${this.records.bestLevel}关 · ${this.records.bestScore}分`;
            this.el.record.classList.toggle('new-record', isNewRecord);
            this.el.overlay.classList.add('active');
        }, reason === 'time' ? 1200 : delay);
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

    // ==================== 速推系统 ====================

    _rushTick(floatPx, floatPy) {
        const now = performance.now();
        this.rushClicks.push(now);

        // 清除超过8秒的记录
        const cutoff = now - 8000;
        while (this.rushClicks.length > 0 && this.rushClicks[0] < cutoff) {
            this.rushClicks.shift();
        }

        // 从高到低检查 tier
        const tiers = getRushTiers(this.level);
        for (let i = tiers.length - 1; i >= 0; i--) {
            const tier = tiers[i];
            if (this.rushClicks.length >= tier.steps) {
                const span = now - this.rushClicks[this.rushClicks.length - tier.steps];
                if (span <= tier.window * 1000) {
                    // 触发速推奖励
                    this.time = Math.min(this.time + tier.bonus, this.maxTime);
                    this._uiTimer();
                    this.floats.spawn(`⚡${tier.label} +${tier.bonus}s`, floatPx, floatPy - 56, '#79C0FF', i === tiers.length - 1);
                    this._playSound('rush');
                    // 触发后重置，防止连续重复触发
                    this.rushClicks = [];
                    break;
                }
            }
        }

        this._uiRush();
    }

    _uiRush() {
        const now = performance.now();
        const target = getRushTiers(this.level)[0]; // 基础目标
        // 只显示窗口内的有效点击数
        const cutoff = now - target.window * 1000;
        const validCount = this.rushClicks.filter(t => t >= cutoff).length;

        for (let i = 0; i < this.el.rushPips.length; i++) {
            const pip = this.el.rushPips[i];
            pip.classList.toggle('filled', i < validCount);
            pip.classList.toggle('pulse', i === validCount - 1 && validCount >= 2);
        }

        if (validCount >= 2) {
            this.el.rushLabel.textContent = `${target.window}s内再来${target.steps - validCount}步`;
            this.el.rushBar.classList.add('active');
        } else {
            this.el.rushLabel.textContent = '';
            this.el.rushBar.classList.remove('active');
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
        } else if (type === 'blueMine') {
            // 蓝雷：下降水滴音 + 时钟倒转感
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(800, t);
            osc.frequency.exponentialRampToValueAtTime(200, t + 0.3);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            osc.start(t); osc.stop(t + 0.4);
            // 嘀嗒音
            [0.1, 0.2].forEach(d => {
                const o2 = ctx.createOscillator(), g2 = ctx.createGain();
                o2.connect(g2); g2.connect(ctx.destination);
                o2.type = 'triangle'; o2.frequency.value = 1200;
                g2.gain.setValueAtTime(0.06, t + d);
                g2.gain.exponentialRampToValueAtTime(0.001, t + d + 0.05);
                o2.start(t + d); o2.stop(t + d + 0.08);
            });
        } else if (type === 'win') {
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
        } else if (type === 'courage') {
            // 上行琶音 C5-E5-G5-C6-E6-G6 + 闪光音效
            const notes = [523, 659, 784, 1047, 1319, 1568];
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const s = t + i * 0.07;
                g.gain.setValueAtTime(0.12, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.45);
                osc.start(s); osc.stop(s + 0.5);
            });
            // 闪光和弦叠加
            [1047, 1319, 1568].forEach((freq) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.value = freq;
                const s = t + 0.4;
                g.gain.setValueAtTime(0.06, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.8);
                osc.start(s); osc.stop(s + 0.9);
            });
            // 低频 punch
            const bass = ctx.createOscillator(), bg = ctx.createGain();
            bass.connect(bg); bg.connect(ctx.destination);
            bass.type = 'sine';
            bass.frequency.value = 80;
            bg.gain.setValueAtTime(0.15, t);
            bg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            bass.start(t); bass.stop(t + 0.35);
        } else if (type === 'rush') {
            // 短促上行双音 "叮叮"
            [880, 1320].forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const s = t + i * 0.08;
                g.gain.setValueAtTime(0.1, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.15);
                osc.start(s); osc.stop(s + 0.2);
            });
        } else if (type === 'timeout') {
            // 下沉连续爆炸音：多个低频 sawtooth 依次触发
            for (let i = 0; i < 5; i++) {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sawtooth';
                const s = t + i * 0.15;
                osc.frequency.setValueAtTime(180 - i * 20, s);
                osc.frequency.exponentialRampToValueAtTime(40, s + 0.25);
                g.gain.setValueAtTime(0.12, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.3);
                osc.start(s); osc.stop(s + 0.35);
            }
            // 最后一声重低音
            const bass = ctx.createOscillator(), bg = ctx.createGain();
            bass.connect(bg); bg.connect(ctx.destination);
            bass.type = 'sine';
            bass.frequency.value = 50;
            const bs = t + 0.7;
            bg.gain.setValueAtTime(0.2, bs);
            bg.gain.exponentialRampToValueAtTime(0.001, bs + 0.5);
            bass.start(bs); bass.stop(bs + 0.6);
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
