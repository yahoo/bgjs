import * as bg from "behavior-graph";
import {ItemView} from "./ItemView.js";
import {ListExtent} from "./ListExtent.js";

export class ItemExtent extends bg.Extent {
     constructor(graph, initialText, initialCompleted, list) {
         super(graph);
         this.list = list;

         this.itemText = this.state(initialText);
         this.markCompleted = this.signal();
         this.completed = this.state(initialCompleted);
         this.destroyItemClicked = this.signal();
         this.removeItem = this.signal();
         this.editing = this.state(false);
         this.requestEdit = this.signal();
         this.completeEdit = this.signal();
         this.visible = this.state(true);

         this.itemView = new ItemView(this);

         this.behavior()
             .supplies(this.completed)
             .dependsOn(this.markCompleted, list.markAllCompleted)
             .runs(() => {
                    if (this.markCompleted.justUpdated) {
                        this.completed.update(this.markCompleted.value);
                    } else if (list.markAllCompleted.justUpdated) {
                        this.completed.update(list.markAllCompleted.value);
                    }
             });

         this.behavior()
             .supplies(this.editing)
             .dependsOn(this.completeEdit, this.requestEdit)
             .runs(() => {
                 if (this.requestEdit.justUpdated) {
                     this.editing.update(true);
                 } else if (this.completeEdit.justUpdated) {
                     this.editing.update(false);
                 }
             });

         this.behavior()
             .supplies(this.itemText)
             .dependsOn(this.completeEdit)
                .runs(() => {
                    let newText = this.completeEdit.value.trim();
                    if (newText.length > 0) {
                        this.itemText.update(newText);
                    }
                });

         this.behavior()
             .supplies(this.removeItem)
             .dependsOn(this.destroyItemClicked, list.clearAllCompleted, this.completed.order)
             .runs(() => {
                 if (this.destroyItemClicked.justUpdated) {
                     this.removeItem.update();
                 } else if (list.clearAllCompleted.justUpdated) {
                     if (this.completed.value) {
                         this.removeItem.update();
                     }
                 }
             });

         this.behavior()
             .supplies(this.visible)
             .dependsOn(this.completed, this.list.viewState, this.addedToGraph)
             .runs(() => {
                 if (this.completed.value && this.list.viewState.value === ListExtent.ViewStateActive) {
                     this.visible.update(false);
                 } else if (!this.completed.value && this.list.viewState.value === ListExtent.ViewStateCompleted) {
                     this.visible.update(false);
                 } else {
                     this.visible.update(true);
                 }
             });
    }
}
