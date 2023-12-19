import {useBGState} from 'react-behavior-graph';
import {useCallback, useEffect, useRef} from "react";

function TodoItem({itemExtent, listExtent}) {
    let text = useBGState(itemExtent.itemText);
    let completed = useBGState(itemExtent.completed);
    let editing = useBGState(itemExtent.editing);
    let visible = useBGState(itemExtent.visible);
    let editingText = useBGState(itemExtent.editingText);

    let inputRef = useRef(null);
    useEffect(() => {
        if (editing) {
            inputRef.current.focus();
        }
    }, [editing]);

    let handleCompletedCheckChange = (event) => {
        itemExtent.markCompleted.updateWithAction(event.target.checked);
    }

    let handleItemDoubleClick = () => {
        itemExtent.requestEdit.updateWithAction(true);
    }

    let handleDestroyItemClicked = () => {
        itemExtent.destroyItemClicked.updateWithAction(itemExtent);
    }

    let handleInputEnter = (event) => {
        if (event.key === 'Enter') {
            itemExtent.completeEdit.updateWithAction(event.target.value);
        }
    }

    let handleInputBlur = (event) => {
        itemExtent.completeEdit.updateWithAction(event.target.value);
    }

    let handleInputChange = (event) => {
        itemExtent.updateEditingText.updateWithAction(event.target.value);
    }

    return (
        <li className={["todo-item", completed ? "completed" : "", editing ? "editing" : ""].join(" ")}
            style={{display: visible ? "block" : "none"}}>
            <div className="view">
                <input className="toggle" type="checkbox" onChange={handleCompletedCheckChange}
                       checked={completed ? "checked" : ""}/>
                <label onDoubleClick={handleItemDoubleClick}>{text}</label>
                <button className="destroy" onClick={handleDestroyItemClicked}></button>
            </div>
            <input ref={inputRef} className="edit" onKeyDown={handleInputEnter}
                   onBlur={handleInputBlur} onChange={handleInputChange} value={editingText} />
        </li>
    );

}

export default TodoItem;