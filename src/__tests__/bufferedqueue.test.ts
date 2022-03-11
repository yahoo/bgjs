//
//  Copyright Yahoo 2021
//

import { BufferedPriorityQueue, Orderable } from "../bufferedqueue.js";

class Item implements Orderable {
    order: number;
    constructor(o: number) {
        this.order = o;
    }
}

let q: BufferedPriorityQueue<Item>;
beforeEach(() => {
    q = new BufferedPriorityQueue<Item>();
});

test('initially empty', () => {
    expect(q.length).toEqual(0);
});

test('pop empty is undefined', () => {
    expect(q.pop()).toBeUndefined();
});

test('adding one', () => {
    let i1 = new Item(5);
    q.push(i1);

    expect(q.buffer.length).toEqual(1);
    expect(q.length).toEqual(1);

    let r1 = q.pop();
    expect(r1).toEqual(i1);
    expect(q.length).toEqual(0);
});

test('add one lower', () => {
    let i1 = new Item(5);
    q.push(i1);
    let i2 = new Item(4);
    q.push(i2);

    expect(q.length).toEqual(2);

    let r1 = q.pop();
    expect(r1).toEqual(i2);
    let r2 = q.pop();
    expect(r2).toEqual(i1);
});

test('add one higher', () => {
    let i1 = new Item(4);
    q.push(i1);
    let i2 = new Item(5);
    q.push(i2);

    expect(q.length).toEqual(2);
    expect(q.buffer.length).toEqual(2);
    expect(q.queue.length).toEqual(0);

    let r1 = q.pop();
    expect(r1).toEqual(i1);
    expect(q.length).toEqual(1);
    expect(q.buffer.length).toEqual(0);
    expect(q.queue.length).toEqual(1);
    
    let r2 = q.pop();
    expect(r2).toEqual(i2);
});

test('remove first needs reheap of first element', () => {
    q.push(new Item(1));
    q.push(new Item(3));
    q.push(new Item(2));
    expect(q.pop()!.order).toEqual(1);
    expect(q.pop()!.order).toEqual(2);
    expect(q.pop()!.order).toEqual(3);
    expect(q.pop()).toBeUndefined();
});

test('unsort keeps elements', () => {
    q.push(new Item(1));
    q.push(new Item(3));
    q.push(new Item(2));
    q.pop();
    q.unsort();
    expect(q.queue.length).toEqual(0);
    expect(q.buffer.length).toEqual(2);
});

test('clear empties', () => {
    // |> Given items in queue
    q.push(new Item(1));
    q.push(new Item(3));
    q.pop();
    // and one in the buffer
    q.push(new Item(2));

    // |> When clear is called
    q.clear()

    // |> All are removed
    expect(q.length).toBe(0);
})
