// ============================================
// game.js — 游戏控制器
// 关卡递进 + Combo + 标旗 + 飘分 + 回血 + 记录
// + 速推时间奖励 + 暂停 + 勇气奖励
// ============================================

// ==================== 关卡配置（25关） ====================
// 雷密度 17-25%，棋盘渐进 6×6 → 8×10
function getLevelConfig(level) {
    level = Math.min(level, 25);
    if (level <= 3)  return { w: 6, h: 6,  mines: 5 + level            };  // 6,7,8   → 17-22%
    if (level <= 7)  return { w: 6, h: 8,  mines: 5 + level            };  // 9,10,11,12 → 19-25%
    if (level <= 12) return { w: 7, h: 9,  mines: 3 + level            };  // 11,12,13,14,15 → 17-24%
    return             { w: 8, h: 10, mines: Math.min(level + 1, 20)   };  // 14→20 → 18-25%
}

// 基础时间（按棋盘大小）
function getBaseTime(level) {
    const cfg = getLevelConfig(level);
    if (cfg.h >= 10) return 95;
    if (cfg.h >= 9)  return 80;
    if (cfg.h >= 8)  return 70;
    return 60;
}

// ==================== 设置 ====================
const SETTINGS_KEY = 'scanboom_settings';
function loadSettings() {
    try {
        const d = JSON.parse(localStorage.getItem(SETTINGS_KEY));
        return { flagMode: 'longPress', sound: true, vibration: true, ...d };
    } catch { return { flagMode: 'longPress', sound: true, vibration: true }; }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

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
    chill:   { icon: '🤔', name: '优柔寡断', desc: '时间+200%，得分-50%',        mult: 0.5, always: true },
    allIn:   { icon: '🔥', name: '孤注一掷', desc: '生命值=1',              mult: 1.6 },
    rush:    { icon: '⏱️', name: '争分夺秒', desc: '时间缩短20%',           mult: 1.3 },
    noFlag:  { icon: '🚫', name: '盲扫大师', desc: '无法标旗',              mult: 1.3 },
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

// 特殊雷分配（按关卡递进）
function getSpecialMine(level) {
    if (level < 6) return { joker: 0, magma: 0 };
    if (level <= 9) {
        // L6-9：随机1个小丑或1个岩浆
        return Math.random() < 0.5
            ? { joker: 1, magma: 0 }
            : { joker: 0, magma: 1 };
    }
    if (level <= 14) {
        // L10-14：各1个
        return { joker: 1, magma: 1 };
    }
    if (level <= 19) {
        // L15-19：总数2，随机分配
        const j = Math.floor(Math.random() * 3); // 0,1,2
        return { joker: j, magma: 2 - j };
    }
    // L20+：总数3，随机分配
    const j = Math.floor(Math.random() * 4); // 0,1,2,3
    return { joker: j, magma: 3 - j };
}

// ==================== 存档 ====================
const STORAGE_KEY = 'neuromines_records';
const SAVE_KEY = 'scanboom_save';
const GOLDEN_KEY = 'scanboom_golden'; // 金雷一生一次标志
function loadRecords() {
    try {
        const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return d || { bestLevel: 0, bestScore: 0 };
    } catch { return { bestLevel: 0, bestScore: 0 }; }
}
function saveRecords(records) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); } catch {}
}
function loadSave() {
    try {
        const d = JSON.parse(localStorage.getItem(SAVE_KEY));
        return d && d.level ? d : null;
    } catch { return null; }
}
function writeSave(data) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
}
function clearSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
}

// ==================== 成就系统 ====================
const STATS_KEY = 'scanboom_stats';
const ACHIEVE_KEY = 'scanboom_achievements';

function loadStats() {
    try {
        const d = JSON.parse(localStorage.getItem(STATS_KEY));
        return d || {};
    } catch { return {}; }
}
function saveStats(s) {
    try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch {}
}
function loadAchievements() {
    try {
        const d = JSON.parse(localStorage.getItem(ACHIEVE_KEY));
        if (!d || typeof d !== 'object') return {};
        // 新格式: { id: { tier, time } } — 旧格式 { id: number } 直接清除
        const first = Object.values(d)[0];
        if (typeof first === 'number') {
            localStorage.removeItem(ACHIEVE_KEY);
            return {};
        }
        return d;
    } catch { return {}; }
}
function saveAchievements(a) {
    try { localStorage.setItem(ACHIEVE_KEY, JSON.stringify(a)); } catch {}
}

// 成就定义：每个成就有 id, icon, name, desc, tiers, check(stats), unit(展示单位), condFmt(条件格式化)
const ACHIEVEMENTS = [
    // === 里程碑 ===
    { id: 'firstClear', icon: '🎯', name: '初出茅庐', desc: '通过第 1 关', tiers: [1], check: s => Math.min(s.levelClears || 0, 1), unit: '', category: '里程碑',
      condFmt: () => ['通过第 1 关'] },
    { id: 'fullClear', icon: '🏔️', name: '登峰造极', desc: '25关全通关', tiers: [1, 5, 10], check: s => s.totalClears || 0, unit: '次', category: '里程碑',
      condFmt: () => ['全通关 1 次', '全通关 5 次', '全通关 10 次'] },
    { id: 'richScore', icon: '💰', name: '万分富翁', desc: '单轮最高总分', tiers: [10000, 50000, 100000], check: s => s.bestRunScore || 0, unit: '分', category: '里程碑',
      condFmt: () => ['最高分 ≥ 1万', '最高分 ≥ 5万', '最高分 ≥ 10万'] },

    // === 技巧类 ===
    { id: 'ironWall', icon: '🛡️', name: '铁壁', desc: '单轮连续无伤通关', tiers: [5, 15, 25], check: s => s.bestRunNoDmg || 0, unit: '关', category: '技巧',
      condFmt: () => ['连续无伤 5 关', '连续无伤 15 关', '连续无伤 25 关'] },
    { id: 'lightning', icon: '⚡', name: '闪电手', desc: '≥8关用时≤30%基础时间', tiers: [1, 5, 10], check: s => s.fastWins || 0, unit: '次', category: '技巧',
      condFmt: () => ['闪电通关 1 次', '闪电通关 5 次', '闪电通关 10 次'] },
    { id: 'chainMaster', icon: '🔥', name: '连锁大师', desc: '单次最高翻开格数', tiers: [10, 15, 20], check: s => s.maxChain || 0, unit: '格', category: '技巧',
      condFmt: () => ['单次翻开 ≥ 10格', '单次翻开 ≥ 15格', '单次翻开 ≥ 20格'] },
    { id: 'fateChild', icon: '🎲', name: '命运之子', desc: '累计触发勇气奖励', tiers: [10, 100, 500], check: s => s.totalCourage || 0, unit: '次', category: '技巧',
      condFmt: () => ['触发 10 次', '触发 100 次', '触发 500 次'] },

    // === 挑战类 ===
    { id: 'allInMaster', icon: '💀', name: '孤注一掷大师', desc: '孤注一掷全通关', tiers: [1, 3, 5], check: s => s.allInClears || 0, unit: '次', category: '挑战',
      condFmt: () => ['全通关 1 次', '全通关 3 次', '全通关 5 次'] },
    { id: 'blindMaster', icon: '🚫', name: '盲人摸象', desc: '盲扫大师全通关', tiers: [1, 3, 5], check: s => s.noFlagClears || 0, unit: '次', category: '挑战',
      condFmt: () => ['全通关 1 次', '全通关 3 次', '全通关 5 次'] },
    { id: 'slowIsFast', icon: '🤔', name: '慢即是快', desc: '优柔寡断全通关', tiers: [1, 3, 5], check: s => s.chillFullClears || 0, unit: '次', category: '挑战',
      condFmt: () => ['全通关 1 次', '全通关 3 次', '全通关 5 次'] },

    // === 惩罚类 ===
    { id: 'jokerHunter', icon: '🤡', name: '小丑收割者', desc: '累计踩到小丑雷', tiers: [10, 100, 500], check: s => s.jokerHits || 0, unit: '次', category: '惩罚',
      condFmt: () => ['踩到 10 次', '踩到 100 次', '踩到 500 次'] },
    { id: 'magmaBody', icon: '🌋', name: '岩浆体质', desc: '累计踩到岩浆雷', tiers: [10, 100, 500], check: s => s.magmaHits || 0, unit: '次', category: '惩罚',
      condFmt: () => ['踩到 10 次', '踩到 100 次', '踩到 500 次'] },
    { id: 'clutch', icon: '💔', name: '九死一生', desc: '1命+剩余≤3s通关', tiers: [1, 5, 10], check: s => s.clutchWins || 0, unit: '次', category: '惩罚',
      condFmt: () => ['触发 1 次', '触发 5 次', '触发 10 次'] },
    { id: 'neverGiveUp', icon: '💪', name: '永不言败', desc: '未全通关前累计开局', tiers: [500, 1000, 2000], check: s => { const runs = s.totalRuns || 0; const clears = s.totalClears || 0; return clears === 0 ? runs : 0; }, unit: '局', category: '惩罚',
      condFmt: () => ['开局 500 次', '开局 1000 次', '开局 2000 次'] },

    // === 累计类 ===
    { id: 'revealPro', icon: '📦', name: '翻格达人', desc: '累计翻开格数', tiers: [5000, 20000, 50000], check: s => s.totalRevealed || 0, unit: '格', category: '累计',
      condFmt: () => ['翻开 5000 格', '翻开 2万格', '翻开 5万格'] },
    { id: 'flagPro', icon: '🚩', name: '旗手', desc: '累计标旗次数', tiers: [500, 2000, 5000], check: s => s.totalFlags || 0, unit: '次', category: '累计',
      condFmt: () => ['标旗 500 次', '标旗 2000 次', '标旗 5000 次'] },
    { id: 'combo10', icon: '🏅', name: 'Combo 大师', desc: '累计达成10+连击', tiers: [20, 100, 500], check: s => s.combo10Count || 0, unit: '次', category: '累计',
      condFmt: () => ['达成 20 次', '达成 100 次', '达成 500 次'] },

    // === 隐藏 ===
    { id: 'goldenMine', icon: '✨', name: '金色传说', desc: '发现并引爆金色地雷', tiers: [1], check: s => s.goldenMineFound || 0, unit: '', category: '隐藏', hidden: true,
      condFmt: () => ['引爆金色地雷'] },
];

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
        this.settings = loadSettings();
        this.stats = loadStats();
        this.achievements = loadAchievements();

        // 周目内追踪（不跨存档）
        this.runNoDmgCount = 0;   // 本周目无伤通关次数
        this.runAllIn = false;    // 本周目是否始终使用孤注一掷
        this.runNoFlag = false;   // 本周目是否始终使用盲扫
        this.runChill = false;    // 本周目是否始终使用优柔寡断

        // 金雷系统
        this.goldenMineTriggered = !!localStorage.getItem(GOLDEN_KEY); // 一生一次
        this.hasGoldenMine = false;  // 当前关卡是否有金雷
        this.goldenMinePos = null;   // 金雷位置 {x, y}
        this.goldenMineActive = false; // 金雷小游戏进行中
        this.goldenMineClicks = 0;    // 金雷点击次数
        this.goldenMineTimer = null;  // 8 秒计时器

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
            menuScreen:     document.getElementById('menuScreen'),
            gameScreen:     document.getElementById('gameScreen'),
            menuStartBtn:   document.getElementById('menuStartBtn'),
            menuContinueBtn: document.getElementById('menuContinueBtn'),
            menuRecord:     document.getElementById('menuRecord'),
            menuBomb:       document.getElementById('menuBomb'),
            menuTitle:      document.getElementById('menuTitle'),
            menuFragments:  document.getElementById('menuFragments'),
            lives:          document.getElementById('lives'),
            level:          document.getElementById('level'),
            timer:          document.getElementById('timer'),
            timeBarFill:    document.getElementById('timeBarFill'),
            modBadge:       document.getElementById('modBadge'),
            mineCount:      document.getElementById('mineCount'),
            score:          document.getElementById('score'),
            hint:           document.getElementById('hint'),
            comboText:      document.getElementById('comboText'),
            flagBtn:        document.getElementById('flagBtn'),
            pauseBtn:       document.getElementById('pauseBtn'),
            pauseOverlay:   document.getElementById('pauseOverlay'),
            pauseMods:      document.getElementById('pauseMods'),
            resumeBtn:      document.getElementById('resumeBtn'),
            pauseSettingsBtn: document.getElementById('pauseSettingsBtn'),
            pauseAboutBtn:  document.getElementById('pauseAboutBtn'),
            pauseHomeBtn:   document.getElementById('pauseHomeBtn'),
            pauseConfirm:   document.getElementById('pauseConfirm'),
            confirmYes:     document.getElementById('confirmYes'),
            confirmNo:      document.getElementById('confirmNo'),
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
            scoreTable:     document.getElementById('scoreTable'),
            record:         document.getElementById('overlayRecord'),
            nextBtn:        document.getElementById('nextBtn'),
            restart:        document.getElementById('restartBtn'),
            modOverlay:     document.getElementById('modifierOverlay'),
            modList:        document.getElementById('modifierList'),
            modDots:        document.getElementById('modifierDots'),
            modMult:        document.getElementById('modifierMult'),
            modLevel:       document.getElementById('modifierLevel'),
            modStartBtn:    document.getElementById('modifierStartBtn'),
            modHomeBtn:     document.getElementById('modifierHomeBtn'),
            aboutOverlay:   document.getElementById('aboutOverlay'),
            aboutCloseBtn:  document.getElementById('aboutCloseBtn'),
            settingsOverlay: document.getElementById('settingsOverlay'),
            settingsCloseBtn: document.getElementById('settingsCloseBtn'),
            menuSettingsBtn: document.getElementById('menuSettingsBtn'),
            menuTutorialBtn: document.getElementById('menuTutorialBtn'),
            menuAchieveBtn:  document.getElementById('menuAchieveBtn'),
            tutorialOverlay: document.getElementById('tutorialOverlay'),
            tutorialCloseBtn: document.getElementById('tutorialCloseBtn'),
            achieveOverlay:  document.getElementById('achieveOverlay'),
            achieveCloseBtn: document.getElementById('achieveCloseBtn'),
            achieveShareBtn: document.getElementById('achieveShareBtn'),
            achieveBody:     document.getElementById('achieveBody'),
            shareBtn:        document.getElementById('shareBtn'),
            shareCanvas:     document.getElementById('shareCanvas'),
            goldenOverlay:   document.getElementById('goldenOverlay'),
            goldenMine:      document.getElementById('goldenMine'),
            goldenCombo:     document.getElementById('goldenCombo'),
            goldenScore:     document.getElementById('goldenScore'),
            goldenTimer:     document.getElementById('goldenTimer'),
            goldenParticles: document.getElementById('goldenParticles'),
        };

        this.audioCtx = null;
        this._firstLaunch = true;

        this._setupInput();
        this._showMenu();
        this._loop();
    }

    // ==================== 输入 ====================

    _setupInput() {
        let touched = false;
        let lastClickTime = 0;
        let lastClickPos = null;

        // Long press state
        let longPressTimer = null;
        let longPressTriggered = false;
        let touchStartPos = null;

        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            touched = true;

            if (this.settings.flagMode === 'longPress') {
                const t = e.touches[0];
                if (!t) return;
                touchStartPos = { clientX: t.clientX, clientY: t.clientY };
                longPressTriggered = false;
                const r = this.canvas.getBoundingClientRect();

                longPressTimer = setTimeout(() => {
                    longPressTriggered = true;
                    const px = touchStartPos.clientX - r.left;
                    const py = touchStartPos.clientY - r.top;
                    const pos = this.renderer.hitTest(px, py);
                    if (pos) {
                        this._doFlag(pos);
                        this._haptic('flag');
                    }
                }, 400);
            }
        }, { passive: false });

        this.canvas.addEventListener('touchmove', e => {
            if (longPressTimer && touchStartPos) {
                const t = e.touches[0];
                if (t) {
                    const dx = t.clientX - touchStartPos.clientX;
                    const dy = t.clientY - touchStartPos.clientY;
                    if (dx * dx + dy * dy > 100) {
                        clearTimeout(longPressTimer);
                        longPressTimer = null;
                    }
                }
            }
        }, { passive: true });

        this.canvas.addEventListener('touchend', e => {
            e.preventDefault();
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }

            if (longPressTriggered) {
                longPressTriggered = false;
                setTimeout(() => { touched = false; }, 300);
                return;
            }

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
            this.renderer.dirty = true;
        });
        this.canvas.addEventListener('mouseleave', () => { this.renderer.hoverCell = null; this.renderer.dirty = true; });

        window.addEventListener('resize', () => this.renderer.resize());

        // 切换后台/标签页时自动暂停
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && this.state === 'playing') {
                this._togglePause();
            }
        });

        // 标旗模式切换
        this.el.flagBtn.addEventListener('click', () => {
            if (this.activeMods.has('noFlag')) return;
            this.flagMode = !this.flagMode;
            this.el.flagBtn.textContent = this.flagMode ? '🚩' : '⛏️';
            this.el.flagBtn.classList.toggle('active', this.flagMode);
            this.renderer.flagMode = this.flagMode;
        });

        // 暂停 / 继续
        this.el.pauseBtn.addEventListener('click', () => this._togglePause());
        this.el.resumeBtn.addEventListener('click', () => this._togglePause());

        // 暂停页面内按钮（不关闭暂停页，设置/关于叠在上层）
        this.el.pauseSettingsBtn.addEventListener('click', () => {
            this._toggleSettings();
        });
        this.el.pauseAboutBtn.addEventListener('click', () => {
            this._toggleAbout();
        });
        this.el.pauseHomeBtn.addEventListener('click', () => {
            if (this._pausedFromIdle) {
                this.el.pauseOverlay.classList.remove('active');
                this.state = 'ended';
                this._showMenu();
            } else {
                this.el.pauseConfirm.style.display = '';
            }
        });
        this.el.confirmYes.addEventListener('click', () => {
            this.el.pauseConfirm.style.display = 'none';
            this.el.pauseOverlay.classList.remove('active');
            clearSave();
            this.state = 'ended';
            this._showMenu();
        });
        this.el.confirmNo.addEventListener('click', () => {
            this.el.pauseConfirm.style.display = 'none';
        });

        // 关于/设置关闭
        this.el.aboutCloseBtn.addEventListener('click', () => this._toggleAbout());
        this.el.settingsCloseBtn.addEventListener('click', () => this._toggleSettings());

        // 主菜单开始
        this.el.menuStartBtn.addEventListener('click', () => this._menuStart());
        this.el.menuContinueBtn.addEventListener('click', () => this._menuContinue());

        // 主菜单辅助按钮
        this.el.menuSettingsBtn.addEventListener('click', () => this._toggleSettings());
        this.el.menuTutorialBtn.addEventListener('click', () => this._toggleTutorial());
        this.el.menuAchieveBtn.addEventListener('click', () => this._toggleAchieve());
        this.el.tutorialCloseBtn.addEventListener('click', () => this._toggleTutorial());
        this.el.achieveCloseBtn.addEventListener('click', () => this._toggleAchieve());
        this.el.achieveShareBtn.addEventListener('click', () => this._shareAchieveWall());

        // 分享按钮
        this.el.shareBtn.addEventListener('click', () => this._shareResult());

        // 设置项变更
        document.querySelectorAll('input[name="flagMode"]').forEach(radio => {
            radio.addEventListener('change', e => {
                this.settings.flagMode = e.target.value;
                saveSettings(this.settings);
                this._applyFlagMode();
            });
        });
        document.getElementById('soundToggle').addEventListener('change', e => {
            this.settings.sound = e.target.checked;
            saveSettings(this.settings);
        });
        document.getElementById('vibrationToggle').addEventListener('change', e => {
            this.settings.vibration = e.target.checked;
            saveSettings(this.settings);
        });

        // 结算按钮
        this.el.nextBtn.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level++;
            // 过关自动存档
            this._writeSave();
            this._showModifierSelection();
        });

        this.el.restart.addEventListener('click', () => {
            this.el.overlay.classList.remove('active');
            this.level = 1;
            this.totalScore = 0;
            this.lives = this.MAX_LIVES;
            this.combo = 0;
            this.courageCnt = 0;
            clearSave();
            this._showModifierSelection();
        });

        // 修饰器选择
        this.el.modStartBtn.addEventListener('click', () => this._confirmModifiers());
        this.el.modHomeBtn.addEventListener('click', () => {
            this.el.modOverlay.classList.remove('active');
            this._showMenu();
        });

        // 初始化设置UI
        this._applySettingsUI();
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
        for (let idx = 0; idx < shown.length; idx++) {
            const key = shown[idx];
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
                    this._playSound('modSelect');
                } else {
                    this.activeMods.delete(key);
                    this._playSound('modDeselect');
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
        this.stats.totalRuns = (this.stats.totalRuns || 0) + 1;
        saveStats(this.stats);
        this._startLevel();
    }

    // ==================== 主菜单 ====================

    _showMenu() {
        this.el.gameScreen.style.display = 'none';
        this.el.menuScreen.style.display = '';
        this.el.menuScreen.classList.remove('exploding');
        // 显示历史记录
        if (this.records.bestLevel > 0) {
            this.el.menuRecord.textContent = `最高: 第${this.records.bestLevel}关 · ${this.records.bestScore}分`;
        } else {
            this.el.menuRecord.textContent = '';
        }
        // 有存档时显示继续按钮
        const save = loadSave();
        if (save) {
            this.el.menuContinueBtn.style.display = '';
            this.el.menuContinueBtn.textContent = `继续游戏 ▶ 第${save.level}关 · ${save.totalScore}分`;
            this.el.menuStartBtn.textContent = '新游戏 💥';
        } else {
            this.el.menuContinueBtn.style.display = 'none';
            this.el.menuStartBtn.textContent = '新游戏 💥';
        }
        // 清理可能残留的叠层
        this.el.settingsOverlay.classList.remove('active');
        this.el.aboutOverlay.classList.remove('active');
        this.el.pauseOverlay.classList.remove('active');
        this.el.modOverlay.classList.remove('active');
        this.el.overlay.classList.remove('active');
        this.el.tutorialOverlay.classList.remove('active');
        this.el.achieveOverlay.classList.remove('active');

        // 首次访问自动弹出教程
        if (!localStorage.getItem('scanboom_tutorialSeen')) {
            localStorage.setItem('scanboom_tutorialSeen', '1');
            setTimeout(() => this.el.tutorialOverlay.classList.add('active'), 400);
        }
    }

    _menuContinue() {
        this._initAudio();
        const save = loadSave();
        if (!save) return;

        // 恢复存档状态
        this.level = save.level;
        this.totalScore = save.totalScore;
        this.lives = save.lives;
        this.combo = save.combo || 0;
        this.courageCnt = save.courageCnt || 0;
        this.runNoDmgCount = 0;
        this.runAllIn = true;
        this.runNoFlag = true;
        this.runChill = true;

        // 爆炸过渡
        this.el.menuContinueBtn.disabled = true;
        this._spawnMenuFragments();
        this.el.menuScreen.classList.add('exploding');
        this._haptic('mine');
        this._playSound('boom');

        setTimeout(() => {
            this.el.menuScreen.style.display = 'none';
            this.el.gameScreen.style.display = '';
            this.el.menuContinueBtn.disabled = false;
            this._showModifierSelection();
        }, 600);
    }

    _menuStart() {
        this._initAudio();
        this.el.menuStartBtn.disabled = true;

        // 立即爆炸
        this._spawnMenuFragments();
        this.el.menuScreen.classList.add('exploding');
        this._haptic('mine');
        this._playSound('boom');

        setTimeout(() => {
            this.el.menuScreen.style.display = 'none';
            this.el.gameScreen.style.display = '';
            this.el.menuStartBtn.disabled = false;

            // 重置游戏状态
            clearSave();
            this.level = 1;
            this.totalScore = 0;
            this.lives = this.MAX_LIVES;
            this.combo = 0;
            this.courageCnt = 0;
            this.runNoDmgCount = 0;
            this.runAllIn = true;
            this.runNoFlag = true;
            this.runChill = true;
            this._showModifierSelection();
        }, 600);
    }

    _spawnMenuFragments() {
        const container = this.el.menuFragments;
        container.innerHTML = '';
        const colors = ['#F85149', '#F0883E', '#F0C040', '#FFD700', '#FF6B35'];
        for (let i = 0; i < 24; i++) {
            const f = document.createElement('div');
            f.className = 'menu-frag';
            f.style.background = colors[(Math.random() * colors.length) | 0];
            const angle = Math.random() * Math.PI * 2;
            const dist = 100 + Math.random() * 300;
            f.style.setProperty('--fx', (Math.cos(angle) * dist) + 'px');
            f.style.setProperty('--fy', (Math.sin(angle) * dist - 100) + 'px');
            f.style.left = (40 + Math.random() * 20) + '%';
            f.style.top = (30 + Math.random() * 20) + '%';
            const size = 8 + Math.random() * 20;
            f.style.width = size + 'px';
            f.style.height = size + 'px';
            container.appendChild(f);
        }
    }

    // ==================== 暂停 ====================

    _togglePause() {
        if (this.state === 'idle') {
            // idle 状态也可暂停（还没开始计时）
            this.state = 'paused';
            this._pausedFromIdle = true;
            this.el.pauseMods.innerHTML = '';
            this.el.pauseConfirm.style.display = 'none';
            this.el.pauseOverlay.classList.add('active');
            this.el.pauseBtn.textContent = '▶';
        } else if (this.state === 'playing') {
            this.state = 'paused';
            this._pausedFromIdle = false;
            // 显示当前修饰器
            if (this.activeMods.size > 0) {
                const modTexts = [...this.activeMods].map(k => `${MODIFIERS[k].icon} ${MODIFIERS[k].name}`);
                this.el.pauseMods.innerHTML = `<div class="pause-mods-label">当前修饰器</div><div class="pause-mods-list">${modTexts.join(' · ')}</div><div class="pause-mods-mult">得分倍率 ×${this.scoreMult.toFixed(1)}</div>`;
            } else {
                this.el.pauseMods.innerHTML = '';
            }
            this.el.pauseConfirm.style.display = 'none';
            this.el.pauseOverlay.classList.add('active');
            this.el.pauseBtn.textContent = '▶';
        } else if (this.state === 'paused') {
            this.state = this._pausedFromIdle ? 'idle' : 'playing';
            if (!this._pausedFromIdle) this.lastTick = performance.now();
            this._pausedFromIdle = false;
            this.el.pauseOverlay.classList.remove('active');
            this.el.pauseBtn.textContent = '⏸';
        }
    }

    _toggleAbout() {
        const overlay = this.el.aboutOverlay;
        overlay.classList.toggle('active');
    }

    _toggleTutorial() {
        this.el.tutorialOverlay.classList.toggle('active');
    }

    _toggleAchieve() {
        this.el.achieveOverlay.classList.toggle('active');
        if (this.el.achieveOverlay.classList.contains('active')) {
            this._renderAchievePage();
        }
    }

    _showAchieveToast(unlocks) {
        const container = document.getElementById('achieveToast');
        const tierNames = ['', '铜', '银', '金'];
        const tierColors = ['', '#CD7F32', '#C0C0C0', '#FFD700'];
        unlocks.forEach((u, i) => {
            setTimeout(() => {
                const el = document.createElement('div');
                el.className = 'achieve-toast';
                const tName = u.tier <= 0 ? '' : (u.tiers && u.tiers.length === 1 ? '金' : tierNames[u.tier]);
                const tColor = u.tiers && u.tiers.length === 1 ? '#FFD700' : tierColors[u.tier];
                el.innerHTML = `<div class="achieve-toast-icon">${u.icon}</div>
                    <div class="achieve-toast-body">
                        <span class="achieve-toast-label">成就解锁</span>
                        <span class="achieve-toast-name">${u.name}<span class="achieve-toast-tier" style="color:${tColor}">${tName}</span></span>
                    </div>`;
                container.appendChild(el);
                setTimeout(() => {
                    el.classList.add('out');
                    el.addEventListener('animationend', () => el.remove());
                }, 2000);
            }, i * 400);
        });
    }

    _checkAchievements() {
        const unlocks = [];
        const now = Date.now();
        for (const ach of ACHIEVEMENTS) {
            const val = ach.check(this.stats);
            const data = this.achievements[ach.id] || { tier: 0, time: 0 };
            const prev = data.tier;
            let newTier = prev;
            for (let t = 0; t < ach.tiers.length; t++) {
                if (val >= ach.tiers[t]) newTier = t + 1;
            }
            if (newTier > prev) {
                this.achievements[ach.id] = { tier: newTier, time: now };
                unlocks.push({ ...ach, tier: newTier });
            }
        }
        if (unlocks.length > 0) saveAchievements(this.achievements);
        return unlocks;
    }

    _renderAchievePage() {
        const body = this.el.achieveBody;
        const tierColors = ['#30363D', '#CD7F32', '#C0C0C0', '#FFD700'];
        let html = '';
        let lastCat = '';
        for (const ach of ACHIEVEMENTS) {
            if (ach.category !== lastCat) {
                if (lastCat) html += '</div>';
                lastCat = ach.category;
                html += `<div class="aw-category">${lastCat}</div>`;
                html += '<div class="aw-grid">';
            }
            const data = this.achievements[ach.id] || { tier: 0, time: 0 };
            const tier = data.tier;
            const val = ach.check(this.stats);
            const maxTier = ach.tiers.length;
            const color = tier > 0 ? tierColors[Math.min(tier, 3)] : '#30363D';
            const displayColor = (maxTier === 1 && tier > 0) ? '#FFD700' : color;

            // 隐藏成就未解锁
            if (ach.hidden && tier === 0) {
                html += `<div class="aw-card aw-locked" data-id="${ach.id}">`;
                html += `<div class="aw-icon">❓</div>`;
                html += `<div class="aw-name">???</div>`;
                html += `</div>`;
                continue;
            }

            const unlocked = tier > 0;
            const valText = ach.unit ? `${val}${ach.unit}` : (unlocked ? '✓' : '—');
            html += `<div class="aw-card ${unlocked ? 'aw-unlocked' : 'aw-locked'}" data-id="${ach.id}" style="--tier-color:${displayColor}">`;
            html += `<div class="aw-icon">${ach.icon}</div>`;
            html += `<div class="aw-name">${ach.name}</div>`;
            if (unlocked) {
                html += `<div class="aw-val" style="color:${displayColor}">${valText}</div>`;
            } else {
                html += `<div class="aw-val">${ach.unit ? `${val} / ${ach.tiers[tier]}` : '—'}</div>`;
            }
            html += `</div>`;
        }
        if (lastCat) html += '</div>';

        body.innerHTML = html;

        // 点击检视
        body.querySelectorAll('.aw-card').forEach(card => {
            card.addEventListener('click', () => this._showAchieveInspect(card.dataset.id));
        });
    }

    _showAchieveInspect(id) {
        const ach = ACHIEVEMENTS.find(a => a.id === id);
        if (!ach) return;
        const data = this.achievements[id] || { tier: 0, time: 0 };
        const tier = data.tier;
        const val = ach.check(this.stats);
        const maxTier = ach.tiers.length;
        const tierColors = ['#30363D', '#CD7F32', '#C0C0C0', '#FFD700'];
        const tierNames = ['', '铜', '银', '金'];
        const displayColor = (maxTier === 1 && tier > 0) ? '#FFD700' : (tier > 0 ? tierColors[Math.min(tier, 3)] : '#30363D');

        const isHiddenLocked = ach.hidden && tier === 0;
        const icon = isHiddenLocked ? '❓' : ach.icon;
        const name = isHiddenLocked ? '???' : ach.name;
        const desc = isHiddenLocked ? '隐藏成就' : ach.desc;
        const valText = ach.unit ? `${val}${ach.unit}` : (tier > 0 ? '✓' : '—');

        // 时间格式
        let timeStr = '—';
        if (data.time) {
            const d = new Date(data.time);
            timeStr = `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
        }

        // 条件列表（用 condFmt）
        let condHtml = '';
        if (!isHiddenLocked && ach.condFmt) {
            const conds = ach.condFmt();
            for (let t = 0; t < conds.length; t++) {
                const tName = conds.length === 1 ? '金' : tierNames[t + 1];
                const tColor = conds.length === 1 ? '#FFD700' : tierColors[t + 1];
                const done = tier > t;
                condHtml += `<div class="aw-ins-cond ${done ? 'done' : ''}">`;
                condHtml += `<span class="aw-ins-dot" style="background:${done ? tColor : '#30363D'}"></span>`;
                condHtml += `<span>${conds.length > 1 ? tName + '：' : ''}${conds[t]}</span>`;
                condHtml += `</div>`;
            }
        }

        // 进度条
        const nextThreshold = tier < maxTier ? ach.tiers[tier] : ach.tiers[maxTier - 1];
        const progress = tier >= maxTier ? 100 : Math.min(100, Math.round(val / nextThreshold * 100));
        const barColor = tier >= maxTier ? displayColor : (tier > 0 ? tierColors[tier] : '#58A6FF');

        const overlay = document.getElementById('achieveInspect');
        overlay.innerHTML = `
            <div class="aw-ins-backdrop"></div>
            <div class="aw-ins-card" style="--tier-color:${displayColor}">
                <div class="aw-ins-icon">${icon}</div>
                <div class="aw-ins-name">${name}</div>
                ${!isHiddenLocked ? `<div class="aw-ins-desc">${desc}</div>` : ''}
                ${!isHiddenLocked ? `<div class="aw-ins-val" style="color:${displayColor}">${valText}</div>` : ''}
                ${!isHiddenLocked ? `<div class="aw-ins-progress"><div class="aw-ins-bar" style="width:${progress}%;background:${barColor}"></div></div>` : ''}
                ${tier > 0 ? `<div class="aw-ins-time">获取于 ${timeStr}</div>` : ''}
                <div class="aw-ins-conds">${condHtml}</div>
                <button class="aw-ins-close">关闭</button>
            </div>`;
        overlay.classList.add('active');

        overlay.querySelector('.aw-ins-backdrop').addEventListener('click', () => overlay.classList.remove('active'));
        overlay.querySelector('.aw-ins-close').addEventListener('click', () => overlay.classList.remove('active'));
    }

    // ==================== 关卡控制 ====================

    _startLevel() {
        const cfg = getLevelConfig(this.level);
        const seed = Date.now() ^ ((Math.random() * 0xFFFFFFFF) | 0);
        this.board = new Board(cfg.w, cfg.h, cfg.mines, seed);

        // 蓝雷 + 特殊雷
        this.board.blueMineRatio = getBlueMineRatio(this.level);
        const special = getSpecialMine(this.level);
        this.board.jokerMineCount = special.joker;
        this.board.magmaMineCount = special.magma;

        this.renderer.setBoard(this.board);

        // 金雷判定（每局开局整体判定一次）
        this.hasGoldenMine = false;
        this.goldenMinePos = null;
        this.goldenMineActive = false;
        this.goldenMineClicks = 0;
        if (this.goldenMineTimer) { clearInterval(this.goldenMineTimer); this.goldenMineTimer = null; }
        if (!this.goldenMineTriggered) {
            const clears = this.stats.totalClears || 0;
            const goldenProb = 0.0001 + clears * 0.02;
            if (Math.random() < goldenProb) {
                this.hasGoldenMine = true;
                this.board.goldenMineRequested = true;
            }
        }

        // 修饰器: 优柔寡断 → 时间+200%
        let timeBase = getBaseTime(this.level);
        if (this.activeMods.has('chill')) timeBase = timeBase * 3;

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

        // 跟踪修饰器一周目一致性
        if (!this.activeMods.has('allIn')) this.runAllIn = false;
        if (!this.activeMods.has('noFlag')) this.runNoFlag = false;
        if (!this.activeMods.has('chill')) this.runChill = false;

        // 分数明细跟踪
        this.scoreBreakdown = {
            base: 0,        // 翻开基础得分
            combo: 0,       // Combo加成
            courage: 0,     // 勇气奖励得分
            courageExtra: 0, // 勇气生存奖励（满血转分数）
            timeBonus: 0,   // 时间奖励
            noDmgBonus: 0,  // 无伤加成
            penalty: 0,     // 踩雷扣分
        };

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
        if (this.state === 'ended' || this.state === 'paused' || this.state === 'courage' || this.state === 'golden') return;
        const pos = this.renderer.hitTest(px, py);
        if (!pos) return;

        if (this.state === 'idle') {
            this.state = 'playing';
            this.lastTick = performance.now();
            this.el.hint.classList.add('hidden');
            this._initAudio();
        }

        // 长按标旗模式：点击已标旗格取消标旗
        if (this.settings.flagMode === 'longPress' && !this.flagMode) {
            const c = this.board.cell(pos.x, pos.y);
            if (c && c.flagged) {
                this._doFlag(pos);
                return;
            }
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
            this._initAudio();
        }
        const ok = this.board.toggleFlag(pos.x, pos.y);
        if (ok) {
            this._uiMineCount();
            this.renderer.dirty = true;
            // 统计标旗（只计标旗动作，不计取消）
            const c = this.board.cell(pos.x, pos.y);
            if (c && c.flagged) this.stats.totalFlags = (this.stats.totalFlags || 0) + 1;
        }
        if (ok && this.flagMode && this.settings.flagMode === 'auto') {
            this.flagMode = false;
            this.el.flagBtn.textContent = '⛏️';
            this.el.flagBtn.classList.remove('active');
            this.renderer.flagMode = false;
        }
    }

    _doReveal(pos) {
        // 金雷小游戏进行中，拦截所有点击
        if (this.goldenMineActive) return;

        const c = this.board.cell(pos.x, pos.y);
        if (!c) return;

        // 点击已翻开数字格 → chord
        if (c.revealed && c.adj > 0) {
            this._onDoubleClick(pos);
            return;
        }

        // ===== 勇气奖励检测（翻开前检查） =====
        const isDeadBoard = this.board.generated && !this.board.hasSafeMove();
        const wasGenerated = this.board.generated;

        const result = this.board.reveal(pos.x, pos.y);
        if (!result) return;

        // 首次生成后定位金雷
        if (!wasGenerated && this.board.generated && this.hasGoldenMine) {
            const gc = this.board.cells.find(c => c.golden);
            if (gc) {
                this.goldenMinePos = { x: gc.x, y: gc.y };
                this.renderer.goldenMinePos = this.goldenMinePos;
                this.renderer.goldenBoardGlow = true;
                this.renderer.dirty = true;
            } else {
                this.hasGoldenMine = false;
            }
        }

        if (result.type === 'mine') {
            // 金雷：触发小游戏而非惩罚
            const mineCell = this.board.cell(result.x, result.y);
            if (mineCell && mineCell.golden) {
                this._onGoldenMine(result);
            } else {
                this._onMine(result);
            }
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
            const mineCell = this.board.cell(m.x, m.y);
            if (mineCell && mineCell.golden) {
                this._onGoldenMine(m);
            } else {
                this._onMine(m);
            }
        }
    }

    // ==================== 踩雷 ====================

    _onMine(result) {
        if (this.state !== 'playing') return; // 防止chord多雷重复触发
        this.combo = 0;
        this.rushClicks = [];
        this._uiRush();

        const cell = this.board.cell(result.x, result.y);
        const isBlue = cell && cell.blue;
        const isJoker = cell && cell.joker;
        const isMagma = cell && cell.magma;

        this.renderer.animateReveal([{ x: result.x, y: result.y, dist: 0 }]);

        if (isJoker) {
            // 小丑雷：扣命（不触发递增扣分）+ 清旗 + 回退50%已翻开的格子
            this.lives--;
            this.stats.jokerHits = (this.stats.jokerHits || 0) + 1;
            cell.joker = false;
            cell.revealed = false;
            if (this.board.blueMineRatio > 0 && Math.random() < this.board.blueMineRatio) {
                cell.blue = true;
            }

            this.board.clearAllFlags();
            const reverted = this.board.revertRevealedCells(0.5);

            this._uiLives();
            this.renderer.animateExplosion(result.x, result.y, '#BC8CFF');
            this.renderer.animateJokerRevert(reverted);
            this._playSound('joker');
            this._haptic('mine');

            const { px, py } = this._boardToFloat(result.x, result.y);
            this.floats.spawn('🤡 小丑!', px, py, '#BC8CFF', true);
            this.floats.spawn('💔 -1', px, py - 28, '#BC8CFF');
            if (reverted.length > 0) {
                this.floats.spawn(`↩ ${reverted.length}格回退`, px, py - 56, '#BC8CFF');
            }

            this._uiCombo();
            this._uiMineCount();
            if (this.lives <= 0) this._endGame('dead');
        } else if (isMagma) {
            // 岩浆雷：扣命 + 扣分 + 溅射
            this.hitMines++;
            this.lives--;
            this.stats.magmaHits = (this.stats.magmaHits || 0) + 1;
            const magmaPenalty = 50 * Math.pow(2, this.hitMines - 1);
            this.totalScore = Math.max(0, this.totalScore - magmaPenalty);
            this.scoreBreakdown.penalty += magmaPenalty;

            // 溅射揭开
            const splashed = this.board.splashReveal(result.x, result.y);

            this._uiLives();
            this._uiScore();
            this._uiCombo();

            this.renderer.animateExplosion(result.x, result.y, '#F0883E');
            this.renderer.animateMagmaSplash(result.x, result.y, splashed);
            this._playSound('magma');
            this._haptic('mine');

            const { px: mpx, py: mpy } = this._boardToFloat(result.x, result.y);
            this.floats.spawn('\uD83C\uDF0B \u5CA9\u6D46!', mpx, mpy, '#F0883E', true);
            this.floats.spawn(`-${magmaPenalty}`, mpx, mpy - 28, '#F0883E');
            if (splashed.length > 0) {
                const mineHits = splashed.filter(s => s.mine).length;
                let splashMsg = `\u6EB6\u5C04 ${splashed.length}\u683C`;
                if (mineHits > 0) splashMsg += ` \uD83D\uDCA5${mineHits}`;
                this.floats.spawn(splashMsg, mpx, mpy - 56, '#F0883E');
            }

            this._uiMineCount();
            if (this.lives <= 0) this._endGame('dead');
            else if (this.board.isComplete()) {
                this._applyWinBonus();
                this._endGame('win');
            }
        } else if (isBlue) {
            // 蓝雷：按关卡扣时间，不扣命
            this.hitMines++;
            const timeLoss = Math.ceil(this.time * getBlueTimePenalty(this.level));
            this.time = Math.max(0, this.time - timeLoss);
            const bluePenalty = 50 * Math.pow(2, this.hitMines - 1);
            this.totalScore = Math.max(0, this.totalScore - bluePenalty);
            this.scoreBreakdown.penalty += bluePenalty;
            this._uiTimer();
            this._uiScore();
            this._uiCombo();

            this.renderer.animateExplosion(result.x, result.y, '#58A6FF');
            this._playSound('blueMine');
            this._haptic('blueMine');

            const { px, py } = this._boardToFloat(result.x, result.y);
            this.floats.spawn(`⏱️-${timeLoss}s`, px, py, '#58A6FF');
            this.floats.spawn(`-${bluePenalty}`, px, py - 28, '#58A6FF');

            this._uiMineCount();
            if (this.time <= 0) this._endGame('time');
        } else {
            // 红雷：扣命
            this.hitMines++;
            this.lives--;
            const penalty = 50 * Math.pow(2, this.hitMines - 1);
            this.totalScore = Math.max(0, this.totalScore - penalty);
            this.scoreBreakdown.penalty += penalty;
            this._uiLives();
            this._uiScore();
            this._uiCombo();

            this.renderer.animateExplosion(result.x, result.y);
            this._playSound('boom');
            this._haptic('mine');

            const { px, py } = this._boardToFloat(result.x, result.y);
            this.floats.spawn(`-${penalty}`, px, py, '#F85149');

            this._uiMineCount();
            if (this.lives <= 0) this._endGame('dead');
        }
    }

    // ==================== 金雷小游戏 ====================

    _onGoldenMine(result) {
        // 翻开动画 - 金色
        this.renderer.animateReveal([{ x: result.x, y: result.y, dist: 0 }]);
        this.renderer.animateExplosion(result.x, result.y, '#F0C040');

        // 暂停游戏计时
        this.state = 'golden';
        this.goldenMineActive = true;
        this.goldenMineClicks = 0;

        // 关闭棋盘金色光晕（已经找到了）
        this.renderer.goldenBoardGlow = false;
        this.renderer.goldenMinePos = null;

        // 播放特殊发现音效
        this._playSound('goldenFind');
        this._haptic('courage');

        // 延迟显示小游戏叠层（让翻牌动画先播）
        setTimeout(() => {
            this._startGoldenMiniGame();
        }, 500);
    }

    _startGoldenMiniGame() {
        const overlay = this.el.goldenOverlay;
        this.el.goldenCombo.textContent = '0';
        this.el.goldenScore.textContent = '+0';
        this.el.goldenTimer.textContent = '8.0s';
        this.el.goldenParticles.innerHTML = '';

        overlay.classList.add('active');

        // 金雷点击区域
        const mine = this.el.goldenMine;
        mine.classList.remove('exploding');

        let remaining = 8.0;
        this.goldenMineClicks = 0;

        // 点击金雷
        const clickHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (remaining <= 0) return;
            this.goldenMineClicks++;
            this.totalScore += 1000;
            this.levelScore += 1000;
            this.el.goldenCombo.textContent = this.goldenMineClicks;
            this.el.goldenScore.textContent = `+${this.goldenMineClicks * 1000}`;
            this._uiScore();

            // 视觉反馈：缩放脉冲
            mine.classList.remove('pulse');
            void mine.offsetWidth;
            mine.classList.add('pulse');

            // 粒子
            this._spawnGoldenParticle();

            // 音效（上升音阶）
            this._playSound('goldenTap', this.goldenMineClicks);
            this._haptic('tick');

            // 飘分
            const rect = overlay.getBoundingClientRect();
            const mineRect = mine.getBoundingClientRect();
            const fx = mineRect.left - rect.left + mineRect.width / 2;
            const fy = mineRect.top - rect.top;
            const span = document.createElement('div');
            span.className = 'golden-float';
            span.textContent = '+1000';
            span.style.left = fx + 'px';
            span.style.top = fy + 'px';
            overlay.appendChild(span);
            span.addEventListener('animationend', () => span.remove());
        };

        mine.addEventListener('click', clickHandler);
        mine.addEventListener('touchend', clickHandler);

        // 8 秒倒计时
        const interval = 50; // 50ms 精度
        this.goldenMineTimer = setInterval(() => {
            remaining -= interval / 1000;
            if (remaining <= 0) remaining = 0;
            this.el.goldenTimer.textContent = remaining.toFixed(1) + 's';

            if (remaining <= 0) {
                clearInterval(this.goldenMineTimer);
                this.goldenMineTimer = null;
                mine.removeEventListener('click', clickHandler);
                mine.removeEventListener('touchend', clickHandler);
                this._goldenExplode();
            }
        }, interval);
    }

    _goldenExplode() {
        // 爆炸 +99999
        this.totalScore += 99999;
        this.levelScore += 99999;
        this._uiScore();

        // 统计追踪
        this.stats.goldenMineFound = (this.stats.goldenMineFound || 0) + 1;
        saveStats(this.stats);

        this.el.goldenMine.classList.add('exploding');
        this.el.goldenScore.textContent = `+${this.goldenMineClicks * 1000 + 99999}`;
        this.el.goldenTimer.textContent = '💥 BOOM!';

        this._playSound('goldenExplode');
        this._haptic('win');

        // 金色粒子爆发
        for (let i = 0; i < 30; i++) {
            setTimeout(() => this._spawnGoldenParticle(), i * 30);
        }

        // 2 秒后关闭叠层，恢复游戏
        setTimeout(() => {
            this.el.goldenOverlay.classList.remove('active');
            this.goldenMineActive = false;

            // 标记一生一次（等关卡结束后写入）
            this._goldenMineDone = true;

            // 恢复计时
            this.state = 'playing';
            this.lastTick = performance.now();

            this._uiMineCount();
            if (this.board.isComplete()) {
                this._applyWinBonus();
                this._endGame('win');
            }
        }, 2000);
    }

    _spawnGoldenParticle() {
        const container = this.el.goldenParticles;
        const p = document.createElement('div');
        p.className = 'golden-particle';
        const angle = Math.random() * Math.PI * 2;
        const dist = 40 + Math.random() * 120;
        p.style.setProperty('--dx', (Math.cos(angle) * dist) + 'px');
        p.style.setProperty('--dy', (Math.sin(angle) * dist) + 'px');
        p.style.left = '50%';
        p.style.top = '45%';
        const size = 4 + Math.random() * 8;
        p.style.width = size + 'px';
        p.style.height = size + 'px';
        const colors = ['#FFD700', '#F0C040', '#FFA500', '#FFEC8B', '#FFE4B5'];
        p.style.background = colors[(Math.random() * colors.length) | 0];
        container.appendChild(p);
        p.addEventListener('animationend', () => p.remove());
    }

    // ==================== 安全翻开 ====================

    _onSafeReveal(cells) {
        const n = cells.length;
        this.combo += n;
        const mult = this.combo >= 10 ? 3 : this.combo >= 5 ? 2 : 1;
        const basePoints = (n * 10 + Math.max(0, n - 1) * 5) * mult;
        const points = Math.round(basePoints * this.scoreMult);
        this.levelScore += points;
        this.totalScore += points;

        // 统计追踪
        this.stats.totalRevealed = (this.stats.totalRevealed || 0) + n;
        if (n > (this.stats.maxChain || 0)) this.stats.maxChain = n;
        if (this.combo >= 10) this.stats.combo10Count = (this.stats.combo10Count || 0) + 1;

        // 分数明细
        const rawBase = Math.round((n * 10 + Math.max(0, n - 1) * 5) * this.scoreMult);
        this.scoreBreakdown.base += rawBase;
        this.scoreBreakdown.combo += points - rawBase;

        this._uiScore();
        this._uiCombo();

        this.renderer.animateReveal(cells);
        this._playSound('pop', n);
        this._haptic(n >= 3 ? 'reveal' : 'tick');

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
        this.scoreBreakdown.timeBonus = tBonus;

        // 无伤通关加成：本关得分 +10%
        if (this.hitMines === 0) {
            const noDmgBonus = Math.round(this.levelScore * 0.1);
            this.totalScore += noDmgBonus;
            this.levelScore += noDmgBonus;
            this.noDmgBonus = noDmgBonus;
            this.scoreBreakdown.noDmgBonus = noDmgBonus;
            this.renderer.animateNoDamage();
        } else {
            this.noDmgBonus = 0;
            this.scoreBreakdown.noDmgBonus = 0;
        }

        this._uiScore();
    }

    // ==================== 勇气奖励 ====================

    _onCourageReveal(cells) {
        const n = cells.length;
        this.combo += n;
        this.courageCnt++;
        this.stats.totalCourage = (this.stats.totalCourage || 0) + 1;
        this._haptic('courage');

        // 固定奖励 1：+30% 总时间
        const timeRestore = Math.round(this.maxTime * 0.3);
        this.time = Math.min(this.time + timeRestore, this.maxTime);
        this._uiTimer();

        // 固定奖励 2：+1命（满血 → +20% 本关分）
        let lifeMsg = '';
        if (this.lives < this.MAX_LIVES) {
            this.lives++;
            this._uiLives();
            lifeMsg = '❤️ +1生命';
        } else {
            const extraPoints = Math.round(this.levelScore * 0.2);
            this.totalScore += extraPoints;
            this.levelScore += extraPoints;
            this.scoreBreakdown.courageExtra += extraPoints;
            lifeMsg = `💰 +${extraPoints}分`;
        }

        // 固定奖励 3：+20% 本关得分
        const bonusPoints = Math.round(this.levelScore * 0.2);
        this.totalScore += bonusPoints;
        this.levelScore += bonusPoints;
        this.scoreBreakdown.courage += bonusPoints;

        this._uiScore();
        this._uiCombo();

        // 翻开动画
        this.renderer.animateReveal(cells);
        this.renderer.animateCourage(1);
        this._playSound('courage');

        const mid = cells[Math.floor(cells.length / 2)];
        const { px, py } = this._boardToFloat(mid.x, mid.y);
        this.floats.spawn(`🎲 +${bonusPoints}`, px, py, '#FFD700', true);
        setTimeout(() => {
            this.floats.spawn(`⏰+${timeRestore}s`, px, py - 36, '#79C0FF');
        }, 200);
        setTimeout(() => {
            this.floats.spawn(lifeMsg, px, py - 64, '#3FB950');
        }, 400);

        this.state = 'courage';
        this._showCourageOverlay(bonusPoints, timeRestore, lifeMsg);
    }

    _showCourageOverlay(bonusPoints, timeRestore, lifeMsg) {
        this.el.courageScore.textContent = `+${bonusPoints}分 · ⏰+${timeRestore}s · ${lifeMsg}`;
        this.el.courageTime.textContent = '🎲 勇气奖励';
        this._spawnConfetti();
        this.el.courageOverlay.classList.add('active');

        setTimeout(() => {
            this.el.courageOverlay.classList.remove('active');
            this.state = 'playing';
            this.lastTick = performance.now();

            if (this.board.isComplete()) {
                this._applyWinBonus();
                this._endGame('win');
            }
        }, 2000);
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

        // 金雷一生一次标志位（关卡结束后写入）
        if (this._goldenMineDone) {
            this._goldenMineDone = false;
            this.goldenMineTriggered = true;
            try { localStorage.setItem(GOLDEN_KEY, '1'); } catch {}
        }
        // 清理金雷计时器
        if (this.goldenMineTimer) { clearInterval(this.goldenMineTimer); this.goldenMineTimer = null; }
        this.goldenMineActive = false;
        this.renderer.goldenBoardGlow = false;
        this.renderer.goldenMinePos = null;

        // === 成就统计更新 ===
        if (isWin) {
            this.stats.levelClears = (this.stats.levelClears || 0) + 1;

            // 无伤通关计数
            if (this.hitMines === 0) this.runNoDmgCount++;
            if (this.runNoDmgCount > (this.stats.bestRunNoDmg || 0)) {
                this.stats.bestRunNoDmg = this.runNoDmgCount;
            }

            // 闪电手：L8+ 实际用时 ≤ 30% 基础时间
            const timeSpent = this.maxTime - this.time;
            if (this.level >= 8 && timeSpent <= this.maxTime * 0.3) {
                this.stats.fastWins = (this.stats.fastWins || 0) + 1;
            }

            // 九死一生：1命 + 剩余≤3s
            if (this.lives === 1 && this.time <= 3) {
                this.stats.clutchWins = (this.stats.clutchWins || 0) + 1;
            }

            // 第25关通关 → 一周目完成
            if (this.level >= 25) {
                this.stats.totalClears = (this.stats.totalClears || 0) + 1;
                // 最高单周目得分
                if (this.totalScore > (this.stats.bestRunScore || 0)) {
                    this.stats.bestRunScore = this.totalScore;
                }
                // 修饰器一周目成就
                if (this.runAllIn) this.stats.allInClears = (this.stats.allInClears || 0) + 1;
                if (this.runNoFlag) this.stats.noFlagClears = (this.stats.noFlagClears || 0) + 1;
                if (this.runChill) this.stats.chillFullClears = (this.stats.chillFullClears || 0) + 1;
            }
        }
        saveStats(this.stats);

        // 检查新解锁成就
        const newUnlocks = this._checkAchievements();

        if (isWin) {
            this.lives = Math.min(this.MAX_LIVES, this.lives + 1);
            this._uiLives();
            this.renderer.animateVictory();
            this._playSound('win');
            this._haptic('win');
        } else {
            // 游戏失败 → 清除存档
            clearSave();
            if (reason === 'time') {
                // 时间到：雷依次翻出 + 全屏爆炸
                const mines = this.board.revealMines();
                if (mines.length > 0) this.renderer.animateTimeoutExplosion(mines);
                this._playSound('timeout');
                this._haptic('gameOver');
            } else {
                const mines = this.board.revealMines();
                if (mines.length > 0) this.renderer.animateRevealMines(mines);
            }
        }

        let isNewRecord = false;
        const reachedLevel = isWin ? Math.min(this.level + 1, 25) : this.level;
        if (reachedLevel > this.records.bestLevel || this.totalScore > this.records.bestScore) {
            this.records.bestLevel = Math.max(this.records.bestLevel, reachedLevel);
            this.records.bestScore = Math.max(this.records.bestScore, this.totalScore);
            saveRecords(this.records);
            isNewRecord = true;
        }

        const delay = isWin ? 900 : 600;
        setTimeout(() => {
            const sb = this.scoreBreakdown;

            if (isWin) {
                const isFinalLevel = this.level >= 25;
                this.el.title.textContent = isFinalLevel
                    ? '🏆 全部通关！'
                    : `🎉 第${this.level}关 通关！`;
                // 构建分数明细表
                let rows = '';
                rows += this._scoreRow('翻开得分', sb.base);
                if (sb.combo > 0) rows += this._scoreRow('Combo加成', sb.combo);
                if (sb.courage > 0) rows += this._scoreRow('🎲 勇气奖励', sb.courage);
                if (sb.courageExtra > 0) rows += this._scoreRow('🎲 勇气额外', sb.courageExtra);
                if (sb.penalty > 0) rows += this._scoreRow('踩雷扣分', -sb.penalty, true);
                rows += '<div class="score-row score-divider"></div>';
                rows += this._scoreRow('⏰ 时间奖励', sb.timeBonus);
                if (sb.noDmgBonus > 0) rows += this._scoreRow('🛡️ 无伤加成', sb.noDmgBonus);
                if (this.scoreMult > 1) rows += `<div class="score-row score-mult"><span>修饰器倍率</span><span>×${this.scoreMult.toFixed(1)}</span></div>`;
                rows += '<div class="score-row score-divider"></div>';
                rows += `<div class="score-row score-total"><span>本关合计</span><span>+${this.levelScore}</span></div>`;
                if (!isFinalLevel) rows += `<div class="score-row score-life"><span>❤️ +1 生命</span><span></span></div>`;
                this.el.scoreTable.innerHTML = rows;

                if (isFinalLevel) {
                    this.el.nextBtn.classList.add('hidden');
                    this.el.restart.textContent = '再来一次';
                    clearSave();
                } else {
                    this.el.nextBtn.classList.remove('hidden');
                    this.el.restart.textContent = '重新开始';
                }
            } else {
                this.el.title.textContent = reason === 'time' ? '💥 时间到，雷爆了！' : '💥 游戏结束';
                // 失败统计
                let rows = '';
                rows += `<div class="score-row"><span>到达关卡</span><span>第${this.level}关</span></div>`;
                rows += `<div class="score-row"><span>本关得分</span><span>+${this.levelScore}</span></div>`;
                if (this.courageCnt > 0) rows += `<div class="score-row"><span>🎲 勇气时刻</span><span>×${this.courageCnt}</span></div>`;
                if (this.hitMines > 0) rows += `<div class="score-row"><span>踩雷次数</span><span>${this.hitMines}</span></div>`;
                this.el.scoreTable.innerHTML = rows;

                this.el.nextBtn.classList.add('hidden');
                this.el.restart.textContent = '再来一次';
            }
            this.el.oScore.textContent = this.totalScore;
            this.el.record.textContent = isNewRecord
                ? '🏆 新纪录！'
                : `最高: 第${this.records.bestLevel}关 · ${this.records.bestScore}分`;
            this.el.record.classList.toggle('new-record', isNewRecord);

            // 显示新解锁成就
            const unlockDiv = document.getElementById('achieveUnlocks');
            if (newUnlocks.length > 0) {
                const tierNames = ['', '铜', '银', '金'];
                const tierColors = ['', '#CD7F32', '#C0C0C0', '#FFD700'];
                unlockDiv.innerHTML = newUnlocks.map(u => {
                    const isSingle = u.tiers && u.tiers.length === 1;
                    const tName = isSingle ? '金' : tierNames[u.tier];
                    const tColor = isSingle ? '#FFD700' : tierColors[u.tier];
                    return `<div class="achieve-unlock-item">${u.icon} ${u.name} <span class="achieve-unlock-tier" style="color:${tColor}">${tName}</span></div>`;
                }).join('');
                unlockDiv.style.display = '';
                this._showAchieveToast(newUnlocks);
            } else {
                unlockDiv.innerHTML = '';
                unlockDiv.style.display = 'none';
            }

            this.el.overlay.classList.add('active');
        }, reason === 'time' ? 1200 : delay);
    }

    _scoreRow(label, value, isNeg) {
        const color = isNeg ? 'color:#F85149' : '';
        const prefix = isNeg ? '' : '+';
        return `<div class="score-row"><span>${label}</span><span style="${color}">${prefix}${value}</span></div>`;
    }

    // ==================== 分享卡片 ====================

    _shareResult() {
        const cvs = this.el.shareCanvas;
        const W = 640, H = 400;
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');

        // 背景渐变
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#0D1117');
        bg.addColorStop(0.5, '#161B22');
        bg.addColorStop(1, '#0D1117');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // 装饰网格
        ctx.strokeStyle = 'rgba(48,54,61,0.3)';
        ctx.lineWidth = 1;
        for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        // 左侧发光效果
        const glow = ctx.createRadialGradient(120, H / 2, 0, 120, H / 2, 200);
        glow.addColorStop(0, 'rgba(35,134,54,0.15)');
        glow.addColorStop(1, 'transparent');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);

        // 标题
        ctx.font = '700 26px system-ui, sans-serif';
        ctx.fillStyle = '#C9D1D9';
        ctx.textAlign = 'left';
        ctx.fillText('💣 ScanBoomBoom', 36, 52);

        // 副标题
        ctx.font = '400 13px system-ui, sans-serif';
        ctx.fillStyle = '#6E7681';
        ctx.fillText('60秒神经扫雷', 36, 74);

        // 判断胜负
        const isWin = this.state === 'ended' && this.el.nextBtn && !this.el.nextBtn.classList.contains('hidden');
        const isFinalWin = this.level >= 25 && isWin;

        // 状态大字
        ctx.textAlign = 'center';
        if (isFinalWin) {
            ctx.font = '900 36px system-ui, sans-serif';
            ctx.fillStyle = '#F0C040';
            ctx.fillText('🏆 全部通关！', W / 2, 140);
        } else if (isWin) {
            ctx.font = '900 36px system-ui, sans-serif';
            ctx.fillStyle = '#3FB950';
            ctx.fillText(`🎉 第${this.level}关 通关！`, W / 2, 140);
        } else {
            ctx.font = '900 36px system-ui, sans-serif';
            ctx.fillStyle = '#F85149';
            ctx.fillText(`💥 挑战至第${this.level}关`, W / 2, 140);
        }

        // 总分
        ctx.font = '900 56px system-ui, sans-serif';
        ctx.fillStyle = '#3FB950';
        ctx.fillText(String(this.totalScore), W / 2, 210);
        ctx.font = '400 14px system-ui, sans-serif';
        ctx.fillStyle = '#8B949E';
        ctx.fillText('总 得 分', W / 2, 234);

        // 统计行
        const stats = [];
        stats.push(['到达关卡', `第${Math.min(isWin ? this.level + 1 : this.level, 25)}关`]);
        if (this.courageCnt > 0) stats.push(['勇气时刻', `×${this.courageCnt}`]);
        if (this.hitMines > 0) stats.push(['踩雷次数', String(this.hitMines)]);
        if (this.scoreMult > 1) stats.push(['修饰器倍率', `×${this.scoreMult.toFixed(1)}`]);

        const statY = 270;
        const statGap = W / (stats.length + 1);
        ctx.font = '700 18px system-ui, sans-serif';
        stats.forEach((s, i) => {
            const x = statGap * (i + 1);
            ctx.fillStyle = '#58A6FF';
            ctx.fillText(s[1], x, statY);
            ctx.font = '400 11px system-ui, sans-serif';
            ctx.fillStyle = '#6E7681';
            ctx.fillText(s[0], x, statY + 18);
            ctx.font = '700 18px system-ui, sans-serif';
        });

        // 底部装饰线
        const lineGrad = ctx.createLinearGradient(60, 0, W - 60, 0);
        lineGrad.addColorStop(0, 'transparent');
        lineGrad.addColorStop(0.5, '#30363D');
        lineGrad.addColorStop(1, 'transparent');
        ctx.strokeStyle = lineGrad;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(60, 310); ctx.lineTo(W - 60, 310); ctx.stroke();

        // 邀请文字
        ctx.font = '400 14px system-ui, sans-serif';
        ctx.fillStyle = '#8B949E';
        ctx.textAlign = 'center';
        ctx.fillText('你能超过我吗？来挑战 👉 ScanBoomBoom', W / 2, 340);

        // 底部版本
        ctx.font = '400 11px system-ui, sans-serif';
        ctx.fillStyle = '#484F58';
        ctx.fillText('ScanBoomBoom v2.1', W / 2, 375);

        // 边框
        ctx.strokeStyle = '#30363D';
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - 2);

        // 导出
        cvs.toBlob(blob => {
            if (!blob) return;
            const file = new File([blob], 'scanboom-result.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: 'ScanBoomBoom', text: '来挑战 ScanBoomBoom！' }).catch(() => {});
            } else {
                // 降级：下载图片
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'scanboom-result.png';
                a.click();
                URL.revokeObjectURL(a.href);
            }
        }, 'image/png');
    }

    _shareAchieveWall() {
        const cvs = this.el.shareCanvas;
        const tierColors = ['#30363D', '#CD7F32', '#C0C0C0', '#FFD700'];
        const cols = 3;
        const pad = 30;
        const cardW = 170, cardH = 100, gap = 12;
        const visibleAchs = ACHIEVEMENTS.filter(a => !(a.hidden && !(this.achievements[a.id] || {}).tier));
        const rows = Math.ceil(visibleAchs.length / cols);
        const W = pad * 2 + cols * cardW + (cols - 1) * gap;
        const H = 90 + rows * (cardH + gap) + 80;
        cvs.width = W; cvs.height = H;
        const ctx = cvs.getContext('2d');

        // 背景
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, '#0D1117'); bg.addColorStop(0.5, '#161B22'); bg.addColorStop(1, '#0D1117');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

        // 标题
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.fillStyle = '#C9D1D9'; ctx.textAlign = 'center';
        ctx.fillText('🏆 成就墙', W / 2, 40);

        // 统计
        let unlocked = 0, total = visibleAchs.length;
        for (const a of visibleAchs) { if ((this.achievements[a.id] || {}).tier) unlocked++; }
        ctx.font = '400 13px system-ui, sans-serif';
        ctx.fillStyle = '#6E7681';
        ctx.fillText(`${unlocked} / ${total} 已解锁`, W / 2, 62);

        // 卡片
        const startY = 80;
        visibleAchs.forEach((ach, i) => {
            const col = i % cols, row = (i / cols) | 0;
            const x = pad + col * (cardW + gap);
            const y = startY + row * (cardH + gap);
            const data = this.achievements[ach.id] || { tier: 0 };
            const tier = data.tier;
            const maxTier = ach.tiers.length;
            const color = tier > 0 ? ((maxTier === 1) ? '#FFD700' : tierColors[Math.min(tier, 3)]) : '#30363D';
            const locked = tier === 0;

            // 卡片背景
            ctx.fillStyle = '#161B22';
            ctx.beginPath();
            this._canvasRoundRect(ctx, x, y, cardW, cardH, 8);
            ctx.fill();

            // 边框
            ctx.strokeStyle = color;
            ctx.lineWidth = locked ? 1 : 2;
            ctx.globalAlpha = locked ? 0.4 : 1;
            ctx.beginPath();
            this._canvasRoundRect(ctx, x, y, cardW, cardH, 8);
            ctx.stroke();
            ctx.globalAlpha = 1;

            // 图标
            ctx.font = '28px serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.globalAlpha = locked ? 0.3 : 1;
            ctx.fillText(ach.hidden && tier === 0 ? '❓' : ach.icon, x + cardW / 2, y + 32);

            // 名称
            ctx.font = '600 12px system-ui, sans-serif';
            ctx.fillStyle = locked ? '#484F58' : '#C9D1D9';
            ctx.fillText(ach.hidden && tier === 0 ? '???' : ach.name, x + cardW / 2, y + 62);

            // 记录值
            if (!ach.hidden || tier > 0) {
                const val = ach.check(this.stats);
                ctx.font = '700 11px system-ui, sans-serif';
                ctx.fillStyle = locked ? '#30363D' : color;
                ctx.fillText(String(val), x + cardW / 2, y + 82);
            }
            ctx.globalAlpha = 1;
            ctx.fillStyle = '#C9D1D9';
        });

        // 底部
        ctx.font = '400 11px system-ui, sans-serif';
        ctx.fillStyle = '#484F58'; ctx.textAlign = 'center';
        ctx.fillText('ScanBoomBoom v2.1', W / 2, H - 20);

        // 边框
        ctx.strokeStyle = '#30363D'; ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, W - 2, H - 2);

        // 导出
        cvs.toBlob(blob => {
            if (!blob) return;
            const file = new File([blob], 'scanboom-achievements.png', { type: 'image/png' });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                navigator.share({ files: [file], title: 'ScanBoomBoom 成就墙' }).catch(() => {});
            } else {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'scanboom-achievements.png';
                a.click();
                URL.revokeObjectURL(a.href);
            }
        }, 'image/png');
    }

    _canvasRoundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
    }

    // ==================== 存档 ====================

    _writeSave() {
        writeSave({
            level: this.level,
            totalScore: this.totalScore,
            lives: this.lives,
            combo: this.combo,
            courageCnt: this.courageCnt,
        });
    }

    // ==================== UI ====================

    _uiAll() {
        this._uiLives(); this._uiScore(); this._uiTimer(); this._uiLevel(); this._uiCombo(); this._uiMineCount();
    }

    _uiLives() {
        this.el.lives.textContent = '❤️'.repeat(this.lives) + '🖤'.repeat(this.MAX_LIVES - this.lives);
    }

    _uiLevel() {
        this.el.level.textContent = `第${this.level}关`;
        // 修饰器徽章
        if (this.activeMods.size > 0) {
            const icons = [...this.activeMods].map(k => MODIFIERS[k].icon).join('');
            this.el.modBadge.textContent = `${icons} ×${this.scoreMult.toFixed(1)}`;
        } else {
            this.el.modBadge.textContent = '';
        }
    }

    _uiTimer() {
        const s = Math.max(0, Math.ceil(this.time));
        const m = (s / 60) | 0, sec = s % 60;
        this.el.timer.textContent = String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        this.el.timer.classList.toggle('urgent', this.time <= 10 && this.state === 'playing');
        // 时间进度条
        const pct = Math.max(0, Math.min(100, (this.time / this.maxTime) * 100));
        this.el.timeBarFill.style.width = pct + '%';
        if (pct > 40) this.el.timeBarFill.className = 'time-bar-fill';
        else if (pct > 15) this.el.timeBarFill.className = 'time-bar-fill time-warn';
        else this.el.timeBarFill.className = 'time-bar-fill time-danger';
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

    _uiMineCount() {
        if (!this.board) { this.el.mineCount.textContent = '💣 0'; return; }
        let flagged = 0, revealedMines = 0;
        for (const c of this.board.cells) {
            if (c.flagged) flagged++;
            if (c.mine && c.revealed) revealedMines++;
        }
        const remaining = this.board.mineCount - flagged - revealedMines;
        this.el.mineCount.textContent = `💣 ${remaining}`;
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
        if (!this.settings.sound) return;
        this._initAudio();
        const ctx = this.audioCtx;
        if (!ctx) return;
        const t = ctx.currentTime;

        if (type === 'pop') {
            const n = Math.min(count || 1, 15);
            if (n >= 5) {
                // 连锁音阶：do-re-mi-fa-sol 上行（C大调宫调式）
                const scale = [523, 587, 659, 698, 784, 880, 988, 1047];
                for (let i = 0; i < n; i++) {
                    const osc = ctx.createOscillator(), g = ctx.createGain();
                    osc.connect(g); g.connect(ctx.destination);
                    osc.type = 'sine';
                    const noteIdx = Math.min(i, scale.length - 1);
                    osc.frequency.value = scale[noteIdx] + this.combo * 4;
                    const s = t + i * 0.04;
                    g.gain.setValueAtTime(0.07, s);
                    g.gain.exponentialRampToValueAtTime(0.001, s + 0.1);
                    osc.start(s); osc.stop(s + 0.12);
                }
            } else {
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
        } else if (type === 'joker') {
            // 小丑雷：调皮的下降“哇哇”音
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(600, t);
            osc.frequency.exponentialRampToValueAtTime(200, t + 0.4);
            g.gain.setValueAtTime(0.12, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t); osc.stop(t + 0.55);
            // 叠加方波颤音
            const osc2 = ctx.createOscillator(), g2 = ctx.createGain();
            osc2.connect(g2); g2.connect(ctx.destination);
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(300, t + 0.1);
            osc2.frequency.exponentialRampToValueAtTime(100, t + 0.45);
            g2.gain.setValueAtTime(0.04, t + 0.1);
            g2.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc2.start(t + 0.1); osc2.stop(t + 0.55);
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
        } else if (type === 'magma') {
            // 岩浆雷：低频轰鸣 + 气泡上升音
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(50, t + 0.3);
            g.gain.setValueAtTime(0.15, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
            osc.start(t); osc.stop(t + 0.4);
            // 气泡上升
            for (let i = 0; i < 3; i++) {
                const o2 = ctx.createOscillator(), g2 = ctx.createGain();
                o2.connect(g2); g2.connect(ctx.destination);
                o2.type = 'sine';
                const s = t + 0.1 + i * 0.08;
                o2.frequency.setValueAtTime(300 + i * 150, s);
                o2.frequency.exponentialRampToValueAtTime(600 + i * 200, s + 0.1);
                g2.gain.setValueAtTime(0.06, s);
                g2.gain.exponentialRampToValueAtTime(0.001, s + 0.12);
                o2.start(s); o2.stop(s + 0.15);
            }
        } else if (type === 'modSelect') {
            // 金属锁扣 "咔"：短促高频 + 低频撞击
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(1800, t);
            osc.frequency.exponentialRampToValueAtTime(800, t + 0.04);
            g.gain.setValueAtTime(0.1, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
            osc.start(t); osc.stop(t + 0.08);
            // 低频撞击
            const osc2 = ctx.createOscillator(), g2 = ctx.createGain();
            osc2.connect(g2); g2.connect(ctx.destination);
            osc2.type = 'sine';
            osc2.frequency.value = 200;
            g2.gain.setValueAtTime(0.08, t + 0.02);
            g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc2.start(t + 0.02); osc2.stop(t + 0.1);
        } else if (type === 'modDeselect') {
            // 轻弹回 "嘀"：短促下降音
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1000, t);
            osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
            g.gain.setValueAtTime(0.07, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc.start(t); osc.stop(t + 0.1);
        } else if (type === 'goldenFind') {
            // 金雷发现：魔法上行琶音 + 闪光和弦
            const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
            notes.forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const s = t + i * 0.06;
                g.gain.setValueAtTime(0.12, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.5);
                osc.start(s); osc.stop(s + 0.55);
            });
            // 闪烁泛音
            [1047, 1568, 2093].forEach((freq) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'triangle';
                osc.frequency.value = freq;
                const s = t + 0.3;
                g.gain.setValueAtTime(0.08, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.8);
                osc.start(s); osc.stop(s + 0.9);
            });
        } else if (type === 'goldenTap') {
            // 金雷点击：逐步上升的叮音
            const n = count || 1;
            const freq = 600 + Math.min(n, 80) * 15;
            const osc = ctx.createOscillator(), g = ctx.createGain();
            osc.connect(g); g.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = freq;
            g.gain.setValueAtTime(0.1, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            osc.start(t); osc.stop(t + 0.1);
        } else if (type === 'goldenExplode') {
            // 金雷爆炸：华丽上行大和弦 + 重低音
            [523, 659, 784, 1047, 1319, 1568, 2093, 2637].forEach((freq, i) => {
                const osc = ctx.createOscillator(), g = ctx.createGain();
                osc.connect(g); g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = freq;
                const s = t + i * 0.04;
                g.gain.setValueAtTime(0.1, s);
                g.gain.exponentialRampToValueAtTime(0.001, s + 0.6);
                osc.start(s); osc.stop(s + 0.65);
            });
            // 宏大低音
            const bass = ctx.createOscillator(), bg = ctx.createGain();
            bass.connect(bg); bg.connect(ctx.destination);
            bass.type = 'sine';
            bass.frequency.value = 65;
            bg.gain.setValueAtTime(0.2, t + 0.2);
            bg.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
            bass.start(t + 0.2); bass.stop(t + 0.9);
        }
    }

    // ==================== 设置 ====================

    _toggleSettings() {
        const active = this.el.settingsOverlay.classList.toggle('active');
        if (active) this._applySettingsUI();
    }

    _applyFlagMode() {
        this.flagMode = false;
        this.el.flagBtn.textContent = '⛏️';
        this.el.flagBtn.classList.remove('active');
        this.renderer.flagMode = false;
    }

    _applySettingsUI() {
        const r = document.querySelector(`input[name="flagMode"][value="${this.settings.flagMode}"]`);
        if (r) r.checked = true;
        const s = document.getElementById('soundToggle');
        if (s) s.checked = this.settings.sound;
        const v = document.getElementById('vibrationToggle');
        if (v) v.checked = this.settings.vibration;
    }

    // ==================== 触觉反馈抽象层 ====================
    // Web 阶段: navigator.vibrate() 降级
    // App 阶段: 替换为 Capacitor @capacitor/haptics
    //   impact({ style: 'light' })       → reveal
    //   impact({ style: 'medium' })      → flag / blueMine
    //   impact({ style: 'heavy' })       → mine
    //   notification({ type: 'success' })→ win
    //   notification({ type: 'error' })  → gameOver
    //   notification({ type: 'warning' })→ courage
    //   selectionChanged()               → tick

    _haptic(type) {
        if (!this.settings.vibration) return;

        // -- Web 降级实现（仅 Android 生效） --
        if (navigator.vibrate) {
            const patterns = {
                tick:     5,
                reveal:   8,
                flag:     15,
                blueMine: 40,
                mine:     80,
                courage:  [30, 20, 50],
                win:      [20, 15, 20, 15, 30],
                gameOver: [80, 40, 80],
            };
            const p = patterns[type];
            if (p) navigator.vibrate(p);
        }

        // -- Capacitor 实现（打包 App 时启用） --
        // if (window.Capacitor?.Plugins?.Haptics) {
        //     const H = window.Capacitor.Plugins.Haptics;
        //     const map = {
        //         tick:     () => H.selectionChanged(),
        //         reveal:   () => H.impact({ style: 'light' }),
        //         flag:     () => H.impact({ style: 'medium' }),
        //         blueMine: () => H.impact({ style: 'medium' }),
        //         mine:     () => H.impact({ style: 'heavy' }),
        //         courage:  () => H.notification({ type: 'warning' }),
        //         win:      () => H.notification({ type: 'success' }),
        //         gameOver: () => H.notification({ type: 'error' }),
        //     };
        //     const fn = map[type];
        //     if (fn) fn();
        //     return;
        // }
    }

    // ==================== 主循环 ====================

    _loop() {
        const tick = (now) => {
            if (this.state === 'playing') {
                const dt = Math.min((now - this.lastTick) / 1000, 0.1);
                this.lastTick = now;
                this.time -= dt;
                this._uiTimer();
                this.renderer.timeWarning = this.time > 0 && this.time <= 10;
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
