export class ItemView {

    constructor(itemExtent) {

        this.itemElement = document.querySelector('#templates .todo-item').cloneNode(true);
        this.label = this.itemElement.querySelector('label');
        this.completedCheckbox = this.itemElement.querySelector('.toggle');
        this.destroyButton = this.itemElement.querySelector('.destroy');
        this.editInput = this.itemElement.querySelector('.edit');

        this.completedCheckbox.addEventListener("change", () => {
            itemExtent.markCompleted.updateWithAction(this.completedCheckbox.checked);
        });

        this.destroyButton.addEventListener("click", () => {
            itemExtent.destroyItemClicked.updateWithAction(itemExtent);
        });

        this.label.addEventListener("dblclick", () => {
            itemExtent.requestEdit.updateWithAction(true);
        });

        this.editInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                itemExtent.completeEdit.updateWithAction(this.editInput.value);
            }
        });

        this.editInput.addEventListener("blur", () => {
            itemExtent.completeEdit.updateWithAction(this.editInput.value);
        });

        itemExtent.subscribeToJustUpdated([itemExtent.itemText, itemExtent.addedToGraph], () => {
            this.label.innerText = itemExtent.itemText.value;
        });

        itemExtent.subscribeToJustUpdated([itemExtent.completed, itemExtent.addedToGraph], () => {
            this.completedCheckbox.checked = itemExtent.completed.value;
            if (itemExtent.completed.value) {
                this.itemElement.classList.add("completed");
            } else {
                this.itemElement.classList.remove("completed");
            }
        });

        itemExtent.subscribeToJustUpdated([itemExtent.editing], () => {
            if (itemExtent.editing.value) {
                this.itemElement.classList.add("editing");
                this.editInput.value = itemExtent.itemText.value;
                this.editInput.focus();
            } else {
                this.itemElement.classList.remove("editing");
            }
        });

        itemExtent.subscribeToJustUpdated([itemExtent.visible], () => {
            if (itemExtent.visible.value) {
                this.itemElement.style.display = "block";
            } else {
                this.itemElement.style.display = "none";
            }
        });
    }
}