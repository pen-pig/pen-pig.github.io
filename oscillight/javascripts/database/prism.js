const DATABASE_PRISM = {
    baseRequirement: new Decimal(1e60),
    requirement(g) {
        if (g.interference.current !== 0) {
            return DATABASE_CHALLENGE.getRequirement(g.interference.current)
        } else {
            return this.baseRequirement
        }
    },
    canReset(g) {
        let requirement = this.requirement(g)
        return g.light.gte(requirement)
    },
    gain(g) {
        if (!this.canReset(g)) return new Decimal(0);

        let base = Decimal.max(1, Decimal.pow(10, Decimal.log(g.light.add(1), 1e60) - 1));

        return base.times(DATABASE_CHALLENGE.applyUpg(g, 6))
    },
    toggleAutoMode(g) {
        g.activate.mode = (g.activate.mode + 1) % this.getAutoModes().length;
    },
    getAutoModes() {
        return ["彩虹", "光", "时间"];
    },
    getAutoDescriptions() {
        return [
            "当彩虹达到 X 时启动棱镜:",
            "当光达到 X 时启动棱镜:",
            "当持续时间达到 X 秒后启动棱镜:"
        ]
    },
    hasMetAutoRequirement(g) {
        let mode = g.activate.mode;
        if (!g.activate.auto || !isNumberString(g.activate.value[mode])) return false;
        let val = new Decimal(g.activate.value[mode]);
        switch (mode) {
            case 0: return DATABASE_PRISM.gain(g).gte(val);
            case 1: return g.light.gte(val);
            case 2: return val.lt(g.stats.currentTime.prism); // Time >= val
            default: return false;
        }
    },
    reset(g, forced = false) {

        // normally, resetting is not allowed when the player cannot gain anything,
        // however, when entering / exiting a challenge, the forced mode is used

        // force mode bypasses the check for "has gain"

        if (!this.canReset(g) && !forced) return false

        DATABASE_WAVE.upgrades.filter(upg => (this.hasUpg(g, 9)) ? upg.id !== 6 : true)
                              .forEach(upg => g.upgrades[upg.id] = 0);

        if (!this.hasUpg(g, 9)) {
            g.decelerate.auto = false
            g.decelerate.isActive = false
        }

        if (!this.hasUpg(g, 12)) {
            g.unlocks.laser = false
            g.lenses = 0
            g.unlocks.lenses = false
        }

        if (!this.hasUpg(g, 12) || forced) {
            g.laser.time = 0
            g.laser.isActive = false
        }

        //When entering / exiting a challenge, the player does not gain activations

        if (!forced) g.stats.resets.prism ++

        g.rainbow = g.rainbow.add(Decimal.floor(this.gain(g)))
        g.light = new Decimal(0)
        g.unlocks.rainbowUpgrades = true
        g.stats.currentTime.prism = 0

        // Not entering / exiting a challenge, and is inside a challenge

        if (!forced && g.interference.current !== 0) {
            g.laser.time = 0
            g.laser.isActive = false

            g.interference.completed |= Math.pow(2, g.interference.current - 1)
            g.interference.current = 0
        }

        if (g.interference.respec) {
            g.interference.respec = false
            g.interference.upgrades = 0
        }

        if (g.laser.time === 0) { // The laser is deactivated
            g.achievementConditions["11"] = true
        }
    },
    hasUpg(g, i) {
        return (g.rainbowUpgrades & Math.pow(2, i - 1)) !== 0
    },
    applyUpg(g, i) {
        return this.hasUpg(g, i) ? this.upgrades[i - 1].current(g) : 1
    },
    upgrades: [
        {
            id: 1,
            name: "衰变",
            desc: "光倍率，随你的光量衰减",
            current: (g) => Decimal.max(1, 20 - Decimal.log10(g.light.add(1)) / 3),
            cost: new Decimal(1)
        },
        {
            id: 2,
            name: "静场",
            desc: "固定的光倍率",
            current: () => new Decimal(10),
            cost: new Decimal(1)
        },
        {
            id: 3,
            name: "增长",
            desc: "光倍率，随你的光量增长",
            current: (g) => Decimal.min(20, Decimal.log10(g.light.add(1)) / 3 + 1),
            cost: new Decimal(1)
        },
        {
            id: 4,
            name: "浅层增幅",
            desc: "光获取倍率，随棱镜启动次数提升",
            current: (g) => Math.pow(g.stats.resets.prism > 10000 ? 10000 + (g.stats.resets.prism - 10000) / 5 : g.stats.resets.prism, 1.5) + 1,
            cost: new Decimal(2)
        },
        {
            id: 5,
            name: "深层增幅",
            desc: "基础光倍率，随棱镜启动次数提升",
            current: (g) => Math.pow(g.stats.resets.prism, 0.3) + 1,
            cost: new Decimal(2)
        },
        {
            id: 6,
            name: "快速充能",
            desc: "激光充能与稳定速度 +80%",
            cost: new Decimal(3)
        },
        {
            id: 7,
            name: "逆棱镜",
            desc: "未消耗的彩虹提升光获取",
            current: (g) => Decimal.pow(Decimal.log10(g.rainbow.times(5).plus(1)) + 1, 4),
            cost: new Decimal(35)
        },
        {
            id: 8,
            name: "共振",
            desc: "解锁振荡升级自动购买",
            cost: new Decimal(25)
        },
        {
            id: 9,
            name: "备用减速器",
            desc: "启动棱镜时保留光子减速自动化",
            cost: new Decimal(15)
        },
        {
            id: 10,
            name: "彩色透镜",
            desc: "未消耗的彩虹强化激光",
            current: (g) => Decimal.log10(g.rainbow.plus(1)) / 30 + 1,
            cost: new Decimal(200)
        },
        {
            id: 11,
            name: "启明",
            desc: "可以自动启动棱镜",
            cost: new Decimal(2000)
        },
        {
            id: 12,
            name: "备用激光",
            desc: "启动棱镜后保留激光",
            cost: new Decimal(300)
        }
    ]
}
