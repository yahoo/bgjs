import './style.css'
import * as bg from 'behavior-graph'
import { AllCountersExtent } from "./AllCountersExtent";
import $ from "cash-dom";

let mainGraph = new bg.Graph();

let app = $("#app");

let allCounters = new AllCountersExtent(mainGraph);



allCounters.addToGraphWithAction();
