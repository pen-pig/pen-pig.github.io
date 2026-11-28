"use strict";

Vue.component("alert-modal", {
    template: `
    <base-modal :showCloseButton="false">
        <template #header>
            <div class="modal-alert-header">
                <slot name="header">提示</slot>
            </div>
        </template>
        <div class="modal-alert-content">
            <slot>提示内容</slot>
        </div>
        <template #footer>
            <div class="modal-alert-footer">
                <button class="modal-alert-btn" @click="$emit('ok')">
                    <slot name="ok">确定</slot>
                </button>
            </div>
        </template>
    </base-modal>
    `
})
