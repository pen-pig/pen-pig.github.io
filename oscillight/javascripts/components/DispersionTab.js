"use strict";

Vue.component("dispersion-tab", {
    data() {
        return {
            currentTab: "",
            tabs: ["棱镜", "升级"]
        }
    },
    props: {
        game: Object
    },
    computed: {
        currentTabComponent() {
            const map = {
                "棱镜": "prism-subtab",
                "升级": "upgrades-subtab"
            };
            return map[this.currentTab] || (this.currentTab.toLowerCase() + "-subtab");
        }
    },
    methods: {
        switchTab(tab) {
            this.currentTab = tab;
            scroll(0, 0)
        }
    },
    created() {
        this.currentTab = this.tabs[0]
    },
    template: `
    <div class="tab dispersion">
        <div class="subtab-nav">
            <button v-for="tab in tabs" @click="switchTab(tab)">
                {{tab}}
            </button>
        </div>
        <div class="subtab-con">
            <component :is="currentTabComponent" :game="game" @switch-tab="switchTab(tabs[1])"></component>
        </div>
    </div>
    `
})
