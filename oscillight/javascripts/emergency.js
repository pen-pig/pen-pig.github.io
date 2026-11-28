const EMERGENCY = {
    export() {
        copyText(btoa(window.localStorage.getItem(SAVE_NAME)));
    },
    reset() {
        if (confirm("确定要重置游戏吗？")) {
            window.localStorage.removeItem(SAVE_NAME);
            location.reload();
        }
    }
}

setTimeout(() => {
    let el = document.querySelector(".fail-save")
    if (el !== undefined) {
        el.style.display = "block"
    }
}, 7000)
