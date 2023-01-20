import {State} from "behavior-graph"
import {useCallback, useSyncExternalStore} from "react"

export function useBGState<T>(stateObject: State<T>): T {
    let subscribeFunction = useCallback((callback: () => void) => {
        return stateObject.subscribeToJustUpdated(callback);
    }, []);
    return useSyncExternalStore(
        subscribeFunction,
        () => {
            return stateObject.value;
        });
}