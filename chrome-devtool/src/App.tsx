import { Counter } from "./Counter";
import { AllCountersExtent } from "./AllCountersExtent"
import { MainCounter } from "./MainCounter";
import { useBGState } from "react-behavior-graph";

type AppProps = {
    allCounters: AllCountersExtent;
};

export function App({ allCounters }: AppProps) {
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
