class HotModule {
    file;
    callback;

    constructor(file) {
        this.file = file;
    }

    setCallback(callback) {
        this.callback = callback;
    }

    async update() {
        if (!this.callback) {
            console.log("no callback");
            return;
        }

        const content = await import(`${this.file}?t=${Date.now()}`);
        this.callback(content);
    }
}

function hmrClient(host, file) {
    const hotModule = new HotModule(file);
    import.meta.hot = hotModule;

    window.hotModules ??= new Map();
    window.hotModules.set(file, hotModule);

    if (!window.ws) {
        const ws = new window.WebSocket(`ws://${host}/ws`);
        ws.addEventListener("message", (message) => {
            const data = JSON.parse(message.data);
            console.log(data);

            switch (data.type) {
            case "file:changed":
                window.hotModules.get(data.file)?.update();
                break;
            }
        });

        window.ws = ws;
    }
}
