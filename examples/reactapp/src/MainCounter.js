import { useBGState } from "react-behavior-graph";

export function MainCounter({allCountersExtent}) {
    console.log("rendering Main Counter");
    let total = useBGState(allCountersExtent.total);

    return (
        <div><h1>Counter Total: {total}</h1></div>
    );
}
