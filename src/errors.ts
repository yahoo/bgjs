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
    if (r?.debugName != null) {
        return r.debugName;
    }
    // resources are named when their extent is added, so look up the name of one that never was
    let ext: any = r?.extent;
    if (ext != null) {
        for (let key in ext) {
            if (ext[key] === r) {
                return key;
            }
        }
    }
    return "<unnamed resource>";
}

function extentName(ext: any): string {
    return ext?.debugName ?? ext?.constructor?.name ?? "extent";
}

function nameList(resources: Iterable<Resource> | null | undefined): string {
    return joinNames([...(resources ?? [])].map(resourceName));
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

function suppliesOf(b: Behavior): Iterable<Resource> | null {
    return b.supplies ?? [...(b.untrackedSupplies ?? []), ...(b.untrackedDynamicSupplies ?? [])];
}

// trace demands (state.trace) are listed as "name.trace"
function demandNamesOf(b: Behavior): string[] {
    if (b.demands != null) {
        return [...b.demands].map(resourceName).concat([...(b.traceDemands ?? [])].map(r => resourceName(r) + ".trace"));
    }
    return [...(b.untrackedDemands ?? []), ...(b.untrackedDynamicDemands ?? [])]
        .map(d => resourceName(d.resource) + (d.type == LinkType.trace ? ".trace" : ""));
}

/** "the behavior in Player that supplies [a, b] and demands [c, d]" */
export function describeBehavior(b: Behavior | null | undefined): string {
    if (b == null) {
        return "no behavior";
    }
    return `the behavior in ${extentName(b.extent)} that supplies [${nameList(suppliesOf(b))}] and demands [${joinNames(demandNamesOf(b))}]`;
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function isState(r: Resource): boolean {
    return "traceValue" in (r as any);
}

/**
 * `cycle` is the list of resources returned by `debugCycleForBehavior(start)`: start demands
 * cycle[0], cycle[0] is supplied by B2, B2 demands cycle[1], ..., the last is supplied by start.
 */
export function cycleMessage(start: Behavior, cycle: Resource[]): string {
    if (cycle.length == 0) {
        return `Behavior dependency cycle detected at ${describeBehavior(start)}.`;
    }
    if (cycle.length == 1) {
        let r = resourceName(cycle[0]);
        return `Behavior dependency cycle detected: the behavior in ${extentName(start.extent)} that supplies [${nameList(suppliesOf(start))}] also demands "${r}". ` +
            `A behavior can already read what it supplies, so remove "${r}" from its demands.`;
    }
    let behaviors: (Behavior | null)[] = [start];
    for (let i = 0; i < cycle.length - 1; i++) {
        behaviors.push(cycle[i].suppliedBy ?? null);
    }
    let label = (i: number) => `B${(i % cycle.length) + 1}`;
    let lines: string[] = [];
    lines.push(`Behavior dependency cycle detected: each behavior below demands a resource supplied by the next, so none can run first.`);
    cycle.forEach((r, i) => {
        let b = behaviors[i];
        let who = b != null ? `${extentName(b.extent)}, supplies [${nameList(suppliesOf(b))}]` : "unknown behavior";
        lines.push(`  ${label(i)} (${who}) demands "${resourceName(r)}", supplied by ${label(i + 1)}`);
    });
    lines.push(`Break one of these demands:`);
    let stateEdges = cycle.flatMap((r, i) => isState(r) ? [`${label(i)} could demand ${resourceName(r)}.trace and read ${resourceName(r)}.traceValue`] : []);
    if (stateEdges.length > 0) {
        lines.push(`  - Replace a state demand with its .trace and read .traceValue: ${stateEdges.join(", ")}. A .trace demand is not an edge, so it cannot form a cycle. .traceValue returns the value from before this event, and the behavior no longer runs when that state updates; check every case.`);
    }
    behaviors.forEach((b, i) => {
        let supplies = b?.supplies;
        if (supplies == null || supplies.size < 2) {
            return;
        }
        // b is on the loop because it supplies what the previous behavior demands, and it demands cycle[i]
        let onLoop = cycle[(i + cycle.length - 1) % cycle.length];
        let others = [...supplies].filter(s => s !== onLoop);
        lines.push(`  - ${label(i)} also supplies [${nameList(others)}], and every supply waits for all of its demands. If ${resourceName(onLoop)} does not need ${resourceName(cycle[i])}, supply it from a separate behavior.`);
    });
    lines.push(`  - Or move the logic that needs the downstream resource into a behavior that runs after the loop, or demand an earlier resource instead.`);
    return lines.join("\n");
}

export function accessMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let alt = isState(resource)
        ? ` If that would create a cycle, or it only needs the value from before this event, add ${r}.trace to its demands instead and read ${r}.traceValue.`
        : "";
    return `Cannot read "${r}" here: ${describeBehavior(current)} neither demands nor supplies it (reads in helper functions called from its runs block count too). ` +
        `Fix: add ${r} to its .demands(...); it will then also run when ${r} updates.${alt}`;
}

export function traceAccessMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    return `Cannot read "${r}.traceValue" here: ${describeBehavior(current)} neither demands nor supplies ${r} and does not declare ${r}.trace. ` +
        `${r}.traceValue is the value from before this event; it ignores every update to ${r} in this event. ` +
        `Fix: if that is the value this rule needs (for example to avoid a cycle), add ${r}.trace to its .demands(...); a .trace demand is not an edge, so it cannot form a cycle and does not run the behavior when ${r} updates. ` +
        `If it needs ${r} as updated in this event, demand ${r} and read ${r}.value.`;
}

export function updateOutsideMessage(resource: Resource): string {
    let r = resourceName(resource);
    return `Cannot update "${r}" here: updates must happen in a behavior's runs block or an action, and this one ran outside any event (e.g. in a timer or promise callback). ` +
        `Fix: wrap it in an action, e.g. extent.action(() => ${r}.update(...)).`;
}

export function wrongSupplierMessage(resource: Resource, current: Behavior | null): string {
    let r = resourceName(resource);
    let where = current != null ? describeBehavior(current) : "an action";
    return `Cannot update "${r}" from ${where}: only its supplier, ${describeBehavior(resource.suppliedBy)}, may update it. ` +
        `Fix: move the update into that behavior, or update a new moment here that the supplier demands. Do not add a second supplier.`;
}

export function unsuppliedInBehaviorMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    return `Cannot update "${r}" from ${describeBehavior(current)}: "${r}" has no supplier, so only actions may update it. ` +
        `Fix: add ${r} to this behavior's .supplies(...), or update it from an action (e.g. extent.action(() => ${r}.update(...)) in a side effect).`;
}

export function demandNotAddedMessage(resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let ext = extentName(resource.extent);
    return `${capitalize(describeBehavior(current))} demands "${r}", but ${ext}, which owns it, is not in the graph (never added, or removed). ` +
        `Fix: add ${ext} to the graph in the same event or earlier, or stop demanding ${r}.`;
}

export function removedDemandMessage(resource: Resource, remaining: Behavior): string {
    let r = resourceName(resource);
    return `An extent was removed but ${describeBehavior(remaining)} still demands its resource "${r}". ` +
        `Fix: make that behavior's dynamicDemands stop returning ${r} in the same event as the removal, or remove the behavior's extent too.`;
}

export function removedSupplyMessage(resource: Resource, remaining: Behavior): string {
    let r = resourceName(resource);
    return `An extent was removed but ${describeBehavior(remaining)} still supplies its resource "${r}". ` +
        `Fix: make that behavior's dynamicSupplies stop returning ${r} in the same event as the removal, or remove the behavior's extent too.`;
}

export function lifetimeMessage(kind: "demands" | "supplies", resource: Resource, current: Behavior): string {
    let r = resourceName(resource);
    let ext = extentName(resource.extent);
    let dynamic = kind == "demands" ? "dynamicDemands" : "dynamicSupplies";
    return `${capitalize(describeBehavior(current))} statically ${kind} "${r}" of ${ext}, which may leave the graph first. ` +
        `Static ${kind} must point at the behavior's own extent or one with the same or a longer lifetime. ` +
        `Fix: before adding this behavior's extent, call ${ext}.addChildLifetime(thisExtent) or ${ext}.unifyLifetime(thisExtent), or use ${dynamic} instead.`;
}
