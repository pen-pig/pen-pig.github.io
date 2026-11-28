"use strict";

Vue.component("interference-tab", {
    data() {
        return {
            selectedTab: "",
            tabs: ["构建", "破坏", "完成情况"]
        }
    },
    props: {
        game: Object
    },
    computed: {
        currentTabComponent() {
            const map = {
                "构建": "constructive-subtab",
                "破坏": "destructive-subtab",
                "完成情况": "completions-subtab"
            };
            return map[this.selectedTab] || (this.selectedTab.toLowerCase() + "-subtab");
        }
    },
    methods: {
        switchTab(tab) {
            this.selectedTab = tab;
        }
    },
    created() {
        this.selectedTab = this.tabs[0];
    },
    template: `
    <div class="tab interference">
        <div class="subtab-nav">
            <button v-for="tab in tabs" @click="switchTab(tab)">
                {{tab}}
            </button>
        </div>
        <div class="subtab-con">
            <keep-alive>
                <component :is="currentTabComponent" :game="game"></component>
            </keep-alive>
        </div>
    </div>
    `
})
