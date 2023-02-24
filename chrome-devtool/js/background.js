chrome.runtime.onConnect.addListener(connection => {

    let devToolsConnection = null;
    let contentConnection = null;

    if (connection.name === "bg-devtools-page") {
        devToolsConnection = connection;
        let devToolsListener = (message, sender, sendResponse) => {
            console.log("(Background): devtools sent message: " + message.type);
            if (message.type === "init") {
                let p1 = chrome.scripting.executeScript({
                    files: ["/js/in_page_content_script.js"],
                    target: {
                        tabId: message.tabId
                    },
                    world: chrome.scripting.ExecutionWorld.MAIN
                });
                let p2 = chrome.scripting.executeScript({
                    files: ["/js/content_script.js"],
                    target: {
                        tabId: message.tabId
                    }
                });
                Promise.allSettled([p1, p2]).then(results => {
                    console.log("(Background) script run: " + results);
                    contentConnection = chrome.tabs.connect(message.tabId, { name: "bg-devtools-background"});
                    let contentListener = (message, sender, sendResponse) => {
                        console.log("(Background): content sent message: " + message.type);
                        devToolsConnection.postMessage(message);
                    }
                    contentConnection.onMessage.addListener(contentListener);
                    contentConnection.onDisconnect.addListener(() => {
                        contentConnection.onMessage.removeListener(contentListener);
                    });
                    contentConnection.postMessage(message); // init message from dev tools
                });
            } else {
                contentConnection.postMessage(message);
            }
        }
        connection.onMessage.addListener(devToolsListener);
        connection.onDisconnect.addListener(() => {
            connection.onMessage.removeListener(devToolsListener);
        });
    }
});