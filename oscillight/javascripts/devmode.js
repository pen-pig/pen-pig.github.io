"use strict";

// ==================================================================
// 开发者模式 (Developer mode)
//  - 密码以 SHA-256 哈希形式存放，源码中不出现明文密码
//  - 解锁后导航栏出现“开发者”标签页：可修改游戏内任意数值、1~10 倍速、
//    激光倍率与激光效果强化
//  - 解锁状态与倍速保存在独立的 localStorage 键，不污染游戏存档
//
//  修改密码的方法:
//    1. 打开游戏，按 F12 在控制台运行:  sha256(DEV_HASH_SALT + "你的新密码")
//    2. 把输出的哈希串替换掉下面的 DEV_PASSWORD_SHA256 即可
// ==================================================================

// SHA-256 纯 JS 实现（无外部依赖，任意页面环境均可用）
function sha256(str) {
    // UTF-8 编码
    const utf8 = unescape(encodeURIComponent(String(str)));
    const bytes = [];
    for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i) & 0xff);

    // 填充
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const hi = Math.floor(bitLen / 4294967296);
    const lo = bitLen >>> 0;
    bytes.push(
        (hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255,
        (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255
    );

    // 常量
    const K = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

    const rotr = (x, n) => (x >>> n) | (x << (32 - n));

    let h = H0.slice();
    for (let off = 0; off < bytes.length; off += 64) {
        const w = new Array(64);
        for (let i = 0; i < 16; i++) {
            w[i] = ((bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16)
                  | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3]) | 0;
        }
        for (let i = 16; i < 64; i++) {
            const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
            const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
            w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }

        let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
        for (let i = 0; i < 64; i++) {
            const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const ch = (e & f) ^ (~e & g);
            const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
            const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const t2 = (S0 + maj) | 0;
            hh = g; g = f; f = e; e = (d + t1) | 0;
            d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        h = [
            (h[0] + a) | 0, (h[1] + b) | 0, (h[2] + c) | 0, (h[3] + d) | 0,
            (h[4] + e) | 0, (h[5] + f) | 0, (h[6] + g) | 0, (h[7] + hh) | 0
        ];
    }
    return h.map(x => ("00000000" + ((x >>> 0).toString(16))).slice(-8)).join("");
}

// ---- 密码校验 ----
const DEV_HASH_SALT = "oscillight::dev::v1::";
// sha256(DEV_HASH_SALT + 密码) 的结果
const DEV_PASSWORD_SHA256 = "82433c0eff7a818815e8a1c09117789696ace7fc9b96efb2b6f7b93d71f9ea2d";

// ---- 状态（独立于游戏存档） ----
const DEV_STORAGE_KEY = "Buck4437_Oscillight_DevMode";
const DEVMODE = {
    unlocked: false,
    speed: 1,
    // 模块倍速（与总倍速相乘）：
    //  oscillation 振荡（波相位+光产量）、laser 增幅（激光）、
    //  prism 色散（棱镜计时）、meta 干涉（总计时）
    speedMul: {
        oscillation: 1,
        laser: 1,
        prism: 1,
        meta: 1
    },
    // 激光倍率：激光时间流速的额外倍数（1~10，与总倍速、增幅模块倍速相乘）
    laserRate: 1,
    // 激光效果：激光对光产量加成的强度倍数（1~10）
    laserEffect: 1
};

function devPersist() {
    try {
        localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify({
            unlocked: DEVMODE.unlocked,
            speed: DEVMODE.speed,
            speedMul: DEVMODE.speedMul,
            laserRate: DEVMODE.laserRate,
            laserEffect: DEVMODE.laserEffect
        }));
    } catch (e) { /* 存储不可用时忽略 */ }
}

(function devInitState() {
    try {
        const raw = localStorage.getItem(DEV_STORAGE_KEY);
        if (raw !== null) {
            const d = JSON.parse(raw);
            DEVMODE.unlocked = d.unlocked === true;
            const s = Number(d.speed);
            if (isFinite(s)) DEVMODE.speed = Math.min(10, Math.max(1, s));
            if (d.speedMul && typeof d.speedMul === "object") {
                for (const k in DEVMODE.speedMul) {
                    const m = Number(d.speedMul[k]);
                    if (isFinite(m)) DEVMODE.speedMul[k] = Math.min(10, Math.max(1, m));
                }
            }
            const lr = Number(d.laserRate);
            if (isFinite(lr)) DEVMODE.laserRate = Math.min(10, Math.max(1, lr));
            const le = Number(d.laserEffect);
            if (isFinite(le)) DEVMODE.laserEffect = Math.min(10, Math.max(1, le));
        }
    } catch (e) {
        DEVMODE.unlocked = false;
        DEVMODE.speed = 1;
        DEVMODE.speedMul = { oscillation: 1, laser: 1, prism: 1, meta: 1 };
        DEVMODE.laserRate = 1;
        DEVMODE.laserEffect = 1;
    }
})();

function devTryUnlock(password) {
    if (typeof password !== "string" || password === "") return false;
    if (sha256(DEV_HASH_SALT + password) === DEV_PASSWORD_SHA256) {
        DEVMODE.unlocked = true;
        devPersist();
        return true;
    }
    return false;
}

function devLock() {
    DEVMODE.unlocked = false;
    DEVMODE.speed = 1;
    DEVMODE.speedMul = { oscillation: 1, laser: 1, prism: 1, meta: 1 };
    DEVMODE.laserRate = 1;
    DEVMODE.laserEffect = 1;
    devPersist();
}

// 倍速：仅在解锁后生效，范围 1~10
function getGameSpeed() {
    if (!DEVMODE.unlocked) return 1;
    const s = Number(DEVMODE.speed);
    if (!isFinite(s) || s < 1) return 1;
    return Math.min(10, s);
}

// 模块倍速：实际倍速 = 总倍速 × 模块倍速（最大 100 倍）
function getModuleSpeed(name) {
    if (!DEVMODE.unlocked) return 1;
    let m = Number(DEVMODE.speedMul[name]);
    if (!isFinite(m) || m < 1) m = 1;
    return getGameSpeed() * Math.min(10, m);
}

// 激光倍率：激光时间累积速度的额外倍数（1~10），与总倍速、增幅模块倍速相乘
function getLaserRate() {
    if (!DEVMODE.unlocked) return 1;
    const r = Number(DEVMODE.laserRate);
    if (!isFinite(r) || r < 1) return 1;
    return Math.min(10, r);
}

// 激光效果：激光对光产量加成（effect 中激光贡献部分）的强度倍数（1~10）
function getLaserEffectMul() {
    if (!DEVMODE.unlocked) return 1;
    const e = Number(DEVMODE.laserEffect);
    if (!isFinite(e) || e < 1) return 1;
    return Math.min(10, e);
}

// ---- 数值编辑辅助 ----
// 顶层跳过的技术性字段（lastTick 改动会干扰离线结算，saveVersion 改动会破坏存档迁移）
const DEV_SKIP_KEYS = ["lastTick", "saveVersion"];

const DEV_GROUP_TITLES = {
    light: "基础",
    rainbow: "彩虹",
    period: "相位",
    lenses: "透镜",
    upgrades: "振荡升级",
    decelerate: "光子减速",
    laser: "激光",
    rainbowUpgrades: "彩虹升级",
    autobuyUpgrades: "自动化",
    activate: "计时器",
    interference: "干涉",
    unlocks: "解锁",
    achievements: "成就",
    achievementConditions: "成就条件",
    buffs: "通关加成",
    hasWon: "通关状态",
    stats: "统计",
    settings: "设置"
};

const DEV_GROUP_ORDER = [
    "light", "rainbow", "period", "lenses", "upgrades", "decelerate", "laser",
    "rainbowUpgrades", "activate", "interference", "unlocks", "achievements",
    "achievementConditions", "buffs", "hasWon", "stats", "autobuyUpgrades", "settings"
];

const DEV_LABELS = {
    "light": "光",
    "rainbow": "彩虹",
    "period": "相位 (0-360)",
    "lenses": "透镜数",
    "buffs": "通关加成层数",
    "achievements": "成就 (位掩码)",
    "hasWon": "已通关",
    "autobuyUpgrades": "自动买满",
    "upgrades": "升级等级",
    "decelerate.isActive": "减速: 开启",
    "decelerate.auto": "减速: 自动",
    "decelerate.value": "减速: 目标值",
    "laser.isActive": "激光: 开启",
    "laser.time": "激光: 时间",
    "rainbowUpgrades": "彩虹升级 (位掩码)",
    "activate.auto": "计时器: 自动激活",
    "activate.mode": "计时器: 模式 (0彩虹/1时间/2光)",
    "activate.value": "计时器: 阈值",
    "interference.respec": "干涉: 免费重配",
    "interference.current": "干涉: 当前 (位掩码)",
    "interference.completed": "干涉: 已完成 (位掩码)",
    "interference.upgrades": "干涉: 升级 (位掩码)",
    "unlocks.upgrades": "解锁: 振荡升级",
    "unlocks.decelerate": "解锁: 减速",
    "unlocks.amplification": "解锁: 增幅",
    "unlocks.laser": "解锁: 激光",
    "unlocks.lenses": "解锁: 透镜",
    "unlocks.prism": "解锁: 棱镜",
    "unlocks.rainbowUpgrades": "解锁: 彩虹升级",
    "unlocks.interference": "解锁: 干涉",
    "achievementConditions.11": "成就条件 #11",
    "stats.currentTime.prism": "棱镜内计时",
    "stats.currentTime.meta": "总计时",
    "stats.resets.prism": "棱镜重置次数",
    "stats.resets.meta": "通关重置次数",
    "settings.moveAchievement": "设置: 移动成就弹窗",
    "settings.effect.interference": "设置: 干涉特效",
    "settings.theme": "设置: 主题 (0亮/1暗)"
};

function devLabelFor(path) {
    if (DEV_LABELS[path] !== undefined) return DEV_LABELS[path];
    let best = null;
    for (const k in DEV_LABELS) {
        if (path.indexOf(k + ".") === 0) {
            if (best === null || k.length > best.length) best = k;
        }
    }
    if (best !== null) return DEV_LABELS[best] + " " + path.slice(best.length + 1);
    return path;
}

function devCollectFields(obj, prefix, out) {
    for (const key in obj) {
        if (!obj.hasOwnProperty(key)) continue;
        if (prefix === "" && DEV_SKIP_KEYS.indexOf(key) !== -1) continue;
        const path = prefix === "" ? key : prefix + "." + key;
        const v = obj[key];
        if (v instanceof Decimal) out.push({ path: path, type: "decimal" });
        else if (typeof v === "number") out.push({ path: path, type: "number" });
        else if (typeof v === "boolean") out.push({ path: path, type: "boolean" });
        else if (typeof v === "string") out.push({ path: path, type: "string" });
        else if (v !== null && typeof v === "object") devCollectFields(v, path, out);
    }
}

// ---- 开发者标签页 ----
Vue.component("dev-tab", {
    data() {
        return {
            dev: DEVMODE,
            speeds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            moduleSpeeds: [
                { key: "oscillation", label: "振荡（波速与光产量）" },
                { key: "laser", label: "增幅（激光）" },
                { key: "prism", label: "色散（棱镜计时）" },
                { key: "meta", label: "干涉（总计时）" }
            ],
            editing: null
        }
    },
    props: {
        game: Object
    },
    computed: {
        groups() {
            const fields = [];
            devCollectFields(this.game, "", fields);
            const groups = [];
            const map = {};
            for (const f of fields) {
                const g = f.path.split(".")[0];
                if (map[g] === undefined) {
                    map[g] = { key: g, title: DEV_GROUP_TITLES[g] || g, fields: [] };
                    groups.push(map[g]);
                }
                f.label = devLabelFor(f.path);
                map[g].fields.push(f);
            }
            groups.sort((a, b) => {
                const ia = DEV_GROUP_ORDER.indexOf(a.key);
                const ib = DEV_GROUP_ORDER.indexOf(b.key);
                return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
            });
            return groups;
        }
    },
    methods: {
        getPath(path) {
            let o = this.game;
            for (const k of path.split(".")) o = o[k];
            return o;
        },
        setPath(path, v) {
            const keys = path.split(".");
            let o = this.game;
            for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
            o[keys[keys.length - 1]] = v;
        },
        display(f) {
            const v = this.getPath(f.path);
            if (typeof v === "boolean") return v ? "开" : "关";
            if (v instanceof Decimal) return v.toString();
            return String(v);
        },
        editField(f) {
            if (f.type === "boolean") {
                this.setPath(f.path, !this.getPath(f.path));
                toastr.success("", "已切换: " + f.label);
                return;
            }
            this.editing = {
                label: f.label,
                path: f.path,
                type: f.type,
                current: String(this.getPath(f.path))
            };
        },
        applyEdit(newVal) {
            const e = this.editing;
            this.editing = null;
            if (e === null) return;
            try {
                if (typeof newVal !== "string" || newVal.trim() === "") throw new Error("empty");
                let v;
                if (e.type === "decimal") {
                    v = new Decimal(newVal.trim());
                } else if (e.type === "number") {
                    v = Number(newVal);
                    if (!isFinite(v)) throw new Error("not a number");
                    if (Number.isInteger(this.getPath(e.path))) v = Math.round(v);
                } else {
                    v = String(newVal);
                }
                this.setPath(e.path, v);
                toastr.success("", "已修改: " + e.label);
            } catch (err) {
                toastr.error("", "无效的值");
            }
        },
        setSpeed(s) {
            DEVMODE.speed = s;
            devPersist();
            toastr.success("", "游戏倍速: " + s + "x");
        },
        setModuleSpeed(key, s) {
            DEVMODE.speedMul[key] = s;
            devPersist();
        },
        setLaserRate(n) {
            DEVMODE.laserRate = n;
            devPersist();
            toastr.success("", "激光倍率: " + n + "x");
        },
        setLaserEffect(n) {
            DEVMODE.laserEffect = n;
            devPersist();
            toastr.success("", "激光效果: " + n + "x");
        },
        laserRateEffective() {
            return getModuleSpeed("laser") * getLaserRate();
        },
        moduleEffective(m) {
            return getModuleSpeed(m.key);
        },
        lock() {
            devLock();
            this.$root.currentTab = "设置";
            toastr.info("", "开发者模式已锁定");
        }
    },
    template: `
    <div class="tab dev-tab">
        <template v-if="!dev.unlocked">
            <div class="dev-locked">
                开发者模式未解锁。<br>
                请前往“设置”标签页输入密码。
            </div>
        </template>
        <template v-else>
            <div class="dev-warning">
                修改数值可能破坏游戏平衡，建议先在“设置”里导出存档备份。改动会随存档保存。
            </div>

            <div class="dev-section">
                <div class="dev-title">倍速模式</div>
                <div class="dev-speed">
                    <button v-for="s in speeds"
                            :key="s"
                            :class="dev.speed === s ? 'is-active' : ''"
                            @click="setSpeed(s)">
                        {{s}}x
                    </button>
                </div>
                <div class="dev-note">
                    加速游戏内所有时间流速（光产量、相位、激光、计时与挂机结算）。
                </div>
            </div>

            <div class="dev-section">
                <div class="dev-title">模块倍速</div>
                <div class="dev-mod-row" v-for="m in moduleSpeeds" :key="m.key">
                    <span class="dev-mod-label">{{m.label}}</span>
                    <span class="dev-mod-btns">
                        <button v-for="s in speeds"
                                :key="s"
                                :class="dev.speedMul[m.key] === s ? 'is-active' : ''"
                                @click="setModuleSpeed(m.key, s)">
                            {{s}}x
                        </button>
                    </span>
                    <span class="dev-mod-eff">实际 {{moduleEffective(m)}}x</span>
                </div>
                <div class="dev-note">
                    各模块实际倍速 = 总倍速 × 模块倍速（最大 10 × 10 = 100 倍）。
                </div>
            </div>

            <div class="dev-section">
                <div class="dev-title">激光强化</div>
                <div class="dev-mod-row">
                    <span class="dev-mod-label">激光倍率（时间流速）</span>
                    <span class="dev-mod-btns">
                        <button v-for="s in speeds"
                                :key="s"
                                :class="dev.laserRate === s ? 'is-active' : ''"
                                @click="setLaserRate(s)">
                            {{s}}x
                        </button>
                    </span>
                    <span class="dev-mod-eff">实际 {{laserRateEffective()}}x</span>
                </div>
                <div class="dev-mod-row">
                    <span class="dev-mod-label">激光效果（加成强度）</span>
                    <span class="dev-mod-btns">
                        <button v-for="s in speeds"
                                :key="s"
                                :class="dev.laserEffect === s ? 'is-active' : ''"
                                @click="setLaserEffect(s)">
                            {{s}}x
                        </button>
                    </span>
                </div>
                <div class="dev-note">
                    激光倍率：激光时间流速 ×N，与总倍速 × 增幅模块倍速相乘（最大 10 × 10 × 10 = 1000 倍）；激光关闭时无效。
                    激光效果：激光对光产量的加成 ×N（“增幅”页显示的效果值同步放大）；激光未启动/能量为 0 时无效。
                </div>
            </div>

            <div class="dev-section">
                <div class="dev-title">数值修改</div>
                <div class="dev-note">布尔值点击直接切换；其余点击后按提示输入新值。</div>
                <div class="dev-group" v-for="group in groups" :key="group.key">
                    <div class="dev-group-title">{{group.title}}</div>
                    <div class="dev-row" v-for="f in group.fields" :key="f.path">
                        <span class="dev-label">
                            {{f.label}} <span class="dev-path">({{f.path}})</span>
                        </span>
                        <button class="dev-value" @click="editField(f)">
                            {{display(f)}}
                        </button>
                    </div>
                </div>
            </div>

            <div class="dev-actions">
                <button class="warning" @click="lock">
                    锁定开发者模式
                </button>
            </div>

            <prompt-modal v-if="editing" @submit="applyEdit" @close="editing = null">
                <template #header>
                    修改: {{editing.label}}
                </template>

                当前值: {{editing.current}}<br>
                请输入新值:
            </prompt-modal>
        </template>
    </div>
    `
})
