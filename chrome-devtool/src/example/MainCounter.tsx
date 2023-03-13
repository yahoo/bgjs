import { useBGState } from "react-behavior-graph";
import "./AllCountersExtent"
import {AllCountersExtent} from "./AllCountersExtent";

type MainCounterProps = {
    allCountersExtent: AllCountersExtent;
};

export function MainCounter({allCountersExtent}: MainCounterProps) {
    console.log("rendering Main Counter");
    let total = useBGState(allCountersExtent.total);

    return (
        <div><h1>Counter Total: {total}</h1></div>
    );
}
