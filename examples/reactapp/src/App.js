import { Counter } from "./Counter";
import { MainCounter } from "./MainCounter";
import { useBGState } from "react-behavior-graph";

export function App({allCounters}) {
    console.log("rendering App");
    let counters = useBGState(allCounters.counters);

    return (
        <div>
            <MainCounter allCountersExtent={allCounters} />
            <button onClick={() => allCounters.resetCounters.updateWithAction()}>Reset All</button>
            <button onClick={() => allCounters.addCounter.updateWithAction()}>Add Counter</button>
            <ul>
                {counters.map((counterExtent) =>
                    <Counter counterExtent={counterExtent} key={counterExtent.id} />
                )}
            </ul>
        </div>);
}
