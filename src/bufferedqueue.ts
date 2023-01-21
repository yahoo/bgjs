//
//  Copyright Yahoo 2021
//
//  Derived from tinyqueue, Copyright 2017 Vladamir Agafonkin, ISC License, https://github.com/mourner/tinyqueue
//

export interface Orderable {
    order: number;
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

    private up(pos: number) {
        let b_up = this.queue[pos];
        while (pos > 0) {
            let parent = (pos - 1) >> 1;
            let b_parent = this.queue[parent];
            if (b_up.order >= b_parent.order) {
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

            if (right < this.queue.length && this.queue[right].order < best.order) {
                left = right;
                best = this.queue[right];
            }
            if (best.order >= b_down.order) {
                break;
            }
            this.queue[pos] = best;
            pos = left;
        }

        this.queue[pos] = b_down;
    }

}
