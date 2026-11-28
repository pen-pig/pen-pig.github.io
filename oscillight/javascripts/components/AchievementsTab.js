Vue.component("achievements-tab", {
    data() {
        return {
        }
    },
    props: {
        game: Object
    },
    computed: {
        moveCompletedDown() {
            return this.game.settings.moveAchievement;
        },
        totalAchievements() {
            return DATABASE_ACHIEVEMENT.achievements;
        },
        completedAchievements() {
            return this.totalAchievements.filter(a => {
                return DATABASE_ACHIEVEMENT.hasAchievement(this.game, a.id)
            })
        },
        getAchievements() {
            const ACH = this.totalAchievements;
            if (this.moveCompletedDown) {
                return ACH.filter(a => {
                    return !DATABASE_ACHIEVEMENT.hasAchievement(this.game, a.id)
                }).concat(this.completedAchievements)
            }
            return ACH;
        },
        hasAllAchievements() {
            return this.totalAchievements.length === this.completedAchievements.length;
        }
    },
    methods: {
    },
    template: `
    <div class="tab achievements">
        <span :class="hasAllAchievements ? 'green' : ''">
            已完成成就: {{completedAchievements.length}}/{{totalAchievements.length}}
        </span>
        <button class="move-ach"
                :class="moveCompletedDown ? 'on' : 'off'"
                @click="game.settings.moveAchievement = !moveCompletedDown">
            把已完成成就移到底部: {{moveCompletedDown ? '开' : '关'}}
        </button>
        <achievement v-for="a in getAchievements"
                     :game="game"
                     :achievement="a"
                     :key="a.id"/>
    </div>`
})
