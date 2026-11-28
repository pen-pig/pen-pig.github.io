Vue.component("amplification-tab", {
    data() {
        return {
            canvas: {
                width: 480,
                height: 240
            }
        }
    },
    watch: {
        game: {
            deep: true,
            handler() {
                this.draw();
            }
        }
    },
    props: {
        game: Object
    },
    computed: {
        getCost() {
            return DATABASE_LASER.laser.cost
        },
        getLensesCost() {
            return DATABASE_LASER.lensesCost;
        },
        canBuy() {
            return this.game.light.gte(this.getCost);
        },
        canBuyLenses() {
            return this.game.light.gte(this.getLensesCost);
        },
        getEnergyLevel() {
            return Math.round(this.getPower(this.game.laser.time) * 1000) / 1000
        },
        isLaserActive() {
            return this.game.laser.isActive
        },
        getToggleLaserState() {
            return this.isLaserActive ? "on" : "off"
        },
        getStatus() {
            return DATABASE_LASER.laser.status(this.game);
        },
        getEffect() {
            return DATABASE_LASER.laser.effect(this.game);
        },
        getUnlockedLenses() {
            return DATABASE_LASER.lenses.filter(l => {
                let maxTier = 1;
                return l.tier <= maxTier
            })
        }
    },
    methods: {
        getCssVar(name) {
            return getCssVar(name);
        },
        getPower(t = 0) {
            return DATABASE_LASER.laser.power(this.game, t)
        },
        draw() {
            let w = this.canvas.width, h = this.canvas.height;
            let t = this.game.laser.time;
            // I just copied the code from Oscillation tab

            let c = this.$el.querySelector(".laser-display") // get the canvas object to draw onto
            if (c === null) return;

            let ctx = c.getContext("2d"); // will use simple 2D context on the canvas
            ctx.fillStyle = this.getCssVar("--background")
            ctx.fillRect(0, 0, w, h); // clear the canvas

            ctx.strokeStyle = this.getCssVar("--color")
            ctx.lineWidth = 2;

            ctx.moveTo(0, h);
            ctx.beginPath()

            let dt = t >= 60 ? t - 60 : 0
            let dy = this.getY(t) <= 0.5 ? 0.5 - this.getY(t) : 0
            for (let x = 0; x <= 360; x += 1) { // 360 steps
                ctx.lineTo(w/360 * x, h * (this.getY(x / 3 + dt) + dy)); // draw the point
            }
            ctx.stroke(); // strokes the drawing to the canvas

            ctx.beginPath();
            ctx.arc(w/360 * (t >= 60 ? 180 : t * 3) , h * (this.getY(t) + dy), 10, 0, 2 * Math.PI);
            ctx.fillStyle = this.getCssVar("--color-red")
            ctx.fill()
            ctx.stroke()
        },
        getY(t = 0) {
            return 0.9 - this.getPower(t) * 0.8
        },
        format(num, a, b) {
            return toSci(num, a, b)
        },
        unlock() {
            if (this.canBuy) {
                this.game.light = this.game.light.minus(this.getCost)
                this.game.unlocks.laser = true
            }
        },
        unlockLenses() {
            if (this.canBuyLenses) {
                this.game.light = this.game.light.minus(this.getLensesCost)
                this.game.unlocks.lenses = true
            }
        },
        toggle() {
            this.game.laser.isActive = !this.isLaserActive
            this.game.laser.time = 0; //reset
        },
        statusText(s) {
            const map = {
                deactivated: "未启动",
                charging: "充能中",
                charged: "已充能",
                overheat: "过热",
                stabilizing: "稳定中",
                stabilized: "已稳定",
                softcapped: "软上限"
            };
            return map[s] || s;
        }
    },
    mounted() {
        this.draw()
    },
    template: `
    <div class="tab laser">
        <button v-if="!game.unlocks.laser" class="upg"
                      :class="canBuy ? 'canBuy' : 'locked'"
                      @click="unlock">
            <span>解锁激光</span>
            <span>花费: {{format(getCost)}} 光</span>
        </button>
        <div v-else class="laser-content">
            <div class="mini-header"
                 :class="{
                     'warning': getStatus === 'overheat',
                     'green': ['charged', 'stabilized', 'softcapped'].includes(getStatus)
                 }">
                激光状态: {{statusText(getStatus)}}
            </div>

            <canvas class="laser-display" :width="canvas.width" :height="canvas.height"/>

            <span>能量等级: {{format(getEnergyLevel, 2, 3)}}</span>
            <span>=> 光获取量 ^{{format(getEffect)}}</span>

            <button class="toggle-laser-btn"
                    :class="getToggleLaserState"
                    @click="toggle">
                {{isLaserActive ? "关闭" : "启动"}}激光！
            </button>

            <button v-if="!game.unlocks.lenses"
                          class="upg"
                          :class="canBuyLenses ? 'canBuy' : 'locked'"
                          @click="unlockLenses">
                <div>解锁透镜</div>
                <div>花费: {{format(getLensesCost)}} 光</div>
            </button>

            <div v-else class="lenses-context">
                关闭激光后才能装备透镜！

                <div class="upg-con">
                    <amplification-tab-lens v-for="lens in getUnlockedLenses"
                                              :game="game"
                                              :lens="lens"
                                              :key="lens.id"/>
                </div>
            </div>
        </div>
    </div>`
})
