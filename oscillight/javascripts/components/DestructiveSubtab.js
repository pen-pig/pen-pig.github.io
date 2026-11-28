"use strict";

Vue.component("destructive-subtab", {
    data() {
        return {
            config: 0,
            exitModal: false
        }
    },
    props: {
        game: Object
    },
    watch: {
    },
    computed: {
        challenges() {
            return DATABASE_CHALLENGE.challenges
        },
        current() {
            return this.game.interference.current
        },
        isInChallenge() {
            return this.current !== 0
        },
        canEnter() {
            return !this.isInChallenge && this.config !== 0
        },
        canExit() {
            return this.isInChallenge
        },
        getRequirement() {
            return DATABASE_CHALLENGE.getRequirement(this.config)
        }
    },
    methods: {
        hasBit(num, id) {
            return (num & Math.pow(2, id - 1)) !== 0
        },
        toggle(id) {
            this.config ^= Math.pow(2, id - 1)
        },
        enter() {
            if (this.canEnter) {
                DATABASE_CHALLENGE.enterChallenge(this.game, this.config)
            }
        },
        exit() {
            if (this.canExit) {
                DATABASE_CHALLENGE.exitChallenge(this.game)
            }
            this.exitModal = false
        },
        format(n, a, b) {
            return toSci(n, a, b)
        }
    },
    mounted() {
        this.config = this.game.interference.current
    },
    template: `
    <div class="tab challenge">
        <div class="challenge-head">
            进入干涉可获得节点！<br>
            每种干涉组合首次完成奖励 1 节点。<br>
            完成干涉的方法：达到需求光量，<br>
            并在该条件下启动棱镜。
        </div>
        <div class="challenge-body">
            <div class="challenge-config">
                <table>
                    <tr>
                        <td>干涉</td>
                        <td v-for="c in challenges">
                            <div :class="c.color">
                                {{c.acronym}}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td>组合</td>
                        <td v-for="c in challenges">
                            <div v-if="isInChallenge"
                                 :class="hasBit(current, c.id) ? 'green' : 'red'">
                                {{hasBit(current, c.id) ? "1" : "0"}}
                            </div>
                            <button v-else
                                    @click="toggle(c.id)"
                                    :class="hasBit(config, c.id) ? 'green' : 'red'"
                                    class="config-btn">
                                {{hasBit(config, c.id) ? "1" : "0"}}
                            </button>
                        </td>
                    </tr>
                    <tr>
                        <td>需求</td>
                        <td v-if="config === 0" colspan="2">/</td>
                        <td v-else colspan="2">{{format(getRequirement)}} 光</td>
                    </tr>
                </table>
                <div class="transverse-btn-con">
                    <button :class="{'disabled': !canEnter}" class="green" @click="enter">
                        进入干涉
                    </button>
                    <button :class="{'disabled': !canExit}" class="warning"
                            @click="exitModal = canExit">
                        退出干涉
                    </button>
                </div>
                <div class="challenge-warn">
                    <div class="challenge-warn-header">
                        进入/退出干涉将会:
                    </div>
                    <ul>
                        <li>把所有光尽量换算成彩虹</li>
                        <li>重置棱镜启动所重置的一切</li>
                        <li class="warning">关闭激光</li>
                    </ul>
                </div>
            </div>
            <div class="challenge-meta">
                <div v-for="c in challenges">
                    <span class="challenge-name" :class="c.color">
                        {{c.name}}:
                    </span>
                    <ul>
                        <li>
                            {{c.desc}}
                        </li>
                    </ul>
                </div>
            </div>
        </div>
        <confirmation-modal v-if="exitModal" @yes="exit" @no="exitModal = false">
            <template #header>
                <span class="warning">退出干涉</span>
            </template>

            确定要退出干涉吗？
        </confirmation-modal>
    </div>
    `
})
