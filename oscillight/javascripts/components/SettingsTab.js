"use strict";

Vue.component("settings-tab", {
    data() {
        return {
            SAVE_NAME,
            themes,
            dev: DEVMODE,
            devPasswordInput: "",
            showWipeDataModal: false,
            showImportModal: false
        }
    },
    props: {
        game: Object
    },
    methods: {
        themeName(i) {
            const names = ["明亮", "暗黑"];
            return names[i] || themes[i];
        },
        importSave(save) {
            this.showImportModal = false;

            if (save === null || save === "") return
            if (isValidSave(save)) {
                localStorage.setItem(SAVE_NAME, window.atob(save))
                window.location.reload()
            }
        },
        exportSave() {
            copyText(btoa(JSON.stringify(this.game)));
        },
        switchTheme() {
            this.game.settings.theme ++;
            if (this.game.settings.theme >= themes.length) {
                this.game.settings.theme = 0;
            }
            setTheme(this.game.settings.theme);
        },
        reset() {
            localStorage.removeItem(SAVE_NAME);
            location.reload();
        },
        tryUnlock() {
            if (devTryUnlock(this.devPasswordInput)) {
                this.devPasswordInput = "";
                toastr.success("", "开发者模式已解锁");
            } else {
                toastr.error("", "密码错误");
            }
        }
    },
    template: `
    <div class="tab settings-tab">
        <div class="settings-btn-con">
            <button @click="switchTheme">
                主题: {{themeName(game.settings.theme)}}
            </button>

            <button @click="showImportModal = true">
                导入
            </button>

            <tooltip-button @click="exportSave" tooltip="已复制！">
                导出
            </tooltip-button>

            <button class="warning" @click="showWipeDataModal = true">
                清除所有数据
            </button>

            <div class="break"></div>

            <button v-if="game.unlocks.interference"
                    :class="game.settings.effect.interference ? 'on' : 'off'"
                    @click="game.settings.effect.interference = !game.settings.effect.interference">
                干涉背景特效: {{game.settings.effect.interference ? "开" : "关"}}
            </button>
        </div>

        <div class="dev-unlock">
            <template v-if="dev.unlocked">
                <span class="green">开发者模式: 已解锁</span>
                <div class="dev-note">导航栏已出现“开发者”标签页。</div>
            </template>
            <template v-else>
                <div>开发者模式</div>
                <input type="password"
                       v-model="devPasswordInput"
                       @keyup.enter="tryUnlock"
                       placeholder="输入密码" />
                <button @click="tryUnlock">解锁</button>
            </template>
        </div>

        <div class="hotkeys">
            <div>快捷键:</div>
            <ul>
                <li v-if="game.unlocks.decelerate || game.unlocks.rainbowUpgrades">光子减速: D</li>
                <li v-if="game.unlocks.laser || game.unlocks.rainbowUpgrades">激光开关: L</li>
                <li v-if="game.unlocks.rainbowUpgrades">买满: M</li>
                <li v-if="game.unlocks.rainbowUpgrades">启动棱镜: P</li>
            </ul>
        </div>

        <div class="extra">
            作者 Buck | IGJ 2021 参赛作品 | <a target="_blank" href="changelog/changelog.html">更新日志</a> | <a target="_blank" href="https://discord.com/invite/N8MuKMz">Discord</a>
        </div>

        <confirmation-modal v-if="showWipeDataModal" @yes="reset" @no="showWipeDataModal = false">
            <template #header>
                <span class="warning">清除所有数据</span>
            </template>

            确定要清除所有用户数据吗？ <span class="warning">此操作无法撤销！</span>
        </confirmation-modal>

        <prompt-modal v-if="showImportModal" @submit="importSave" @close="showImportModal = false">
            <template #header>
                导入
            </template>

            请在此粘贴你的存档: <span class="warning">（当前存档将被覆盖！）</span>
        </prompt-modal>
    </div>
    `
})
