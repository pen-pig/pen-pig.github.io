const DATABASE_WAVE = {
    light: {
        energy: (g) => Math.round(Math.max(0, Math.sin(Math.radian(g.period)) + 1) * 1000) / 1000,
        rate(g) {

            let base = new Decimal(this.energy(g))

            base = base.add(g.upgrades[1])
                       .add(DATABASE_CHALLENGE.applyUpg(g, 13, 0))

            if (DATABASE_CHALLENGE.hasUpg(g, 15)) {
                base = base.times(1e10)
            } else {

                if (!DATABASE_CHALLENGE.isInChallenge(g, 4)) {
                    base = base.times(Decimal.pow(2, g.upgrades[2]))
                               .times(DATABASE_WAVE.upgrades[7].apply(g)) //8th upgrade
                               .times(Decimal.pow(1.5, g.upgrades[9]))
                }

                base = base.times(DATABASE_PRISM.applyUpg(g, 5))
            }

            let rate = base.pow(DATABASE_LASER.laser.effect(g))
                           .pow(Decimal.pow(1.03, g.upgrades[5]))

                           .times(Decimal.pow(
                               (DATABASE_CHALLENGE.hasUpg(g, 11) ? 2.75 : 2),
                               g.upgrades[10]
                           ))
                           .times(DATABASE_PRISM.applyUpg(g, 1))
                           .times(DATABASE_PRISM.applyUpg(g, 2))
                           .times(DATABASE_PRISM.applyUpg(g, 3))
                           .times(DATABASE_PRISM.applyUpg(g, 4))
                           .times(DATABASE_PRISM.applyUpg(g, 7))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 1))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 3))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 5))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 7))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 9))
                           .times(DATABASE_CHALLENGE.applyUpg(g, 10))
                           .times(Math.pow(2, g.buffs))

            rate = rate.pow(DATABASE_CHALLENGE.isInChallenge(g, 3) ? 0.75 : 1)

            return rate
        },
        speed: g => {
            let base = 20
            if (g.decelerate.isActive) base = 5 / Math.pow(1.3, g.upgrades[4])

            return base * Math.pow(2, g.upgrades[3])
        }
    },
    upgrades: [
        {
            id: 1,
            tier: 1,
            name: "蓄光器",
            desc: "基础光获取 +1",
            base: new Decimal(18),
            scale: new Decimal(7),
            cap: 50
        },
        {
            id: 2,
            tier: 1,
            name: "激发器",
            desc: "基础光获取 ×2",
            base: new Decimal(18),
            scale: new Decimal(6),
            cap: 50
        },
        {
            id: 3,
            tier: 2,
            name: "振频器",
            desc: "波动频率 ×2",
            base: new Decimal(100),
            scale: new Decimal(10),
            cap: 4
        },
        {
            id: 4,
            tier: 2,
            name: "冷却器",
            desc: "光子减速效果 +30%",
            base: new Decimal(100),
            scale: new Decimal(15),
            cap: 7
        },
        {
            id: 5,
            tier: 3,
            name: "加速器",
            desc: "光获取量 ^1.03",
            base: new Decimal(1e10),
            scale: new Decimal(1e5),
            cap: 5
        },
        {
            id: 6,
            tier: 3,
            name: "减速装置",
            desc: "解锁光子减速自动化",
            base: new Decimal(1e13),
            scale: new Decimal(1e99),
            cap: 1
        },
        {
            id: 7,
            tier: 3,
            name: "充能器",
            desc: "激光效果 +10%",
            base: new Decimal(5e15),
            scale: new Decimal(1e99),
            cap: 1
        },
        {
            id: 8,
            tier: 3,
            name: "放大器",
            desc: "按当前能量等级提供额外基础光倍率",
            base: new Decimal(1e40),
            scale: new Decimal(1e99),
            current: (g) => DATABASE_WAVE.light.energy(g) * 5 + 1,
            apply: (g) => g.upgrades[8] > 0 ? DATABASE_WAVE.upgrades[7].current(g) : 1,
            cap: 1
        },
        {
            id: 9,
            tier: 3,
            name: "倍增器",
            desc: "基础光获取 ×1.5",
            base: new Decimal(1e50),
            scale: new Decimal(11),
            cap: 100
        },
        {
            id: 10,
            tier: 3,
            name: "复制器",
            desc: "光获取量 ×2",
            base: new Decimal(1e50),
            scale: new Decimal(5),
            cap: 1111
        }
    ],
}
