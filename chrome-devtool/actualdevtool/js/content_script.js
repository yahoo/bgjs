//debugger;
chrome.runtime.onConnect.addListener(connection => {
    let backgroundPageConnection = null;
    if (connection.name === "bg-devtools-background") {
        backgroundPageConnection = connection;
        let backgroundListener = (message, sender, sendResponse) => {
            console.log("(Content) background sent message: " + message.type);
            window.postMessage(message, "*"); // TODO: restrict to this extension
        }
        backgroundPageConnection.onMessage.addListener(backgroundListener);
        backgroundPageConnection.onDisconnect.addListener(() => {
            backgroundPageConnection.onMessage.removeListener(backgroundListener);
        });

        let inPageListener = (event) => {
            // do I get my own message?
            if (event.source !== window) {
                return;
            }
            backgroundPageConnection.postMessage(event.data);
        }
        window.addEventListener("message", inPageListener);
        window.addEventListener("disconnect", () => {
            window.removeEventListener("message", inPageListener);
        });
    }

});