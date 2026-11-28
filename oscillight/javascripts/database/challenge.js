const DATABASE_CHALLENGE = {
    challenges: [
        {
            id: 1,
            acronym: "R",
            color: "red",
            name: "红色干涉",
            desc: "透镜效果 -75%"
        },
        {
            id: 2,
            acronym: "B",
            color: "blue",
            name: "蓝色干涉",
            desc: "激光效果 -50%"
        },
        {
            id: 3,
            acronym: "G",
            color: "green",
            name: "绿色干涉",
            desc: "总光获取量变为原来的 0.75 次幂"
        },
        {
            id: 4,
            acronym: "Y",
            color: "gold", //yellow is too bright
            name: "黄色干涉",
            desc: "振荡升级的所有基础光倍率全部失效"
        }
    ],
    enterChallenge(g, id = 0) {
        DATABASE_PRISM.reset(g, true)
        g.interference.current = id
    },
    exitChallenge(g) {
        this.enterChallenge(g)
    },
    requirements: [
        {
            id: 1,
            requirement: new Decimal("1e120")
        },
        {
            id: 2,
            requirement: new Decimal("1e55")
        },
        {
            id: 3,
            requirement: new Decimal("1e100")
        },
        {
            id: 4,
            requirement: new Decimal("1e125")
        },
        {
            id: 5,
            requirement: new Decimal("1e125")
        },
        {
            id: 6,
            requirement: new Decimal("1e85")
        },
        {
            id: 7,
            requirement: new Decimal("1e100")
        },
        {
            id: 8,
            requirement: new Decimal("1e85")
        },
        {
            id: 9,
            requirement: new Decimal("1e100")
        },
        {
            id: 10,
            requirement: new Decimal("1e105")
        },
        {
            id: 11,
            requirement: new Decimal("1e110")
        },
        {
            id: 12,
            requirement: new Decimal("1e145")
        },
        {
            id: 13,
            requirement: new Decimal("1e130")
        },
        {
            id: 14,
            requirement: new Decimal("1e130")
        },
        {
            id: 15,
            requirement: new Decimal("1e120")
        }
    ],
    getRequirement(id) {
        for (let r of this.requirements) {
            if (id === r.id) return r.requirement
        }
        return new Decimal("1e9999")
    },
    isInChallenge(g, id) {
        return (g.interference.current & Math.pow(2, id - 1)) !== 0
    },
    totalNodes(g) {
        let count = 0
        for (let i = 1; i <= 15; i++) {
            if ((g.interference.completed & Math.pow(2, i - 1)) !== 0) {
                count++;
            }
        }
        return count;
    },
    nodes(g) {
        let spent = this.upgrades.filter(u => this.hasUpg(g, u.id))
                                 .reduce((a, g) => a += g.cost, 0)
        return this.totalNodes(g) - spent;
    },
    hasUpg(g, id) {
        return (g.interference.upgrades & Math.pow(2, id - 1)) !== 0
    },
    applyUpg(g, id, def = 1) {
        return this.hasUpg(g, id) ? this.upgrades.filter(u => id === u.id)[0].current(g) : def
    },
    hasWon(g) {
        return this.hasUpg(g, 16)
    },
    /*
    Upgrade format:
    REQUIRED
    id: number, must be unique
    tier: n-th row the upgrade will be on
    name: string, self explanatory
    desc: string, self explanatory
    cost: number, self explanatory

    OPTIONAL
    current: function that accepts g as input,
             should output a number / decimal
    prefix: the prefix used when displaying "current"
            the default is "x"
    parent: the upgrades needed to purchase before unlocking this one,
            should be a number (because yes)
    */
    upgrades: [
        {
            id: 1,
            tier: 1,
            name: "聚变",
            desc: "光倍率，随你的光量提升",
            current: (g) => Decimal.pow(1.25, Decimal.log10(g.light.add(1))),
            cost: 2
        },
        {
            id: 2,
            tier: 1,
            name: "超频",
            desc: "红色透镜效果 +50%",
            cost: 1
        },
        {
            id: 3,
            tier: 1,
            name: "暗化",
            desc: "光倍率，随节点总数提升",
            current: (g) => Math.pow(10, DATABASE_CHALLENGE.totalNodes(g)),
            cost: 1
        },
        {
            id: 4,
            tier: 1,
            name: "无限",
            desc: "稳定能量等级改为软上限而非硬上限",
            cost: 1
        },
        {
            id: 5,
            tier: 1,
            name: "超新星",
            desc: "固定的光倍率",
            current: () => 1e15,
            cost: 2
        },
        {
            id: 6,
            tier: 2,
            parent: 1,
            name: "递归",
            desc: "彩虹获取量随未消耗的彩虹提升",
            current: (g) => Decimal.pow(3, Decimal.log10(g.rainbow.add(1))),
            cost: 2
        },
        {
            id: 7,
            tier: 2,
            parent: 2,
            name: "脉冲",
            desc: "光倍率，随本次启动时间衰减",
            current: (g) => Math.max(1, Math.pow(10, 10 - g.stats.currentTime.prism / 120)),
            cost: 1
        },
        {
            id: 8,
            tier: 2,
            parent: 3,
            name: "发散",
            desc: "所有透镜效果 +25%",
            cost: 1
        },
        {
            id: 9,
            tier: 2,
            parent: 4,
            name: "锯齿",
            desc: "光倍率，随本次启动时间提升",
            current: (g) => Math.pow(g.stats.currentTime.prism + 1, 2.5),
            cost: 1
        },
        {
            id: 10,
            tier: 2,
            parent: 5,
            name: "绝对",
            desc: "光倍率，随当前所处的干涉数量提升",
            current: (g) => {
                let count = 0;
                for (let c of DATABASE_CHALLENGE.challenges) {
                    if (DATABASE_CHALLENGE.isInChallenge(g, c.id)) count++;
                }
                return Math.pow(1e5, count)
            },
            cost: 2
        },
        {
            id: 11,
            tier: 3,
            parent: 6,
            name: "有丝分裂",
            desc: "第 10 个振荡升级的倍率 x2 → x2.75",
            cost: 4
        },
        {
            id: 12,
            tier: 3,
            parent: 7,
            name: "超光速粒子",
            desc: "激光运转 ×3 速，但红色透镜效果 +25%",
            cost: 1
        },
        {
            id: 13,
            tier: 3,
            parent: 8,
            name: "汇聚",
            desc: "基础光获取随你的彩虹提升",
            current: (g) => Math.pow(g.rainbow, 0.3),
            prefix: "+",
            cost: 1
        },
        {
            id: 14,
            tier: 3,
            parent: 9,
            name: "膨胀",
            desc: "激光运转 ÷3 速，但蓝色透镜效果 +25%",
            cost: 1
        },
        {
            id: 15,
            tier: 3,
            parent: 10,
            name: "稳定",
            desc: "基础光倍率固定为 x1e10",
            cost: 4
        },
        {
            id: 16,
            tier: 4,
            parent: 13,
            name: "终结",
            desc: "完成游戏",
            cost: 12
        }
    ]
}
