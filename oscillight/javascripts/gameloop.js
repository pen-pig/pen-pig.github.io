function gameLoop(that, t = 0){
    let g = that.game;

    let dt = Math.max(0, (Date.now() - g.lastTick) / 1000) // Unit is second

    if (dt <= 0) {
        g.lastTick = Date.now() // Prevent softlock when the last tick is in the future - Encouraged cheating though!
        return
    }

    if (t !== 0) dt = t;

    if (dt >= 60 && t === 0) { // to prevent recursion
        for (let i = 0; i < 1000; i++) {
            gameLoop(that, dt / 1000)
        } //Simulate offline progress
        return
    }

    // Developer mode game speed multipliers
    // 每条时间流实际倍速 = 总倍速 × 模块倍速（各 1~10，相乘最大 100 倍）
    let sdtOsc = dt * getModuleSpeed("oscillation") // 振荡: 波相位 + 光产量
    let sdtLaser = dt * getModuleSpeed("laser")     // 增幅: 激光（另乘激光倍率）
    let sdtPrism = dt * getModuleSpeed("prism")     // 色散: 棱镜计时
    let sdtMeta = dt * getModuleSpeed("meta")       // 干涉: 总计时

    if (g.decelerate.auto && isNumberString(g.decelerate.value)) {
        if (DATABASE_WAVE.light.energy(g) > g.decelerate.value) {
            g.decelerate.isActive = true
        } else {
            g.decelerate.isActive = false
        }
    }

    if (g.autobuyUpgrades) {
        that.$refs[that.tabs[0]][0].buyMax()
    }

    g.period = (g.period + DATABASE_WAVE.light.speed(g) * sdtOsc) % 360

    if (g.laser.isActive) {
        g.laser.time += sdtLaser * getLaserRate() // 开发者模式: 激光倍率 1~10
                           * (DATABASE_CHALLENGE.hasUpg(g, 12) ? 3 : 1)
                           * (DATABASE_CHALLENGE.hasUpg(g, 14) ? 1/3 : 1);
    }

    g.light = g.light.add(DATABASE_WAVE.light.rate(g).times(sdtOsc))

    if (DATABASE_PRISM.hasMetAutoRequirement(g)) {
        DATABASE_PRISM.reset(g);
    }

    if (DATABASE_CHALLENGE.hasWon(g)) {
        g.hasWon = true; // This pauses the timer
    }

    g.stats.currentTime.prism += sdtPrism
    if (!g.hasWon) g.stats.currentTime.meta += sdtMeta

    if (g.light.gte(17.5)) g.unlocks.upgrades = true;
    if (g.light.gte(50)) g.unlocks.decelerate = true;
    if (g.light.gte(1000)) g.unlocks.amplification = true;
    if (g.light.gte(1e50)) g.unlocks.prism = true;
    if (g.rainbow.gte(1000)) g.unlocks.interference = true;

    if (g.laser.isActive === true) g.achievementConditions["11"] = false;
    DATABASE_ACHIEVEMENT.check(g);

    g.lastTick += dt * 1000 // Real time - do NOT scale, or the game would freeze
}
