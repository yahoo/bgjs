import {useBGState} from 'react-behavior-graph'
import TodoItem from "./TodoItem.jsx";
import {ListExtent} from "./ListExtent.js";

function TodoApp({listExtent}) {

    let allItems = useBGState(listExtent.allItems);
    let allCompleted = useBGState(listExtent.allCompleted);
    let anyCompleted = useBGState(listExtent.anyCompleted);
    let remainingCount = useBGState(listExtent.remainingCount);
    let viewState = useBGState(listExtent.viewState);
    let showItems = allItems.length !== 0;

    let handleInputEnter = (event) => {
        if (event.key === 'Enter') {
            listExtent.addNewItem.updateWithAction(event.target.value);
            event.target.value = "";
        }
    }

    let handleCheckAllChange = (event) => {
        listExtent.markAllCompleted.updateWithAction(event.target.checked);
    }

    let handleClearAllCompleted = () => {
        listExtent.clearAllCompleted.updateWithAction();
    }

    return (
        <section className="todoapp">
            <header className="header">
                <h1>todos</h1>
                <input className="new-todo" placeholder="What needs to be done?" autoFocus
                       onKeyDown={handleInputEnter}/>
            </header>
            <section className="main" style={{display: showItems ? "block" : "none"}}>
                <input id="toggle-all" className="toggle-all" type="checkbox" onChange={handleCheckAllChange}
                       checked={allCompleted ? "checked" : ""}/>
                <label htmlFor="toggle-all">Mark all as complete</label>
                <ul className="todo-list">
                    {allItems.map((itemExtent) => {
                        return <TodoItem itemExtent={itemExtent} listExtent={listExtent} key={itemExtent.key}/>
                    })}
                </ul>
            </section>
            <footer className="footer" style={{display: showItems ? "block" : "none"}}>
                <span className="todo-count">
                    {remainingCount === 1 ? (
                        <span><strong>1</strong> item left</span>
                    ) : (
                        <span><strong>{remainingCount}</strong> items left</span>
                    )}
                </span>
                <ul className="filters">
                    <li>
                        <a className={viewState === ListExtent.ViewStateAll ? "selected" : ""} href="#/">All</a>
                    </li>
                    <li>
                        <a className={viewState === ListExtent.ViewStateActive ? "selected" : ""}
                           href="#/active">Active</a>
                    </li>
                    <li>
                        <a className={viewState === ListExtent.ViewStateCompleted ? "selected" : ""}
                           href="#/completed">Completed</a>
                    </li>
                </ul>
                <button className="clear-completed" onClick={handleClearAllCompleted}
                        style={{display: anyCompleted ? "block" : "none"}}>Clear completed
                </button>
            </footer>
        </section>
    )
}

export default TodoApp
