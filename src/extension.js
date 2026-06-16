// Notchi 顶栏宠物 — GNOME Shell 42 扩展
// 监听 unix socket 上 Claude Code hook 推来的事件，驱动顶栏 emoji 宠物：
// 多会话多宠物、脉冲动画、情绪表情、展开面板（会话/用量/活动）、可选音效。

const { St, Clutter, Gio, GLib, GObject } = imports.gi;
const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

// socket 放家目录（容器/宿主共享挂载），两个 Claude Code 账号都能推事件。
function socketPath() {
    const env = GLib.getenv('NOTCHI_SOCK');
    if (env && env.length > 0)
        return env;
    return GLib.build_filenamev([GLib.get_home_dir(), '.cache', 'notchi', 'notchi.sock']);
}

// Claude Code hook 事件名 → 宠物状态
const EVENT_MAP = {
    UserPromptSubmit: 'thinking',
    PreToolUse:       'working',
    PostToolUse:      'working',
    Notification:     'attention',
    Stop:             'done',
    SubagentStop:     'working',
    PreCompact:       'thinking',
    SessionStart:     'idle',
    SessionEnd:       'idle',
};

const STATE_LABEL = {
    idle: '待机', thinking: '思考中', working: '干活中',
    attention: '求关注', done: '完成', error: '出错',
};

// 多会话时给每个 session 分配一只不同的宠物 emoji（轮询，emoji 模式下用）
const PETS = ['🐱', '🐶', '🦊', '🐰', '🐼', '🐧', '🐯', '🦁', '🐸', '🐵', '🐹', '🐨'];

// design 交付的像素角色家族（src/icons/mascots/<family>/<state>.svg）；random 模式下轮询分配
const MASCOTS = ['slime', 'linedog', 'shoujo', 'loli', 'shiro'];

// 角色家族 + 状态 → SVG 图标（Gio.FileIcon）；文件缺失返回 null（调用方降级到 emoji）
function mascotGicon(family, state) {
    if (!family || family === 'emoji' || MASCOTS.indexOf(family) < 0)
        return null;
    const path = GLib.build_filenamev([Me.path, 'icons', 'mascots', family, `${state}.svg`]);
    const f = Gio.File.new_for_path(path);
    if (!f.query_exists(null))
        return null;
    return new Gio.FileIcon({ file: f });
}

// 顶层独立图标（account / account-stale / idle-empty 等）；文件缺失返回 null
function iconGicon(name) {
    const path = GLib.build_filenamev([Me.path, 'icons', `${name}.svg`]);
    const f = Gio.File.new_for_path(path);
    if (!f.query_exists(null))
        return null;
    return new Gio.FileIcon({ file: f });
}

// 状态图标（含 thinking 情绪变体）：思考态若有 thinking-<mood>.svg 就用，否则降级回 thinking.svg
function stateGicon(family, state, mood) {
    if (state === 'thinking' && mood && mood !== 'neutral') {
        const variant = mascotGicon(family, `thinking-${mood}`);
        if (variant)
            return variant;
    }
    return mascotGicon(family, state);
}

// 状态 + 情绪 → 表情脸。思考态按 mood 变脸。
function faceFor(state, mood) {
    if (state === 'thinking') {
        return { happy: '😊', anxious: '😰', confused: '😕', neutral: '🤔' }[mood] || '🤔';
    }
    return { idle: '😴', working: '💪', attention: '❓', done: '🎉', error: '😵' }[state] || '😴';
}

const SOUND_ID = { done: 'complete', attention: 'bell', error: 'dialog-error' };
const SESSION_IDLE_TIMEOUT_US = 10 * 60 * 1000 * 1000; // 10 分钟无事件则清理
const DONE_REVERT_SECONDS = 3;

function fmtDur(us) {
    let s = Math.floor(us / 1000000);
    if (s < 60)
        return `${s}秒`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}分${s % 60}秒`;
    const h = Math.floor(m / 60);
    return `${h}时${m % 60}分`;
}

// ISO8601 时间戳 → 距现在还剩多久（如 "3天19时" / "1时28分" / "<1分"）
function fmtRemaining(iso) {
    if (!iso)
        return '';
    let target = null;
    try { target = GLib.DateTime.new_from_iso8601(iso, null); } catch (e) {}
    if (!target)
        return '';
    const diffUs = target.difference(GLib.DateTime.new_now_local()); // target - now (微秒)
    if (diffUs <= 0)
        return '可重置';
    let s = Math.floor(diffUs / 1000000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60);
    if (d > 0) return `${d}天${h}时`;
    if (h > 0) return `${h}时${m}分`;
    if (m > 0) return `${m}分`;
    return '<1分';
}

// unix 秒时间戳 → "多久前"（如 "刚刚" / "12分钟前" / "3小时前" / "2天前"）
function fmtAgo(unixSec) {
    if (!unixSec)
        return '';
    let s = GLib.DateTime.new_now_local().to_unix() - unixSec;
    if (s < 0) s = 0;
    if (s < 60) return '刚刚';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}小时前`;
    return `${Math.floor(h / 24)}天前`;
}

const NotchiIndicator = GObject.registerClass({
    Signals: {
        'request-usage': {},
        'menu-opened': {},
    },
}, class NotchiIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Notchi', false);
        this._settings = settings;

        // 顶栏容器：像素图标(mascot) + emoji(降级/emoji 模式) + 多会话角标 +N
        this._box = new St.BoxLayout({
            style_class: 'notchi-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Icon({
            style_class: 'notchi-icon',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._icon.set_icon_size(20);
        this._emoji = new St.Label({
            text: '😴',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'notchi-emoji',
        });
        this._badge = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'notchi-badge',
            visible: false,
        });
        this._box.add_child(this._icon);
        this._box.add_child(this._emoji);
        this._box.add_child(this._badge);
        this.add_child(this._box);

        this._sessions = new Map();   // session_id -> {pet,family,state,mood,startTs,lastTs,lastEvent,doneTimer}
        this._activeId = null;
        this._petCursor = 0;
        this._pulseTimer = 0;
        this._pulseUp = false;

        this._buildMenu();
        this._refreshTopbar();
    }

    _buildMenu() {
        this._sessionSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._sessionSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._usageSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._usageSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = new PopupMenu.PopupMenuItem('立即刷新用量');
        this._refreshItem.connect('activate', () => this.emit('request-usage'));
        this.menu.addMenuItem(this._refreshItem);

        let reset = new PopupMenu.PopupMenuItem('全部重置为待机');
        reset.connect('activate', () => this.resetAll());
        this.menu.addMenuItem(reset);

        let prefs = new PopupMenu.PopupMenuItem('设置');
        prefs.connect('activate', () => ExtensionUtils.openPrefs());
        this.menu.addMenuItem(prefs);

        // 面板打开时刷新会话区时长 + 节流刷新用量
        this.menu.connect('open-state-changed', (menu, open) => {
            if (open) {
                this._rebuildSessions();
                this.emit('menu-opened');
            }
        });
    }

    _now() {
        return GLib.get_monotonic_time();
    }

    // 按设置给新会话分配角色家族：固定角色 / random 轮询 / emoji
    _familyForNew() {
        const setting = this._settings.get_string('mascot-family');
        if (setting === 'emoji')
            return 'emoji';
        if (setting === 'random')
            return MASCOTS[this._petCursor % MASCOTS.length];
        return setting; // 固定角色（slime/linedog/...）
    }

    // 设置里的角色改了 → 重算所有会话的家族并重绘
    applyMascotSetting() {
        const setting = this._settings.get_string('mascot-family');
        let i = 0;
        for (const [, s] of this._sessions) {
            if (setting === 'emoji')
                s.family = 'emoji';
            else if (setting === 'random')
                s.family = MASCOTS[i % MASCOTS.length];
            else
                s.family = setting;
            i++;
        }
        this._refreshTopbar();
        this._rebuildSessions();
    }

    // 无活跃会话时顶栏待机用哪个家族（固定角色就用它，否则 emoji 😴）
    _idleFamily() {
        const setting = this._settings.get_string('mascot-family');
        return MASCOTS.indexOf(setting) >= 0 ? setting : 'emoji';
    }

    // —— 事件入口 ——
    handleEvent(data) {
        const evt = (data && data.hook_event_name) ? data.hook_event_name : '';
        const sid = (data && data.session_id) ? String(data.session_id) : 'default';
        const now = this._now();

        if (evt === 'SessionEnd') {
            this._removeSession(sid);
            this._refreshTopbar();
            this._rebuildSessions();
            return;
        }

        const state = EVENT_MAP[evt] || 'idle';
        let s = this._sessions.get(sid);
        if (!s) {
            s = {
                pet: PETS[this._petCursor % PETS.length],
                family: this._familyForNew(),
                state: 'idle', mood: 'neutral',
                startTs: now, lastTs: now, lastEvent: evt, doneTimer: 0,
            };
            this._petCursor++;
            this._sessions.set(sid, s);
        }

        // 情绪（仅 UserPromptSubmit，且设置开启）
        if (evt === 'UserPromptSubmit' && this._settings.get_boolean('enable-sentiment') && data.notchi_mood)
            s.mood = data.notchi_mood;

        const prevState = s.state;
        s.state = state;
        s.lastTs = now;
        s.lastEvent = evt + (data.tool_name ? ` · ${data.tool_name}` : '');
        this._activeId = sid;

        // done/error 进入时播音 + 3 秒回待机
        if (s.doneTimer) {
            GLib.source_remove(s.doneTimer);
            s.doneTimer = 0;
        }
        if (state === 'done' || state === 'error' || state === 'attention') {
            if (prevState !== state)
                this._maybePlaySound(state);
        }
        if (state === 'done' || state === 'error') {
            s.doneTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, DONE_REVERT_SECONDS, () => {
                s.doneTimer = 0;
                s.state = 'idle';
                this._refreshTopbar();
                this._rebuildSessions();
                return GLib.SOURCE_REMOVE;
            });
        }

        this._pruneIdle();
        this._refreshTopbar();
        this._rebuildSessions();
    }

    _removeSession(sid) {
        const s = this._sessions.get(sid);
        if (s && s.doneTimer)
            GLib.source_remove(s.doneTimer);
        this._sessions.delete(sid);
        if (this._activeId === sid)
            this._activeId = this._mostRecentId();
    }

    _pruneIdle() {
        const now = this._now();
        for (const [sid, s] of this._sessions) {
            if (now - s.lastTs > SESSION_IDLE_TIMEOUT_US)
                this._removeSession(sid);
        }
    }

    _mostRecentId() {
        let best = null, bestTs = -1;
        for (const [sid, s] of this._sessions) {
            if (s.lastTs > bestTs) { bestTs = s.lastTs; best = sid; }
        }
        return best;
    }

    resetAll() {
        for (const [, s] of this._sessions) {
            if (s.doneTimer) GLib.source_remove(s.doneTimer);
        }
        this._sessions.clear();
        this._activeId = null;
        this._refreshTopbar();
        this._rebuildSessions();
    }

    // —— 顶栏 ——
    _refreshTopbar() {
        if (!this._activeId || !this._sessions.has(this._activeId))
            this._activeId = this._mostRecentId();

        if (!this._activeId) {
            // 无会话：优先用专门的待机图（像素睡月），缺失则降级到家族 idle / emoji 😴
            const empty = iconGicon('idle-empty');
            if (empty) {
                this._icon.gicon = empty;
                this._icon.visible = true;
                this._emoji.visible = false;
                this._badge.visible = false;
            } else {
                this._showState('idle', 'neutral', this._idleFamily(), '', 0);
            }
            this._stopPulse();
            return;
        }
        const s = this._sessions.get(this._activeId);
        const extra = this._sessions.size > 1 ? this._sessions.size - 1 : 0;
        this._showState(s.state, s.mood, s.family, s.pet, extra);

        if (s.state === 'working' || s.state === 'thinking')
            this._startPulse();
        else
            this._stopPulse();
    }

    // 把顶栏切到指定状态：有像素图标用图标，否则降级 emoji；extra>0 显示 +N 角标
    _showState(state, mood, family, pet, extra) {
        if (extra > 0) {
            this._badge.text = ` +${extra}`;
            this._badge.visible = true;
        } else {
            this._badge.visible = false;
        }
        const gicon = stateGicon(family, state, mood);
        if (gicon) {
            this._icon.gicon = gicon;
            this._icon.visible = true;
            this._emoji.visible = false;
        } else {
            this._emoji.text = `${pet || ''}${faceFor(state, mood)}`;
            this._emoji.visible = true;
            this._icon.visible = false;
        }
    }

    _startPulse() {
        if (this._pulseTimer)
            return;
        this._box.set_pivot_point(0.5, 0.5);
        this._pulseUp = false;
        const tick = () => {
            this._pulseUp = !this._pulseUp;
            const sc = this._pulseUp ? 1.14 : 1.0;
            this._box.ease({
                scale_x: sc, scale_y: sc,
                duration: 560,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            });
            return GLib.SOURCE_CONTINUE;
        };
        tick();
        this._pulseTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, tick);
    }

    _stopPulse() {
        if (this._pulseTimer) {
            GLib.source_remove(this._pulseTimer);
            this._pulseTimer = 0;
        }
        this._box.remove_all_transitions();
        this._box.set_scale(1.0, 1.0);
    }

    // —— 面板：会话区 ——
    _rebuildSessions() {
        this._sessionSection.removeAll();
        if (this._sessions.size === 0) {
            this._sessionSection.addMenuItem(
                new PopupMenu.PopupMenuItem('（暂无活跃会话）', { reactive: false }));
            return;
        }
        const arr = [...this._sessions.entries()].sort((a, b) => b[1].lastTs - a[1].lastTs);
        const now = this._now();
        for (const [, s] of arr) {
            const gicon = stateGicon(s.family, s.state, s.mood);
            const tail = `${STATE_LABEL[s.state]} · ${fmtDur(now - s.startTs)} · ${s.lastEvent}`;
            if (gicon) {
                const item = new PopupMenu.PopupMenuItem('', { reactive: false });
                const ic = new St.Icon({ gicon, style_class: 'notchi-row-icon' });
                ic.set_icon_size(18);
                item.insert_child_at_index(ic, 1); // 0=ornament，放到文字前
                item.label.text = `  ${tail}`;
                this._sessionSection.addMenuItem(item);
            } else {
                const face = faceFor(s.state, s.mood);
                this._sessionSection.addMenuItem(
                    new PopupMenu.PopupMenuItem(`${s.pet}${face}  ${tail}`, { reactive: false }));
            }
        }
    }

    // —— 面板：用量区 ——
    setUsage(payload) {
        this._usageSection.removeAll();
        if (!this._settings.get_boolean('enable-quota'))
            return;
        const accounts = (payload && payload.accounts) ? payload.accounts : [];
        if (accounts.length === 0) {
            this._usageSection.addMenuItem(
                new PopupMenu.PopupMenuItem('（暂无用量数据）', { reactive: false }));
            return;
        }
        let custom = {};
        try {
            custom = JSON.parse(this._settings.get_string('account-names')) || {};
        } catch (e) {
            custom = {};
        }
        for (const a of accounts) {
            const name = (custom[a.id] && custom[a.id].length) ? custom[a.id] : a.name;
            let stale = '';
            if (a.stale) {
                const ago = fmtAgo(a.updated_at);
                stale = ago ? `  (${ago})` : '  (旧)';
            }
            const r5 = fmtRemaining(a.five_hour_reset);
            const r7 = fmtRemaining(a.seven_day_reset);
            const acctItem = new PopupMenu.PopupMenuItem('', { reactive: false });
            const avatar = iconGicon(a.stale ? 'account-stale' : 'account');
            if (avatar) {
                const av = new St.Icon({ gicon: avatar, style_class: 'notchi-row-icon' });
                av.set_icon_size(18);
                acctItem.insert_child_at_index(av, 1); // 0=ornament，放到文字前
                acctItem.label.text = `  ${name}${stale}`;
            } else {
                acctItem.label.text = `👤 ${name}${stale}`;
            }
            this._usageSection.addMenuItem(acctItem);
            this._usageSection.addMenuItem(this._usageRow('5小时', a.five_hour_pct, r5));
            this._usageSection.addMenuItem(this._usageRow('7天', a.seven_day_pct, r7));
        }
    }

    // 单条用量行：标签 + 复古分段电量条 + 百分比 + 重置倒计时
    _usageRow(label, pct, resetText) {
        const item = new PopupMenu.PopupMenuItem('', { reactive: false });
        const box = new St.BoxLayout({ style_class: 'notchi-usage-row', x_expand: true });
        box.add_child(new St.Label({
            text: label, style_class: 'notchi-usage-label',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(this._segBar(pct));
        box.add_child(new St.Label({
            text: (pct === null || pct === undefined) ? '—' : `${pct}%`,
            style_class: 'notchi-usage-pct',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        // resetText 为空 = API 没返回重置时刻（窗口利用率 0，滚动窗口还没点亮）→ 占位
        let resetLabel;
        if (!resetText)
            resetLabel = '↻ 未开始';
        else if (resetText === '可重置')
            resetLabel = '↻ 可重置';
        else
            resetLabel = `↻ ${resetText}后`;
        box.add_child(new St.Label({
            text: resetLabel, style_class: 'notchi-usage-reset',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        item.add_child(box);
        return item;
    }

    // 复古分段电量条：10 格，已用占比染色（绿 <70 / 黄 70–90 / 红 ≥90）
    _segBar(pct) {
        const SEG = 10;
        const box = new St.BoxLayout({ style_class: 'notchi-bar', y_align: Clutter.ActorAlign.CENTER });
        const valid = !(pct === null || pct === undefined);
        const filled = valid ? Math.max(0, Math.min(SEG, Math.round(pct / (100 / SEG)))) : 0;
        const level = !valid ? ''
            : (pct >= 90 ? 'notchi-cell-high' : pct >= 70 ? 'notchi-cell-mid' : 'notchi-cell-low');
        for (let i = 0; i < SEG; i++) {
            const on = i < filled;
            box.add_child(new St.Widget({
                style_class: 'notchi-cell ' + (on ? `notchi-cell-on ${level}` : 'notchi-cell-off'),
            }));
        }
        return box;
    }

    // —— 音效 ——
    _maybePlaySound(state) {
        const mode = this._settings.get_string('sound-mode');
        if (mode === 'off')
            return;
        if (mode === 'mute-terminal' && this._focusIsTerminal())
            return;
        const id = SOUND_ID[state];
        if (!id)
            return;
        try {
            Gio.Subprocess.new(
                ['canberra-gtk-play', '-i', id],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            // canberra 没装 → 静默
        }
    }

    _focusIsTerminal() {
        try {
            const win = global.display.get_focus_window();
            if (!win)
                return false;
            const cls = (win.get_wm_class() || '').toLowerCase();
            const inst = (win.get_wm_class_instance && win.get_wm_class_instance() || '').toLowerCase();
            const terms = this._settings.get_strv('terminal-classes').map(x => x.toLowerCase());
            return terms.some(t => t && (cls === t || inst === t || cls.includes(t)));
        } catch (e) {
            return false;
        }
    }

    destroy() {
        this._stopPulse();
        for (const [, s] of this._sessions) {
            if (s.doneTimer) GLib.source_remove(s.doneTimer);
        }
        this._sessions.clear();
        super.destroy();
    }
});

// unix socket 服务：收一行 JSON → 回调
class NotchiServer {
    constructor(onEvent) {
        this._onEvent = onEvent;
        this._service = null;
        this._path = socketPath();
    }

    start() {
        const dir = GLib.path_get_dirname(this._path);
        GLib.mkdir_with_parents(dir, 0o700);
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch (e) {}

        this._service = new Gio.SocketService();
        const addr = new Gio.UnixSocketAddress({ path: this._path });
        this._service.add_address(addr, Gio.SocketType.STREAM, Gio.SocketProtocol.DEFAULT, null);
        this._service.connect('incoming', (service, connection) => {
            this._handle(connection);
            return false;
        });
        this._service.start();
        log(`[notchi] listening on ${this._path}`);
    }

    _handle(connection) {
        const input = new Gio.DataInputStream({ base_stream: connection.get_input_stream() });
        input.read_line_async(GLib.PRIORITY_DEFAULT, null, (stream, res) => {
            try {
                const [line] = stream.read_line_finish_utf8(res);
                if (line) {
                    let data;
                    try { data = JSON.parse(line); } catch (e) { data = null; }
                    if (data) this._onEvent(data);
                }
            } catch (e) {
                logError(e, '[notchi] read');
            }
            try { connection.close(null); } catch (e) {}
        });
    }

    stop() {
        if (this._service) {
            this._service.stop();
            this._service.close();
            this._service = null;
        }
        try {
            Gio.File.new_for_path(this._path).delete(null);
        } catch (e) {}
    }
}

let _indicator = null;
let _server = null;
let _settings = null;
let _usageTimer = 0;
let _usageCancel = null;
let _lastUsageTs = 0;

function init() {}

function fetchUsage() {
    if (!_indicator)
        return;
    if (!_settings.get_boolean('enable-quota')) {
        _indicator.setUsage({ accounts: [] });
        return;
    }
    // 隐藏的账号 id（这些不拉取）；其余自动发现的账号全显示
    const hidden = _settings.get_strv('hidden-accounts');

    const script = GLib.build_filenamev([Me.path, 'notchi-usage.py']);
    try {
        _usageCancel = new Gio.Cancellable();
        const proc = Gio.Subprocess.new(
            ['python3', script, ...hidden],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        proc.communicate_utf8_async(null, _usageCancel, (p, res) => {
            try {
                const [, stdout] = p.communicate_utf8_finish(res);
                const payload = JSON.parse(stdout);
                if (_indicator)
                    _indicator.setUsage(payload);
                _lastUsageTs = GLib.get_monotonic_time();
            } catch (e) {
                // 拉取失败：保持上次显示
            }
        });
    } catch (e) {
        logError(e, '[notchi] usage spawn');
    }
}

function startUsagePolling() {
    fetchUsage();
    const mins = _settings.get_int('quota-poll-minutes');
    _usageTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, mins * 60, () => {
        fetchUsage();
        return GLib.SOURCE_CONTINUE;
    });
}

function enable() {
    _settings = ExtensionUtils.getSettings();

    _indicator = new NotchiIndicator(_settings);
    Main.panel.addToStatusArea('notchi', _indicator);

    // 面板「立即刷新」「打开节流刷新」
    _indicator.connect('request-usage', () => fetchUsage());
    _indicator.connect('menu-opened', () => {
        const now = GLib.get_monotonic_time();
        if (now - _lastUsageTs > 60 * 1000 * 1000)
            fetchUsage();
    });

    _server = new NotchiServer((data) => {
        if (_indicator)
            _indicator.handleEvent(data);
    });
    try {
        _server.start();
    } catch (e) {
        logError(e, '[notchi] server start failed');
    }

    // 刷新间隔改了 → 重启轮询
    _settings.connect('changed::quota-poll-minutes', () => {
        if (_usageTimer) { GLib.source_remove(_usageTimer); _usageTimer = 0; }
        startUsagePolling();
    });

    // 顶栏角色改了 → 重算各会话家族并重绘
    _settings.connect('changed::mascot-family', () => {
        if (_indicator)
            _indicator.applyMascotSetting();
    });

    // 账号显示/命名改了 → 立即重拉/重绘用量
    _settings.connect('changed::hidden-accounts', () => fetchUsage());
    _settings.connect('changed::account-names', () => fetchUsage());
    _settings.connect('changed::enable-quota', () => fetchUsage());

    startUsagePolling();
}

function disable() {
    if (_usageTimer) { GLib.source_remove(_usageTimer); _usageTimer = 0; }
    if (_usageCancel) { try { _usageCancel.cancel(); } catch (e) {} _usageCancel = null; }
    if (_server) { _server.stop(); _server = null; }
    if (_indicator) { _indicator.destroy(); _indicator = null; }
    _settings = null;
    _lastUsageTs = 0;
}
