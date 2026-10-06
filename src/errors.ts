//
//  Copyright Yahoo 2021
//

// Error text for agents and people reading a failure without a debugger. Behaviors have no
// names, so a behavior is described by its extent and the resources it supplies and demands.
// Every message names the resources involved and says what to change.

import type {Behavior} from "./behavior.js";
import {LinkType} from "./common.js";
import type {Resource} from "./resource.js";

const LIST_LIMIT = 8;

export function resourceName(r: Resource | null | undefined): string {
    return r?.debugName ?? "<unnamed resource>";
}

function extentName(b: Behavior): string {
    let ext: any = b.extent;
    return ext?.debugName ?? ext?.constructor?.name ?? "extent";
}

function nameList(resources: Iterable<Resource> | null | undefined, except?: Resource): string {
    let names: string[] = [];
    if (resources != null) {
        for (let r of resources) {
            if (r !== except) {
                names.push(resourceName(r));
            }
        }
    }
    if (names.length == 0) {
        return "nothing";
    }
    if (names.length > LIST_LIMIT) {
        return names.slice(0, LIST_LIMIT).join(", ") + `, +${names.length - LIST_LIMIT} more`;
    }
    return names.join(", ");
}

function suppliesOf(b: Behavior): Iterable<Resource> | null {
    return b.supplies ?? [...(b.untrackedSupplies ?? []), ...(b.untrackedDynamicSupplies ?? [])];
}

// Trace links (resource.trace) are listed as "name.trace".
function demandNamesOf(b: Behavior): string[] {
    let names: string[] = [];
    if (b.demands != null) {
        for (let r of b.demands) {
            names.push(resourceName(r));
        }
        for (let r of b.traceDemands ?? []) {
            names.push(resourceName(r) + ".trace");
        }
        return names;
    }
    for (let d of [...(b.untrackedDemands ?? []), ...(b.untrackedDynamicDemands ?? [])]) {
        names.push(resourceName(d.resource) + (d.type == LinkType.trace ? ".trace" : ""));
    }
    return names;
}

function joinNames(names: string[]): string {
    if (names.length == 0) {
        return "nothing";
    }
    if (names.length > LIST_LIMIT) {
        return names.slice(0, LIST_LIMIT).join(", ") + `, +${names.length - LIST_LIMIT} more`;
    }
    return names.join(", ");
}

/** "the behavior in extent Player that supplies a, b and demands c, d" */
export function describeBehavior(b: Behavior | null | undefined): string {
    if (b == null) {
        return "no behavior";
    }
    return `the behavior in ${extentName(b)} that supplies [${nameList(suppliesOf(b))}] and demands [${joinNames(demandNamesOf(b))}]`;
}

function isState(r: Resource): boolean {
    return "traceValue" in (r as any);
}

/**
 * `cycle` is the list of resources returned by `debugCycleForBehavior(start)`: start demands
 * cycle[0], cycle[0] is supplied by B1, B1 demands cycle[1], ..., the last is supplied by start.
 */
export function cycleMessage(start: Behavior, cycle: Resource[]): string {
    if (cycle.length == 0) {
        return `Behavior dependency cycle detected at ${describeBehavior(start)}.`;
    }
    let behaviors: Behavior[] = [start];
    for (let i = 0; i < cycle.length - 1; i++) {
        let next = cycle[i].suppliedBy;
        if (next == null) {
            break;
        }
        behaviors.push(next);
    }
    let lines: string[] = [];
    lines.push(`Behavior dependency cycle detected: ${behaviors.length} behavior${behaviors.length == 1 ? "" : "s"} each demand a resource supplied by the next, so none can run first.`);
    for (let i = 0; i < cycle.length; i++) {
        let b = behaviors[i] ?? null;
        let r = cycle[i];
        let supplier = i + 1 < behaviors.length ? `B${i + 2}` : "B1, closing the loop";
        lines.push(`  B${i + 1}: ${describeBehavior(b)}`);
        lines.push(`      demands "${resourceName(r)}", which is supplied by ${supplier}`);
    }
    if (cycle.length == 1) {
        lines.push(`A behavior can already read what it supplies, so remove "${resourceName(cycle[0])}" from its demands.`);
        return lines.join("\n");
    }
    let edges = cycle.map((r, i) => `B${i + 1} -> ${resourceName(r)}`).join(", ");
    lines.push(`The demand edges on the loop are: ${edges}. Remove one of them:`);
    let stateEdges = cycle.map((r, i) => isState(r) ? `B${i + 1} demands ${resourceName(r)}.trace and reads ${resourceName(r)}.traceValue` : null).filter(e => e != null);
    if (stateEdges.length > 0) {
        lines.push(`  (1) If a behavior only needs a state's value from before this event, replace that state in its demands with its .trace and read .traceValue (on this loop: ${stateEdges.join("; ")}). A .trace demand is not an edge, so it cannot form a cycle. Check every case: .traceValue ignores this event's update, and the behavior no longer runs when that state changes.`);
    } else {
        lines.push(`  (1) Every resource on the loop is a moment, so .traceValue does not apply; use (2) or (3).`);
    }
    let multi = behaviors.filter(b => (b.supplies?.size ?? 0) > 1);
    if (multi.length > 0) {
        let idx = multi.map(b => `B${behaviors.indexOf(b) + 1}`).join(", ");
        lines.push(`  (2) ${idx} ${multi.length == 1 ? "supplies" : "each supply"} more than one resource. Every resource a behavior supplies runs after all of its demands, so a resource that does not need one of those demands still inherits it. If the supplies on the loop do not need the same demands, split them into separate behaviors.`);
    } else {
        lines.push(`  (2) If a behavior on the loop supplies several resources, split the ones that do not need its demand on the loop into their own behavior.`);
    }
    lines.push(`  (3) Otherwise move the rule that needs the downstream resource into a behavior that runs after the whole loop, or have the upstream behavior read an earlier resource (an accepted input or seam) instead of a later decision.`);
    return lines.join("\n");
}

export function accessMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let supplier = resource.suppliedBy != null ? describeBehavior(resource.suppliedBy) : "no behavior (it is an input, updated in actions)";
    let alt = isState(resource)
        ? ` If adding the demand would create a cycle, or the behavior only needs the value from before this event, add ${r}.trace to its demands instead and read ${r}.traceValue.`
        : "";
    return `Cannot read "${r}" here: ${describeBehavior(current)} neither demands nor supplies it. ` +
        `Reads in helper functions called from a behavior's runs block count as that behavior's reads. ` +
        `Fix: add ${r} to this behavior's .demands(...). It will then also run when ${r} updates, and after ${r}'s supplier, ${supplier}.${alt}`;
}

export function traceAccessMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let supplier = resource.suppliedBy != null ? `its supplier, ${describeBehavior(resource.suppliedBy)}` : "an action (it is an input)";
    return `Cannot read "${r}.traceValue" here: ${describeBehavior(current)} neither demands nor supplies ${r} and does not declare ${r}.trace. ` +
        `A behavior that reads a state's previous value without demanding the state must say so, so the read is visible in its demands. ` +
        `${r}.traceValue is the value from before this event: it ignores every update to ${r} in this event, including one made later in the event by ${supplier}. ` +
        `Fix: if this rule needs the value from before this event (for example to avoid a cycle), add ${r}.trace to this behavior's .demands(...); ` +
        `a .trace demand is not an edge, so it cannot form a cycle, and the behavior will not run when ${r} updates. ` +
        `If the rule needs ${r} as updated in this event, add ${r} to .demands(...) and read ${r}.value.`;
}

export function updateOutsideMessage(resource: Resource): string {
    let r = resourceName(resource);
    return `Cannot update "${r}" here: resources can only be updated inside a behavior's runs block or an action. ` +
        `This update ran outside any event (for example in a timer, a promise callback, or a side effect after it finished). ` +
        `Fix: wrap it in an action, e.g. extent.action(() => ${r}.update(...)).`;
}

export function wrongSupplierMessage(resource: Resource, current: Behavior | null): string {
    let r = resourceName(resource);
    let where = current != null ? describeBehavior(current) : "an action";
    return `Cannot update "${r}" from ${where}: "${r}" is supplied by ${describeBehavior(resource.suppliedBy)}, and only its supplier may update it. ` +
        `Fix: move this update into that behavior, or update a new moment here that the supplier demands and let the supplier update ${r}. ` +
        `Do not add a second supplier.`;
}

export function unsuppliedInBehaviorMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    return `Cannot update "${r}" from ${describeBehavior(current)}: "${r}" has no supplier, so it is an input that only actions may update. ` +
        `Fix: add ${r} to this behavior's .supplies(...) if this behavior owns it, or update it from an action (e.g. in a side effect: extent.action(() => ${r}.update(...))).`;
}

export function demandNotAddedMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let ext: any = resource.extent;
    let extName = ext?.debugName ?? ext?.constructor?.name ?? "its extent";
    return `${describeBehavior(current)} demands "${r}", but ${extName}, which owns "${r}", has not been added to the graph (or was removed). ` +
        `Fix: add ${extName} to the graph in the same event or earlier, or stop demanding ${r} (for a removed extent, drop it from dynamicDemands before removal).`;
}

export function removedDemandMessage(resource: Resource, remaining: Behavior): string {
    let r = resourceName(resource);
    return `An extent was removed but ${describeBehavior(remaining)} still demands its resource "${r}". ` +
        `Fix: make that behavior's dynamicDemands stop returning ${r} in the same event as the removal (its switches must update then), or remove the behavior's extent too.`;
}

export function removedSupplyMessage(resource: Resource, remaining: Behavior): string {
    let r = resourceName(resource);
    return `An extent was removed but ${describeBehavior(remaining)} still supplies its resource "${r}". ` +
        `Fix: make that behavior's dynamicSupplies stop returning ${r} in the same event as the removal, or remove the behavior's extent too.`;
}

export function lifetimeMessage(kind: "demands" | "supplies", resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let ext: any = resource.extent;
    let extName = ext?.debugName ?? ext?.constructor?.name ?? "its extent";
    let verb = kind == "demands" ? "demands" : "supplies";
    return `${describeBehavior(current)} statically ${verb} "${r}" of ${extName}, which may leave the graph before this behavior's extent. ` +
        `Static ${kind} may only point at the behavior's own extent or one with the same or a longer lifetime. ` +
        `Fix: declare the lifetime (e.g. ${extName}.addChildLifetime(thisExtent) or sameLifetime), or use dynamic${kind == "demands" ? "Demands" : "Supplies"} so the link is dropped when ${extName} is removed.`;
}
