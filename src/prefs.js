// Notchi 设置界面 — GTK4 / libadwaita (GNOME 42)

const { Adw, Gio, GLib, Gtk } = imports.gi;
const ByteArray = imports.byteArray;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

function init() {}

// 开关行：bool key 绑到 Gtk.Switch
function makeSwitchRow(settings, key, title, subtitle) {
    const row = new Adw.ActionRow({ title, subtitle });
    const sw = new Gtk.Switch({
        active: settings.get_boolean(key),
        valign: Gtk.Align.CENTER,
    });
    settings.bind(key, sw, 'active', Gio.SettingsBindFlags.DEFAULT);
    row.add_suffix(sw);
    row.activatable_widget = sw;
    return row;
}

// 数字行：int key 绑到 SpinButton
function makeSpinRow(settings, key, title, subtitle, lower, upper) {
    const row = new Adw.ActionRow({ title, subtitle });
    const spin = new Gtk.SpinButton({
        adjustment: new Gtk.Adjustment({
            lower, upper, step_increment: 1, page_increment: 5,
        }),
        valign: Gtk.Align.CENTER,
    });
    spin.set_value(settings.get_int(key));
    spin.connect('value-changed',
        () => settings.set_int(key, spin.get_value_as_int()));
    row.add_suffix(spin);
    row.activatable_widget = spin;
    return row;
}

// 下拉行：enum key（字符串 nick）绑到 Adw.ComboRow
function makeEnumRow(settings, key, title, subtitle, nicks, labels) {
    const model = new Gtk.StringList();
    labels.forEach(l => model.append(l));
    const row = new Adw.ComboRow({ title, subtitle, model });
    const cur = settings.get_string(key);
    row.set_selected(Math.max(0, nicks.indexOf(cur)));
    row.connect('notify::selected', () => {
        const sel = row.get_selected();
        if (sel >= 0 && sel < nicks.length)
            settings.set_string(key, nicks[sel]);
    });
    return row;
}

// 跑 notchi-usage.py --list 自动发现账号（不调 API，快）
function discoverAccounts() {
    try {
        const script = GLib.build_filenamev([Me.path, 'notchi-usage.py']);
        const [ok, out] = GLib.spawn_sync(null,
            ['python3', script, '--list'], null,
            GLib.SpawnFlags.SEARCH_PATH, null);
        if (!ok || !out)
            return [];
        const data = JSON.parse(ByteArray.toString(out));
        return data.accounts || [];
    } catch (e) {
        return [];
    }
}

function getNames(settings) {
    try { return JSON.parse(settings.get_string('account-names')) || {}; }
    catch (e) { return {}; }
}

// 单个账号行：显示开关 + 自定义名字输入
function makeAccountRow(settings, acct) {
    const row = new Adw.ActionRow({ title: acct.name, subtitle: acct.id });

    // 自定义名字（留空 = 用默认 displayName）
    const entry = new Gtk.Entry({
        valign: Gtk.Align.CENTER,
        placeholder_text: acct.name,
        width_chars: 10,
    });
    const names = getNames(settings);
    if (names[acct.id])
        entry.set_text(names[acct.id]);
    entry.connect('changed', () => {
        const n = getNames(settings);
        const v = entry.get_text().trim();
        if (v) n[acct.id] = v;
        else delete n[acct.id];
        settings.set_string('account-names', JSON.stringify(n));
    });
    row.add_suffix(entry);

    // 显示开关（开=显示，关=加入 hidden-accounts）
    const sw = new Gtk.Switch({
        active: !settings.get_strv('hidden-accounts').includes(acct.id),
        valign: Gtk.Align.CENTER,
    });
    sw.connect('notify::active', () => {
        let h = settings.get_strv('hidden-accounts').filter(x => x !== acct.id);
        if (!sw.active)
            h.push(acct.id);
        settings.set_strv('hidden-accounts', h);
    });
    row.add_suffix(sw);

    return row;
}

function fillPreferencesWindow(window) {
    const settings = ExtensionUtils.getSettings();
    const page = new Adw.PreferencesPage();
    window.add(page);

    // —— 音效 ——
    const sound = new Adw.PreferencesGroup({
        title: '音效',
        description: '完成 🎉 / 求关注 ❓ / 出错 😵 时播放系统提示音（需要 canberra-gtk-play）',
    });
    page.add(sound);
    sound.add(makeEnumRow(settings, 'sound-mode',
        '音效模式', '终端聚焦时静音 = 你正盯着终端看就不吵你',
        ['off', 'always', 'mute-terminal'],
        ['关闭', '总是播放', '终端聚焦时静音']));

    // —— 行为 ——
    const behav = new Adw.PreferencesGroup({ title: '行为' });
    page.add(behav);
    behav.add(makeSwitchRow(settings, 'enable-sentiment',
        '情绪分析', '按 prompt 关键词让宠物喜怒哀乐（本地判断，不外发）'));

    // —— 用量配额（自动发现账号）——
    const quota = new Adw.PreferencesGroup({
        title: '用量配额',
        description: '自动发现的 Claude 账号；勾选要显示的，右侧可改显示名（留空用默认）',
    });
    page.add(quota);
    quota.add(makeSwitchRow(settings, 'enable-quota',
        '显示用量配额', '总开关：关闭则面板不显示用量区'));

    const accounts = discoverAccounts();
    if (accounts.length === 0) {
        quota.add(new Adw.ActionRow({
            title: '未发现账号',
            subtitle: '让 Claude Code 登录一次（生成 .credentials.json）后重开本窗口',
        }));
    } else {
        for (const a of accounts)
            quota.add(makeAccountRow(settings, a));
    }

    // —— 高级 ——
    const adv = new Adw.PreferencesGroup({ title: '高级' });
    page.add(adv);
    adv.add(makeSpinRow(settings, 'quota-poll-minutes',
        '用量刷新间隔（分钟）', '后台多久拉一次用量', 1, 60));
}
