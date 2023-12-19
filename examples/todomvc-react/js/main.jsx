import React from 'react'
import ReactDOM from 'react-dom/client'
import TodoApp from './TodoApp.jsx'
import {Graph} from 'behavior-graph'
import {ListExtent} from "./ListExtent.js";
import Footer from "./Footer.jsx";

let initialItems = [];
let json = localStorage.getItem(ListExtent.LocalStorageName);
if (json) {
    initialItems = JSON.parse(json);
}

const graph = new Graph();
const list = new ListExtent(graph);
graph.action(() => {
    list.addToGraph();
    list.loadedFromLocalStorage.update(initialItems);
});

window.addEventListener("hashchange", () => {
    list.viewState.updateWithAction(list.hashToViewState(document.location.hash));
});

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <TodoApp listExtent={list}/>
        <Footer/>
    </React.StrictMode>,
)
