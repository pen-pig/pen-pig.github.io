"use strict";

Vue.component("prompt-modal", {
    data() {
        return {
            input: ""
        }
    },
    mounted() {
        this.$el.querySelector("input").focus()
    },
    template: `
    <base-modal @close="$emit('close')">
        <template #header>
            <div class="modal-prompt-header">
                <slot name="header">输入</slot>
            </div>
        </template>
        <div class="modal-prompt-content">
            <slot>请输入:</slot>
            <li>
                <input v-model="input"/>
            </li>
        </div>
        <template #footer>
            <div class="modal-prompt-footer">
                <button class="modal-confirm-btn" @click="$emit('submit', input)">
                    <slot name="submit">提交</slot>
                </button>
            </div>
        </template>
    </base-modal>
    `
})
