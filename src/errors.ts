//
//  Copyright Yahoo 2021
//

// Error text for agents and people reading a failure without a debugger. Behaviors have no
// names, so a behavior is described by its extent and the resources it supplies and demands.
// Every message names the resources involved and says what to change.

import type {Behavior} from "./behavior.js";
import {LinkType} from "./common.js";
import type {Demandable, Resource} from "./resource.js";

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

export function staleMomentMessage(resource: Resource, current: Behavior | null, lastSequence: number | null, currentSequence: number | null): string {
    let r = resourceName(resource);
    let now = currentSequence != null ? `this is event ${currentSequence}` : "this read is outside any event";
    let last = lastSequence != null
        ? `it last updated in event ${lastSequence}; ${now}`
        : `it has never updated; ${now}`;
    let where = current != null ? ` ${capitalize(describeBehavior(current))} is running in this event, but not because ${r} updated.` : "";
    let did = currentSequence != null ? "did not update in this event" : "is not updating now";
    return `Cannot read "${r}.value" here: ${r} ${did}, so it has no value (${last}). ` +
        `A moment's value lasts only for the event in which the moment updated.${where} ` +
        `Fix: check ${r}.justUpdated first and read ${r}.value only when it is true, e.g. if (${r}.justUpdated) { const v = ${r}.value; ... } ` +
        `or ${r}.justUpdated ? ${r}.value : fallback. If the value must outlast its event, copy it into a state while ${r}.justUpdated. ` +
        `(This check is graph.validateMomentReads.)`;
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

// Lifetime messages name both extents in prose ("Turn", "Sub") and use stand-in variable names
// in code ("turn.addChildLifetime(sub)"). Two extents of one class become "this X"/"the other X".
function lifetimeNames(behaviorExtent: any, resourceExtent: any) {
    let own = extentName(behaviorExtent);
    let other = extentName(resourceExtent);
    let variable = (name: string) => name.charAt(0).toLowerCase() + name.slice(1).replace(/\W/g, "");
    if (own == other) {
        return {own: `this ${own}`, other: `the other ${other}`, ownVar: `this${own.replace(/\W/g, "")}`, otherVar: `other${other.replace(/\W/g, "")}`};
    }
    return {own, other, ownVar: variable(own), otherVar: variable(other)};
}

export function lifetimeMessage(kind: "demands" | "supplies", resource: Resource, current: Behavior, targetIsChild: boolean): string {
    let r = resourceName(resource);
    let {own, other, ownVar, otherVar} = lifetimeNames(current.extent, resource.extent);
    let dynamic = kind == "demands" ? "dynamicDemands" : "dynamicSupplies";
    let head = `${capitalize(describeBehavior(current))} statically ${kind} "${r}" of ${other}. `;
    if (targetIsChild) {
        return head +
            `${capitalize(other)} is a child lifetime of ${own} (addChildLifetime), so it can leave the graph first, and a static link cannot follow it out. ` +
            `Fix: a parent reaches a child's resources only through .${dynamic}(switches, links): switch on the state that holds the children and return ${otherVar}.${r} from links, so the link drops when the child is removed.`;
    }
    return head +
        `A static link must point at the behavior's own extent or one with the same or a longer lifetime, and ${other} has no such relation to ${own}. ` +
        `Fix: before ${own} is added to the graph, call ${otherVar}.addChildLifetime(${ownVar}) (${own} lives inside ${other}) or ${otherVar}.unifyLifetime(${ownVar}) (both are added and removed together). ` +
        `If ${other} should instead be ${own}'s child, call ${ownVar}.addChildLifetime(${otherVar}) and link it with .${dynamic}(switches, links), not statically.`;
}

export function traceOnlyMessage(extent: any, demands: Demandable[], supplies: Resource[]): string {
    let names = joinNames(demands.map(d => resourceName(d.resource) + ".trace"));
    return `The behavior in ${extentName(extent)} that supplies [${nameList(supplies)}] and demands [${names}] can never run: every demand is a .trace link, and a .trace demand never runs the behavior. ` +
        `Fix: demand without .trace at least one resource whose update should run it (the states a derived value is computed from, or the moment that triggers the rule); keep .trace only for values from before this event.`;
}

export function repeatedDynamicMessage(kind: "dynamicDemands" | "dynamicSupplies", extent: any): string {
    return `.${kind}(...) was called twice while building one behavior in ${extentName(extent)}; the second call would replace the first. ` +
        `Fix: make one .${kind}(switches, links) call with every switch, and return all the links from one links function.`;
}

export function shadowedMemberMessage(extent: any, name: string, isMethod: boolean): string {
    let use = isMethod ? `this.${name}(...)` : `this.${name}`;
    return `${extentName(extent)} has a field named "${name}", which hides Extent's own ${isMethod ? "method" : "field"} "${name}", so ${use} no longer works on it. ` +
        `Fix: rename the field (for example to ${name == "state" ? `"phase", "status" or ` : ""}"${name}Value").`;
}

export function cleanupKeyOwnerMessage(key: string, extent: any, owner: Behavior | null, current: Behavior | null): string {
    let who = (b: Behavior | null) => b == null ? "a side effect queued from an action" : describeBehavior(b);
    return `Cleanup key "${key}" on ${extentName(extent)} belongs to ${who(owner)}, and ${who(current)} `
        + `registered it too. A key holds one cleanup, so the second registration would run the first one's `
        + `cleanup and cancel its work. Fix: give this onRemove a different key, or start both pieces of work `
        + `from one behavior. To stop the work early from elsewhere, call onRemove.run("${key}") instead.`;
}
