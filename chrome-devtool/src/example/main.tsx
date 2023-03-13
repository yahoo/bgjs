import React from 'react'
import { createRoot } from "react-dom/client";
import { App } from "./App";
import * as bg from "lib/mjs";
import { AllCountersExtent } from "./AllCountersExtent";

let g = new bg.Graph();
let allCounters = new AllCountersExtent(g);
allCounters.addToGraphWithAction();
const container = document.getElementById("app");
const root = createRoot(container!)
root.render(
    <React.StrictMode>
        <App allCounters={allCounters} />
    </React.StrictMode>
);