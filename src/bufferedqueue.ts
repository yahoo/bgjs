//
//  Copyright Yahoo 2021
//
//  Derived from tinyqueue, Copyright 2017 Vladamir Agafonkin, ISC License, https://github.com/mourner/tinyqueue
//

export interface Orderable {
    order: number;
    /** Rank used instead of `order` when the queue is reversed. */
    priority?: number;
    /** Breaks ties between equal ranks: lower first, or higher first when reversed. */
    activationSequence?: number;
}

export class BufferedPriorityQueue<T extends Orderable> {
    /*
    A binary heap implementation that works for specifically for behaviors.
    Delays heapifying new elements until the next pop. Adding multiple extents
    in the same behavior can lead to reheaping. The delay prevents behaviors
    from being resorted multiple times.
     */
    queue: T[] = [];
    buffer: T[] = [];
    /**
     * When true, items are ranked by `priority` and ties pop in reverse `activationSequence`.
     * Call `unsort` after changing it or any rank of a queued item.
     */
    reversed: boolean = false;

    constructor() {

    }

    public push(behavior: T) : void {
        this.buffer.push(behavior);
    }

    public peek() : T | undefined {
        if (this.length == 0) {
            return undefined;
        } else {
            this.heapifyBuffer();
            return this.queue[0];
        }
    }

    public pop() : T | undefined {
        if (this.length == 0) {
            return undefined;
        } else {
            this.heapifyBuffer();

            // The min is the first one
            // We want to pop from the front (shift) but that is
            // expensive in js so we take the last element and put
            // it at the top and sort it back down (pop is cheap)
            let b = this.queue[0];
            let last = this.queue.pop()!;
            if (this.queue.length > 0) {
                this.queue[0] = last;
                this.down(0);
            }
            return b;

        }
    }

    private heapifyBuffer() {
        // heapify elements in the buffer
        for (let i = 0; i < this.buffer.length; i++) {
            let b = this.buffer[i];
            this.queue.push(b);
            if (this.queue.length > 1) {
                this.up(this.queue.length - 1);
            }
        }
        this.buffer.length = 0;
    }

    public get length() : number {
        return this.queue.length + this.buffer.length;
    }

    public unsort() : void {
        this.buffer = this.buffer.concat(this.queue);
        this.queue.length = 0;
    }

    public clear() : void {
        this.queue.length = 0;
        this.buffer.length = 0;
    }

    private less(a: T, b: T): boolean {
        let ra = this.reversed ? (a.priority ?? a.order) : a.order;
        let rb = this.reversed ? (b.priority ?? b.order) : b.order;
        if (ra != rb) {
            return ra < rb;
        }
        let sa = a.activationSequence ?? 0;
        let sb = b.activationSequence ?? 0;
        return this.reversed ? sa > sb : sa < sb;
    }

    /** The rank the queue sorts `item` by: `order`, or `priority` when reversed. */
    public rank(item: T): number {
        return this.reversed ? (item.priority ?? item.order) : item.order;
    }

    private up(pos: number) {
        let b_up = this.queue[pos];
        while (pos > 0) {
            let parent = (pos - 1) >> 1;
            let b_parent = this.queue[parent];
            if (!this.less(b_up, b_parent)) {
                break;
            }
            this.queue[pos] = b_parent;
            pos = parent;
        }
        this.queue[pos] = b_up;
    }

    private down(pos: number) {
        const halfLength = this.queue.length >> 1;
        const b_down = this.queue[pos];

        while (pos < halfLength) {
            let left = (pos << 1) + 1;
            let best = this.queue[left];
            const right = left + 1;

            if (right < this.queue.length && this.less(this.queue[right], best)) {
                left = right;
                best = this.queue[right];
            }
            if (!this.less(best, b_down)) {
                break;
            }
            this.queue[pos] = best;
            pos = left;
        }

        this.queue[pos] = b_down;
    }

}
