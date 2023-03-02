
let panelWindow = null;
let graphIds = null;
let currentGraphId = null;

chrome.devtools.panels.create('Behavior Graph', null, '/html/panel.html', panel => {
    panel.onShown.addListener(localPanelWindow => {
        panelWindow = localPanelWindow;
        uiUpdateGraphs();
    });
});

let backgroundPageConnection = chrome.runtime.connect({
    name: "bg-devtools-page"
});

backgroundPageConnection.onMessage.addListener(message => {
    if (message.type === "init-resp") {
        backgroundPageConnection.postMessage({
            type: "get-graphs"
        });
    } else if (message.type === "get-graphs-resp") {
        graphIds = message.graphs;
        uiUpdateGraphs();
    }
    console.log("(Devtools): Message from backgroundPage: " + message);
});

if (chrome.devtools.inspectedWindow && chrome.devtools.inspectedWindow.tabId) {
    backgroundPageConnection.postMessage({
        type: "init",
        tabId: chrome.devtools.inspectedWindow.tabId
    });
}

function uiUpdateGraphs() {
    if (panelWindow === null || graphIds === null) {
        return;
    }
    debugger;
    for (let i = 0; i < graphIds.length; i++) {
        let graph = graphIds[i];
        let body = panelWindow.document.getElementsByTagName("body")[0];
        let div = panelWindow.document.createElement("div");
        div.innerText = graph;
        body.appendChild(div)
    }

}
