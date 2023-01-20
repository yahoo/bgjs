import { Counter } from "./Counter"
import { useBGState } from "react-behavior-graph";

export function App({allCounters}) {
    console.log("rendering App");
    let total = useBGState(allCounters.total);
    let counters = useBGState(allCounters.counters);


    return (
        <div>
            <div><h1>Counter Total: {total}</h1></div>
            <button onClick={() => allCounters.resetCounters.updateWithAction()}>Reset All</button>
            <button onClick={() => allCounters.addCounter.updateWithAction()}>Add Counter</button>
            <ul>
                {counters.map((counterExtent) =>
                    <Counter counterExtent={counterExtent} key={counterExtent.id} />
                )}
            </ul>
        </div>);
}
