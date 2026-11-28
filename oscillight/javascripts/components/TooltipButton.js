"use strict";

Vue.component("tooltip-button", {
    props: {
        tooltip: {
            default: "提示文字",
            type: String
        }
    },
    methods: {
        click() {
            let classList = this.$el.querySelector(".tooltip-text").classList;
            classList.add("is-active");
            setTimeout(() => {
                classList.remove("is-active")
            }, 1000)
            this.$emit('click');
        }
    },
    template: `
    <button class="tooltip-btn" @click="click()">
        <slot>文字</slot>
        <span class="tooltip-text">{{tooltip}}</span>
    </button>
    `
})
