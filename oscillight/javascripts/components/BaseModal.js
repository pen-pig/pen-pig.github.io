"use strict";

Vue.component("base-modal", {
    props: {
        showCloseButton: {
            default: true,
            type: Boolean
        }
    },
    template: `
    <div class="modal-outer">
        <div class="modal">
            <button class="modal-close" v-if="showCloseButton" @click="$emit('close')">×</button>
            <slot name="header">弹窗标题</slot>
            <slot>弹窗内容</slot>
            <slot name="footer">弹窗底部</slot>
        </div>
    </div>
    `
})
