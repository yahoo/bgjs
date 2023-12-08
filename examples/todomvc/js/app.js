import * as bg from "behavior-graph";
import {ListExtent} from "./ListExtent.js";

let graph = new bg.Graph();

let initialItems = [];
let json = localStorage.getItem(ListExtent.LocalStorageName);
if (json) {
    initialItems = JSON.parse(json);
}

let list = new ListExtent(graph, document.location.hash);
graph.action(() => {
    list.addToGraph();
    list.loadedFromLocalStorage.update(initialItems);
});

window.addEventListener("hashchange", () => {
    list.viewState.updateWithAction(list.hashToViewState(document.location.hash));
});