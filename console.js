(function () {
    const original = {
        log: console.log,
        warn: console.warn,
        error: console.error,
        debug: console.debug
    };

    function stamp() {
        return `[${new Date().toLocaleTimeString()}]`;
    }

    console.log = (...args) => original.log(stamp(), ...args);
    console.warn = (...args) => original.warn(stamp(), ...args);
    console.error = (...args) => original.error(stamp(), ...args);
    console.debug = (...args) => original.debug(stamp(), ...args);

    window.addEventListener("error", (e) => {
        console.error("WINDOW ERROR:", e.message, "at", e.filename, "line", e.lineno);
    });

    window.addEventListener("unhandledrejection", (e) => {
        console.error("UNHANDLED PROMISE:", e.reason);
    });

    console.log("Console logger initialized.");
})();
