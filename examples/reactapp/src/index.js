import { createRoot } from "react-dom/client";
import { App } from "./App";
import * as bg from "behavior-graph";
import { AllCountersExtent } from "./AllCountersExtent";

let g = new bg.Graph();
let allCounters = new AllCountersExtent(g);
allCounters.addToGraphWithAction();
const container = document.getElementById("app");
const root = createRoot(container)
root.render(<App allCounters={allCounters} />);