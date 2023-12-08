import {ListExtent} from "./ListExtent.js";

export class ListView {

    constructor(listExtent) {

        // connect to elements in the DOM
        this.infoFooter = document.querySelector("#templates .info").cloneNode(true);
        this.app = document.querySelector("#templates .todoapp").cloneNode(true);
        this.header = this.app.querySelector(".header");
        this.main = this.app.querySelector(".main");
        this.footer = this.app.querySelector(".footer");
        this.input = this.header.querySelector(".new-todo");
        this.list = this.main.querySelector(".todo-list");
        this.todoCount = this.footer.querySelector(".todo-count");
        this.filters = this.footer.querySelector(".filters");
        this.allCompletedCheckbox = this.main.querySelector(".toggle-all");
        this.clearAllCompleted = this.footer.querySelector(".clear-completed");

        // feature: add new item on Enter
        this.input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                listExtent.addNewItem.updateWithAction(this.input.value);
            }
        });

        this.allCompletedCheckbox.addEventListener("change", (event) => {
            listExtent.markAllCompleted.updateWithAction(this.allCompletedCheckbox.checked);
        });

        this.clearAllCompleted.addEventListener("click", (event) => {
            listExtent.clearAllCompleted.updateWithAction();
        });

        listExtent.subscribeToJustUpdated([listExtent.addedToGraph], () => {
            document.body.append(this.app);
            document.body.append(this.infoFooter);
        });

        // feature: empty list (and footer) are hidden
        listExtent.subscribeToJustUpdated([listExtent.allItems, listExtent.addedToGraph], () => {
            if (listExtent.allItems.value.length === 0) {
                this.main.style.display = "none";
                this.footer.style.display = "none";
            } else {
                this.main.style.display = "block";
                this.footer.style.display = "block";
            }
        });

        // when new item is created, add its element to the list element
        listExtent.subscribeToJustUpdated([listExtent.itemsCreated], () => {
            for (let itemExtent of listExtent.itemsCreated.value) {
                this.list.appendChild(itemExtent.itemView.itemElement);
            }
            // feature: clear input after creating a new item
            this.input.value = "";
        });

        listExtent.subscribeToJustUpdated([listExtent.itemsRemoved], () => {
            for (let item of listExtent.itemsRemoved.value) {
                this.list.removeChild(item.itemView.itemElement);
            }
        });

        listExtent.subscribeToJustUpdated([listExtent.allCompleted], () => {
            this.allCompletedCheckbox.checked = listExtent.allCompleted.value;
        });

        listExtent.subscribeToJustUpdated([listExtent.anyCompleted, listExtent.addedToGraph], () => {
            if (listExtent.anyCompleted.value) {
                this.clearAllCompleted.style.display = "block";
            } else {
                this.clearAllCompleted.style.display = "none";
            }
        });

        listExtent.subscribeToJustUpdated([listExtent.remainingCount, listExtent.addedToGraph], () => {
            if (listExtent.remainingCount.value === 1) {
                this.todoCount.innerHTML = "<strong>1</strong> item left";
            } else {
                this.todoCount.innerHTML = "<strong>" + listExtent.remainingCount.value + "</strong> items left";
            }
        });

        listExtent.subscribeToJustUpdated([listExtent.viewState, listExtent.addedToGraph], () => {
            for (let filter of this.filters.querySelectorAll("a")) {
                if (listExtent.hashToViewState(filter.getAttribute("href")) === listExtent.viewState.value) {
                    filter.classList.add("selected");
                } else {
                    filter.classList.remove("selected");
                }
            }
        });
    }
}