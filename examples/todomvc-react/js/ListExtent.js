import * as bg from "behavior-graph";
//import {ListView} from "./ListView.js";
import {ItemExtent} from "./ItemExtent.js";

export class ListExtent extends bg.Extent {
    static ViewStateAll = "all";
    static ViewStateActive = "active";
    static ViewStateCompleted = "completed";
    static LocalStorageName = "todos-bgreact";

    constructor(graph, hash) {
        super(graph);

        this.allItems = this.state([]);
        this.addNewItem = this.moment();
        this.itemsCreated = this.moment();
        this.itemsRemoved = this.moment();
        this.markAllCompleted = this.moment();
        this.allCompleted = this.state(false);
        this.clearAllCompleted = this.moment();
        this.remainingCount = this.state(0);
        this.anyCompleted = this.state(false);
        this.viewState = this.state(this.hashToViewState(hash));
        this.loadedFromLocalStorage = this.moment();
        this.nextKey = this.state(0);

        //this.listView = new ListView(this);

        this.behavior()
            .supplies(this.allItems, this.itemsCreated, this.itemsRemoved, this.nextKey)
            .demands(this.addNewItem, this.addedToGraph, this.loadedFromLocalStorage)
            .dynamicDemands([this.allItems], () => {
                return this.allItems.value.map(item => item.removeItem);
            }, bg.RelinkingOrder.relinkingOrderSubsequent)
            .runs(() => {
                if (this.addNewItem.justUpdated) {
                    // feature: trim whitespace
                    let newText = this.addNewItem.value.trim()
                    // feature: don't add empty items
                    if (newText.length === 0) {
                        return;
                    }
                    let item = new ItemExtent(this.graph, this.nextKey.value, newText, false, this);
                    this.addChildLifetime(item);
                    item.addToGraph();
                    this.allItems.value.push(item);
                    this.allItems.update([...this.allItems.value]);
                    this.itemsCreated.update([item]);
                    this.nextKey.update(this.nextKey.value + 1);
                } else if (this.loadedFromLocalStorage.justUpdated) {
                    let newItems = [];
                    let nextKey = this.nextKey.value
                    for (let pojoItem of this.loadedFromLocalStorage.value) {
                        if (pojoItem.key !== undefined) {
                            nextKey = Math.max(nextKey, pojoItem.key + 1);
                        }
                    }
                    for (let pojoItem of this.loadedFromLocalStorage.value) {
                        let item = new ItemExtent(this.graph, pojoItem.key || nextKey++, pojoItem.text, pojoItem.completed, this);
                        this.addChildLifetime(item);
                        item.addToGraph();
                        this.allItems.value.push(item);
                        newItems.push(item);
                    }
                    this.allItems.updateForce(this.allItems.value);
                    this.itemsCreated.update(newItems);
                    this.nextKey.update(nextKey);
                } else {
                    let newAllItems = [];
                    let newRemoved = [];
                    let removed = false;
                    for (let item of this.allItems.value) {
                        if (item.removeItem.justUpdated) {
                            removed = true;
                            item.removeFromGraph()
                            newRemoved.push(item);
                        } else {
                            newAllItems.push(item);
                        }
                    }
                    if (removed) {
                        this.allItems.update(newAllItems);
                        this.itemsRemoved.update(newRemoved);
                    }
                }
            });

        this.behavior()
            .supplies(this.allCompleted, this.remainingCount, this.anyCompleted)
            .demands(this.allItems)
            .dynamicDemands([this.allItems], () => {
                return this.allItems.value.map(item => item.completed);
            })
            .runs(() => {
                let allCompleted = true;
                let anyCompleted = false;
                let remainingCount = 0;
                for (let item of this.allItems.value) {
                    if (item.completed.value) {
                        anyCompleted = true;
                    } else {
                        allCompleted = false;
                        remainingCount++;
                    }
                }
                this.allCompleted.update(allCompleted);
                this.anyCompleted.update(anyCompleted);
                this.remainingCount.update(remainingCount);
            });

        this.behavior()
            .demands(this.allItems)
            .dynamicDemands([this.allItems], () => {
                return this.allItems.value.flatMap(item => [item.completed, item.itemText]);
            })
            .runs(() => {
                this.sideEffect(() => {
                    let output = [];
                    for (let item of this.allItems.value) {
                        let itemPojo = {
                            key: item.key,
                            text: item.itemText.value,
                            completed: item.completed.value
                        };
                        output.push(itemPojo);
                    }
                    let json = JSON.stringify(output);
                    localStorage.setItem(ListExtent.LocalStorageName, json);
                });
            });

    }

    hashToViewState(hash) {
        if (hash === "#/active") {
            return ListExtent.ViewStateActive;
        } else if (hash === "#/completed") {
            return ListExtent.ViewStateCompleted;
        } else {
            return ListExtent.ViewStateAll;
        }
    }

}
