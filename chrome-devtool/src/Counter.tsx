import { useBGState } from "react-behavior-graph";
import { CounterExtent } from "./CounterExtent";

type CounterProps = {
    counterExtent: CounterExtent;
};

export function Counter({counterExtent}: CounterProps) {
    console.log("rendering Counter " + counterExtent.id);
    let count = useBGState(counterExtent.count);

    return (
        <li>
            <h3>Count: {count}</h3>
            <button onClick={() => counterExtent.increment.updateWithAction()}>Increment</button>
            <button onClick={() => counterExtent.remove.updateWithAction()}>Remove</button>
        </li>
    );
}
