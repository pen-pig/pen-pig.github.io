"use strict";

Vue.component("oscillation-tab", {
    data() {
        return {
            canvas: {
                width: 480,
                height: 240
            }
        }
    },
    props: {
        game: Object
    },
    computed: {
        getEnergy() {
            return DATABASE_WAVE.light.energy(this.game)
        },
        getProduction() {
            return DATABASE_WAVE.light.rate(this.game)
        },
        getSpeed() {
            return (DATABASE_WAVE.light.speed(this.game)) / 360
        },
        getUnlockedUpgrades() {
            return DATABASE_WAVE.upgrades.filter(u => {
                let maxTier = 1;
                if (this.game.unlocks.laser || this.game.unlocks.prism) {
                    maxTier = 3
                } else if (this.game.unlocks.decelerate) {
                    maxTier = 2
                }
                return u.tier <= maxTier
            })
        },
        isDecelActive() {
            return this.game.decelerate.isActive
        },
        getToggleDecelState() {
            return this.isDecelActive ? "on" : "off"
        },
        isAutoUnlocked() {
            return this.game.upgrades[6] >= 1
        },
        isAutoActive() {
            return this.game.decelerate.auto
        },
        getAutoState() {
            return this.isAutoActive ? "on" : "off"
        },
        isValidValue() {
            return isNumberString(this.game.decelerate.value)
        },
        isAutobuyUnlocked() {
            return DATABASE_PRISM.hasUpg(this.game, 8)
        },
        isAutobuyActive() {
            return this.game.autobuyUpgrades;
        },
        getAutobuyState() {
            return this.isAutobuyActive ? "on" : "off"
        },
    },
    watch: {
        game: {
            deep: true,
            handler() {
                this.draw();
            }
        }
    },
    methods: {
        getCssVar(name) {
            return getCssVar(name);
        },
        draw() {
            let w = this.canvas.width, h = this.canvas.height;

            // source: https://stackoverflow.com/questions/29917446/drawing-sine-wave-in-canvas
            let c = this.$el.querySelector(".wave-display") // get the canvas object to draw onto
            if (c === null) return; // Stops running if the canvas is hidden
            let ctx = c.getContext("2d"); // will use simple 2D context on the canvas
            ctx.fillStyle = this.getCssVar("--background")
            ctx.fillRect(0, 0, w, h); // clear the canvas

            ctx.strokeStyle = this.getCssVar("--color")
            ctx.lineWidth = 2;

            ctx.moveTo(0, h/2);  // back to the left before drawing the sine
            ctx.beginPath()

            for (let x = 0; x <= 360; x += 1) { // 360 steps (degrees) for entire sine period
                let y = this.getY(x) // calculate y flipped horizontally, converting from DEG to RADIAN
                ctx.lineTo(w/360 * x, h/360 * y); // draw the point
            }
            ctx.stroke(); // strokes the drawing to the canvas

            ctx.beginPath();
            ctx.arc(w/360 * 180, h/360 * this.getY(180), 10, 0, 2 * Math.PI);
            ctx.fillStyle = this.getCssVar("--color-yellow")
            ctx.fill()
            ctx.stroke()
        },
        getY(x) {
            return 180.0 + Math.sin(x * Math.PI / 180 + Math.radian(this.game.period)) * 160;
        },
        format(num) {
            return toSci(num)
        },
        decel() {
            this.game.decelerate.isActive = !this.isDecelActive;
        },
        toggleAuto() {
            this.game.decelerate.auto = !this.isAutoActive;
        },
        toggleAutobuy() {
            this.game.autobuyUpgrades = !this.isAutobuyActive;
        },
        buyMax() {
            this.$refs.upg.forEach(upg => upg.buyMax());
        }
    },
    mounted() {
        this.draw();
    },
    template: `
    <div class="tab main">
        <div class="mini-header">
            能量等级: {{format(getEnergy)}}
        </div>
        <canvas class="wave-display" :width="canvas.width" :height="canvas.height"/>

        光子每秒释放 {{format(getProduction)}} 光<br>
        振荡频率: {{format(getSpeed)}} Hz

        <div class="decel-con" v-if="game.unlocks.decelerate">
            <button class="decel-btn"
                    :class="getToggleDecelState"
                    @click="decel">
                {{isDecelActive ? "取消减速！" : "减速光子！"}}
            </button>

            <button v-if="isAutoUnlocked"
                    class="auto-btn"
                    :class="getAutoState"
                    @click="toggleAuto">
                自动: {{isAutoActive ? "开" : "关"}}
            </button>

            <span v-if="isAutoUnlocked" class="auto-desc">
                仅当能量等级高于以下数值时自动减速:&nbsp<input class="auto-field"
                                                                       v-model="game.decelerate.value"
                                                                       :class="{'red': !isValidValue}">
            </span>
        </div>

        <div class="buy-max-con">
            <button v-if="(game.unlocks.rainbowUpgrades || game.stats.resets.meta >= 1) && game.unlocks.upgrades"
                    class="buy-max"
                    @click="buyMax">
                买满
            </button>

            <button v-if="isAutobuyUnlocked"
                    class="autobuy-btn"
                    :class="getAutobuyState"
                    @click="toggleAutobuy">
                自动购买: {{isAutobuyActive ? "开" : "关"}}
            </button>
        </div>

        <div v-if="game.unlocks.upgrades" class="upg-con">

            <oscillation-tab-upgrade v-for="upg in getUnlockedUpgrades"
                              :game="game"
                              :upgrade="upg"
                              :key="upg.id"
                              ref="upg"/>
        </div>
    </div>
    `
})
