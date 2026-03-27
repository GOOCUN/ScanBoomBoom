// ============================================
// game.js — 游戏控制器（状态机 + 输入 + 计时 + 音效）
// ============================================

class Game {
    constructor() {
        this.canvas = document.getElementById('board');
        this.renderer = new Renderer(this.canvas);

        // 游戏参数
        this.WIDTH = 6;
        this.HEIGHT = 6;
        this.MINES = 6;
        this.MAX_LIVES = 3;
        this.GAME_TIME = 60;

        // 状态
        this.state = 'idle'; // idle | playing | ended
        this.board = null;
        this.lives = 0;
        this.score = 0;
        this.time = 0;
        this.lastTick = 0;

        // UI 元素缓存
        this.el = {
            lives:    document.getElementById('lives'),
            timer:    document.getElementById('timer'),
            score:    document.getElementById('score'),
            hint:     document.getElementById('hint'),
            overlay:  document.getElementById('overlay'),
            title:    document.getElementById('overlayTitle'),
            oScore:   document.getElementById('overlayScore'),
            msg:      document.getElementById('overlayMsg'),
            restart:  document.getElementById('restartBtn'),
        };

        // 音频上下文（延迟初始化）
        this.audioCtx = null;

        this._setupInput();
        this._newGame();
        this._loop();
    }

    // ==================== 输入处理 ====================

    _setupInput() {
        let touched = false;

        // 触摸（移动端）
        this.canvas.addEventListener('touchstart', e => {
            e.preventDefault();
            touched = true;
        }, { passive: false });

        this.canvas.addEventListener('touchend', e => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (t) {
                const r = this.canvas.getBoundingClientRect();
                this._click(t.clientX - r.left, t.clientY - r.top);
            }
            setTimeout(() => { touched = false; }, 300);
        }, { passive: false });

        // 鼠标点击（桌面端）
        this.canvas.addEventListener('click', e => {
            if (touched) return;
            const r = this.canvas.getBoundingClientRect();
            this._click(e.clientX - r.left, e.clientY - r.top);
        });

        // 鼠标悬停
        this.canvas.addEventListener('mousemove', e => {
            const r = this.canvas.getBoundingClientRect();
            this.renderer.hoverCell = this.renderer.hitTest(e.clientX - r.left, e.clientY - r.top);
        });
        this.canvas.addEventListener('mouseleave', () => {
            this.renderer.hoverCell = null;
        });

        // 窗口缩放
        window.addEventListener('resize', () => this.renderer.resize());

        // 再来一局
        this.el.restart.addEventListener('click', () => this._newGame());
    }

    // ==================== 游戏控制 ====================

    _newGame() {
        const seed = Date.now() ^ ((Math.random() * 0xFFFFFFFF) | 0);
        this.board = new Board(this.WIDTH, this.HEIGHT, this.MINES, seed);
        this.renderer.setBoard(this.board);

        this.lives = this.MAX_LIVES;
        this.score = 0;
        this.time = this.GAME_TIME;
        this.state = 'idle';
        this.lastTick = 0;

        this._uiLives();
        this._uiScore();
        this._uiTimer();
        this.el.hint.classList.remove('hidden');
        this.el.overlay.classList.remove('active');
    }

    _click(px, py) {
        if (this.state === 'ended') return;

        const pos = this.renderer.hitTest(px, py);
        if (!pos) return;

        // 首次点击 → 开始计时
        if (this.state === 'idle') {
            this.state = 'playing';
            this.lastTick = performance.now();
            this.el.hint.classList.add('hidden');
        }

        const result = this.board.reveal(pos.x, pos.y);
        if (!result) return;

        if (result.type === 'mine') {
            // 踩雷
            this.lives--;
            this.score = Math.max(0, this.score - 50);
            this._uiLives();
            this._uiScore();

            // 踩雷动画：pop + 爆炸闪光
            this.renderer.animateReveal([{ x: result.x, y: result.y, dist: 0 }]);
            this.renderer.animateExplosion(result.x, result.y);
            this._playSound('boom');

            if (this.lives <= 0) {
                this._endGame('dead');
            }
        } else {
            // 安全翻开
            const n = result.cells.length;
            this.score += n * 10 + Math.max(0, n - 1) * 5;
            this._uiScore();

            this.renderer.animateReveal(result.cells);
            this._playSound('pop', n);

            // 检查胜利
            if (this.board.isComplete()) {
                const bonus = Math.ceil(this.time) * 10;
                this.score += bonus;
                this._uiScore();
                this._endGame('win');
            }
        }
    }

    _endGame(reason) {
        this.state = 'ended';

        // 揭示剩余雷
        const mines = this.board.revealMines();
        if (mines.length > 0) this.renderer.animateRevealMines(mines);

        let title, msg;
        if (reason === 'win') {
            title = '🎉 胜利！';
            msg = `时间奖励 +${Math.ceil(this.time) * 10}`;
        } else if (reason === 'time') {
            title = '⏰ 时间到';
            msg = '60秒用完了';
        } else {
            title = '💥 游戏结束';
            msg = '生命耗尽';
        }

        // 延迟弹出结算，让玩家看到最终状态
        const delay = reason === 'win' ? 400 : 600;
        setTimeout(() => {
            this.el.title.textContent = title;
            this.el.oScore.textContent = this.score;
            this.el.msg.textContent = msg;
            this.el.overlay.classList.add('active');
        }, delay);
    }

    // ==================== UI 更新 ====================

    _uiLives() {
        this.el.lives.textContent =
            '❤️'.repeat(this.lives) + '🖤'.repeat(this.MAX_LIVES - this.lives);
    }

    _uiTimer() {
        const s = Math.max(0, Math.ceil(this.time));
        const m = (s / 60) | 0;
        const sec = s % 60;
        this.el.timer.textContent =
            String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
        this.el.timer.classList.toggle('urgent', this.time <= 10 && this.state === 'playing');
    }

    _uiScore() {
        this.el.score.textContent = this.score;
        // 分数跳动动画
        this.el.score.classList.remove('score-bump');
        void this.el.score.offsetWidth; // 强制 reflow
        this.el.score.classList.add('score-bump');
    }

    // ==================== 音效（Web Audio 程序化生成） ====================

    _initAudio() {
        if (this.audioCtx) return;
        try {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { /* 静音回退 */ }
    }

    _playSound(type, count) {
        this._initAudio();
        const ctx = this.audioCtx;
        if (!ctx) return;
        const t = ctx.currentTime;

        if (type === 'pop') {
            // 连锁翻开：递升音调
            const n = Math.min(count || 1, 12);
            for (let i = 0; i < n; i++) {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.connect(g);
                g.connect(ctx.destination);
                osc.type = 'sine';
                osc.frequency.value = 600 + i * 100;
                const start = t + i * 0.035;
                g.gain.setValueAtTime(0.06, start);
                g.gain.exponentialRampToValueAtTime(0.001, start + 0.08);
                osc.start(start);
                osc.stop(start + 0.1);
            }
        } else if (type === 'boom') {
            // 踩雷：低频爆炸
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.connect(g);
            g.connect(ctx.destination);
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, t);
            osc.frequency.exponentialRampToValueAtTime(60, t + 0.25);
            g.gain.setValueAtTime(0.15, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
            osc.start(t);
            osc.stop(t + 0.35);
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

// 启动
new Game();
