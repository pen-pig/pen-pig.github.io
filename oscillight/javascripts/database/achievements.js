const DATABASE_ACHIEVEMENT = {
    check(g) {
        for (let a of this.achievements) {
            if (!this.hasAchievement(g, a.id)) {
                if (a.condition !== undefined) {
                    if (a.condition(g)) {
                        this.addAchievement(g, a.id)
                    }
                }
            }
        }
    },
    // Used for secret achievements etc.
    addAchievement(g, i) {
        let achievement;
        try {
            achievement = this.getAchievement(i);
        } catch(e) {
            console.error(e)
            return
        }
        if (!this.hasAchievement(g, i)) {
            g.achievements |= Math.pow(2, i - 1)
            toastr.success(achievement.name, "成就解锁！")
        }
    },
    getAchievement(i) {
        const entries = this.achievements.filter(a => a.id === i);
        if (entries.length === 1) {
            return entries[0];
        } else if (entries.length > 1) {
            throw `Error: There are multiple achievements with the id ${i}`
        }
        throw `Error: Achievement with id ${i} not found`
    },
    hasAchievement(g, i) {
        return (g.achievements & Math.pow(2, i - 1)) !== 0
    },
    /* achievement format:

    REQUIRED:
    id: Number, cannot be repeated.
    name: string, title of the achievement.
    description: string, way to complete the achievement.

    OPTIONAL:
    condition: function, returns a boolean, grants achievement automatically
               when the function returns true.
               default value: false
    reward: string, automatically formatted, display the reward of achievement
    path: string, provides path to the achievement image
    isSecret: boolean, when true, hides every info (except title) until
              the achievement has been obtained


    All secret achievement id should go from 50 to 49, 48...
    to separate them from normal achievements
    */

    achievements: [
        {
            id: 1,
            path: "src/light.png",
            name: "要有光！",
            description: "达到 10 光",
            condition(g) {
                return g.light.gte(10);
            }
        },
        {
            id: 2,
            path: "src/deceleration.png",
            name: "光子市场收割者",
            description: "减速光子",
            condition(g) {
                return g.decelerate.isActive === true
            }
        },
        {
            id: 3,
            path: "src/laser.png",
            name: "光学增幅",
            description: "启动激光",
            condition(g) {
                return g.laser.isActive === true
            }
        },
        {
            id: 4,
            path: "src/universe.png",
            name: "点亮宇宙！",
            description: "达到 1e25 光",
            condition(g) {
                return g.light.gte("1e25")
            }
        },
        {
            id: 5,
            path: "src/lens.png",
            name: "发射前干预",
            description: "装备一个透镜",
            condition(g) {
                return g.lenses !== 0
            }
        },
        {
            id: 6,
            path: "src/prism.png",
            name: "碎裂光束",
            description: "启动棱镜",
            condition(g) {
                return g.unlocks.rainbowUpgrades === true
            },
            reward: "解锁买满"
        },
        {
            id: 7,
            path: "src/spectral.png",
            name: "光谱断裂",
            description: "达到 1000 彩虹",
            condition(g) {
                return g.rainbow.gte(1000)
            },
             reward: "过热惩罚从 50% 降至 10%"
        },
        {
            id: 8,
            path: "src/double-slit.png",
            name: "双缝实验",
            description: "完成一次干涉",
            condition(g) {
                return g.interference.completed !== 0
            }
        },
        {
            id: 9,
            path: "src/infinity.png",
            name: "无限",
            description: "达到 1e308 光",
            condition(g) {
                return g.light.gte("1e308")
            },
            reward: "可以同时装备全部三个透镜"
        },
        {
            id: 10,
            path: "src/rbg.png",
            name: "红蓝绿",
            description: "完成 7 次干涉",
            condition(g) {
                return DATABASE_CHALLENGE.totalNodes(g) >= 7
            }
        },
        {
            id: 11,
            path: "src/broke laser.png",
            name: "我把激光弄坏了",
            description: "在本次棱镜重置中从不启动激光，达到 1e150 光",
            condition(g) {
                return g.light.gte("1e150") && g.achievementConditions["11"]
            }
        },
        {
            id: 12,
            path: "src/fragment.png",
            name: "色彩碎片",
            description: "达到 1e20 彩虹",
            condition(g) {
                return g.rainbow.gte("1e20")
            }
        },
        {
            id: 13,
            path: "src/maximum.png",
            name: "全满",
            description: "买满所有振荡升级",
            condition(g) {
                for (let upg of DATABASE_WAVE.upgrades) {
                    if (g.upgrades[upg.id] < upg.cap) {
                        return false
                    }
                }
                return true
            }
        },
        {
            id: 14,
            path: "src/chromaticity.png",
            name: "色度",
            description: "达到 1e30 彩虹",
            condition(g) {
                return g.rainbow.gte("1e30")
            }
        },
        {
            id: 15,
            path: "src/beacon.png",
            name: "信标",
            description: "达到 1e900 光",
            condition(g) {
                return g.light.gte("1e900")
            }
        }
    ]
}
