let contentScriptListener = (event) => {
    // do I get my own messages?
    if (event.source !== window) {
        return;
    }
    console.log("(In page) handling message: " + event.data.type);
    if (event.data.type === "init") {
        // all good response
        window.postMessage({type: "init-resp"}, "*");
    } else if (event.data.type === "get-graphs") {
        let graphResp = {
            type: "get-graphs-resp",
            graphs: Array.from(globalThis.__bgAllGraphs.keys())
        };
        window.postMessage(graphResp, "*");
    }
}
window.addEventListener("message", contentScriptListener);
window.addEventListener("disconnect", () => {
    window.removeEventListener("message", contentScriptListener);
});

// here I could put a hook into the graph debugger to send updates back to devtools