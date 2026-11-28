"use strict";

Vue.component("win-modal", {
    props: {
    },
    template: `
    <base-modal :showCloseButton="false">
        <template #header>
            <div class="modal-win-header">
                <slot name="header">恭喜！</slot>
            </div>
        </template>
        <div class="modal-win-content">
            <slot>你赢了</slot>
        </div>
        <template #footer>
            <div class="modal-win-footer">
                <slot name="button"></slot>
            </div>
        </template>
    </base-modal>
    `
})
