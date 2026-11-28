"use strict";

Vue.component("confirmation-modal", {
    template: `
    <base-modal :showCloseButton="false">
        <template #header>
            <div class="modal-confirm-header">
                <slot name="header">确认</slot>
            </div>
        </template>
        <div class="modal-confirm-content">
            <slot>确定吗？</slot>
        </div>
        <template #footer>
            <div class="modal-confirm-footer">
                <button class="modal-confirm-btn warning" @click="$emit('yes')">
                    <slot name="yes">是</slot>
                </button>
                <button class="modal-confirm-btn" @click="$emit('no')">
                    <slot name="no">否</slot>
                </button>
            </div>
        </template>
    </base-modal>
    `
})
