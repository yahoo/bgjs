//
//  Copyright Yahoo 2021
//


import { 
    Graph, 
    GraphEvent, 
    BehaviorGraphDateProvider,
    Behavior,
    State,
    Moment,
    Resource,
    Extent,
    InitialEvent
 } from '../index';

describe('Version 1: Simple Vending Machine', () => {

    class VendingMachine extends Extent {
        sodasVended: number = 0;
        buttonAction: Moment = new Moment(this);
        vendEffect: Behavior = this.makeBehavior([this.buttonAction], [], (extent: VendingMachine) => {
            if (extent.buttonAction.justUpdated) {
                extent.sideEffect('vend', (extent) => {
                    extent.sodasVended += 1;
                });
            }
        });
    }

    test('press button, vend soda', () => {
        let g = new Graph();
        let v = new VendingMachine(g);

        v.addToGraphWithAction();

        expect(v.sodasVended).toBe(0);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
    });
});

describe('Version 2: No Free Soda', () => {

    class VendingMachine extends Extent {
        SODA_PRICE: number = 100;
        sodasVended: number = 0;

        buttonAction: Moment = new Moment(this);
        insertCoinsAction: Moment<number> = new Moment(this);
        coinsTotal: State<number> = new State(this, 0);

        vendEffect: Behavior = this.makeBehavior([this.buttonAction, this.insertCoinsAction], [this.coinsTotal], extent => {

            let coins = extent.coinsTotal.value;

            if (extent.insertCoinsAction.justUpdated) {
                coins += extent.insertCoinsAction.value!;
            }

            if (extent.buttonAction.justUpdated) {
                if (coins >= extent.SODA_PRICE) {
                    coins -= extent.SODA_PRICE;
                    extent.sideEffect('vend', (extent) => {
                        extent.sodasVended += 1;
                    });
                }
            }

            extent.coinsTotal.update(coins, true);

        });
    }

    let g: Graph;
    let v: VendingMachine;

    beforeEach(() => {
        g = new Graph;
        v = new VendingMachine(g);
        v.addToGraphWithAction();
    });

    test('no free soda', () => {
        expect(v.sodasVended).toBe(0);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(0);
    });

    test('money buys soda', () => {
        v.insertCoinsAction.updateWithAction(50);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(0);
        v.insertCoinsAction.updateWithAction(50);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
    });

    test('buying consumes money', () => {
        v.insertCoinsAction.updateWithAction(100);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
    });

    test('can buy more', () => {
        v.insertCoinsAction.updateWithAction(100);
        v.buttonAction.updateWithAction();
        v.insertCoinsAction.updateWithAction(100);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(2);
    });
});

describe('Version 3: Cans', () => {

    class VendingMachine extends Extent {
        SODA_PRICE: number = 100;
        sodasVended: number = 0;
        cansDisplay: number = 0;
        coinsDisplay: number = 0;

        buttonAction: Moment = new Moment(this);
        insertCoinsAction: Moment<number> = new Moment(this);
        restockAction: Moment<number> = new Moment(this);

        coinsTotal: State<number> = new State(this, 0);
        cansTotal: State<number> = new State(this, 0);

        vendEffect: Behavior = this.makeBehavior([this.buttonAction, this.insertCoinsAction, this.restockAction],
            [this.coinsTotal, this.cansTotal], extent => {

            let coins = extent.coinsTotal.value;
            let cans = extent.cansTotal.value;

            if (extent.insertCoinsAction.justUpdated) {
                coins += extent.insertCoinsAction.value!;
            }
            if (extent.restockAction.justUpdated) {
                cans += extent.restockAction.value!;
            }
            if (extent.buttonAction.justUpdated) {
                if (coins >= extent.SODA_PRICE && cans > 0) {
                    coins -= extent.SODA_PRICE;
                    cans -= 1;
                    extent.sideEffect('vend',(extent) => {
                        extent.sodasVended += 1;
                    })
                }
            }
            extent.coinsTotal.update(coins, true);
            extent.cansTotal.update(cans, true);
        });

        constructor(graph: Graph) {
            super(graph);

            this.makeBehavior([this.coinsTotal], null, extent => {
                extent.sideEffect('coin display',(extent) => {
                    extent.coinsDisplay = this.coinsTotal.value;
                });
            });

            this.makeBehavior([this.cansTotal], null, extent => {
                extent.sideEffect('can display', (extent) => {
                    extent.cansDisplay = this.cansTotal.value;
                });
            });

        }

    }

    let g: Graph;
    let v: VendingMachine;

    beforeEach(() => {
        g = new Graph;
        v = new VendingMachine(g);
        v.addToGraphWithAction();
    });

    test('cans also required', () => {
        v.insertCoinsAction.updateWithAction(100);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(0);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
    });

    test('display effect behaviors activated', () => {
        v.insertCoinsAction.updateWithAction(140);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        expect(v.coinsDisplay).toBe(40);
        expect(v.cansDisplay).toBe(9);
    });

});

describe('Version 4: Vending State', () => {

    class VendingMachine extends Extent {
        SODA_PRICE: number = 100;
        sodasVended: number = 0;
        cansDisplay: number = 0;
        coinsDisplay: number = 0;

        buttonAction: Moment = new Moment(this);
        insertCoinsAction: Moment<number> = new Moment(this);
        restockAction: Moment<number> = new Moment(this);
        vending: State<boolean> = new State(this, false);
        completeVendAction: Moment = new Moment(this);

        coinsTotal: State<number> = new State(this, 0);
        cansTotal: State<number> = new State(this, 0);

        constructor(graph: Graph) {
            super(graph);

            this.makeBehavior([this.coinsTotal], null, extent => {
                extent.sideEffect('coin display', (extent) => {
                    extent.coinsDisplay = extent.coinsTotal.value;
                });
            });

            this.makeBehavior([this.cansTotal], null, extent => {
                extent.sideEffect('can display', (extent) => {
                    extent.cansDisplay = extent.cansTotal.value;
                });
            });

            this.makeBehavior(
                [this.completeVendAction, this.insertCoinsAction, this.restockAction],
                [this.coinsTotal, this.cansTotal],
                extent => {

                    let coins = extent.coinsTotal.value;
                    let cans = extent.cansTotal.value;

                    coins += extent.insertCoinsAction.value ?? 0;
                    cans += extent.restockAction.value ?? 0;

                    if (extent.completeVendAction.justUpdated) {
                        coins -= extent.SODA_PRICE;
                        cans -= 1;
                    }

                    extent.coinsTotal.update(coins, true);
                    extent.cansTotal.update(cans, true);

                });

            this.makeBehavior(
                [this.coinsTotal, this.cansTotal, this.buttonAction, this.completeVendAction],
                [this.vending],
                (extent) => {

                    let coins = extent.coinsTotal.value;
                    let cans = extent.cansTotal.value;

                    // given extent.vending.value
                    if (extent.vending.value) {
                        if (extent.completeVendAction.justUpdated) {
                            extent.vending.update(false, true);
                        }
                    } else {
                        if (extent.buttonAction.justUpdated) {
                            if (coins >= extent.SODA_PRICE && cans > 0) {
                                extent.sideEffect('vend', (extent) => {
                                    extent.sodasVended += 1;
                                });
                                extent.vending.update(true, true);
                            }
                        }
                    }

                });

        }

    }

    let g: Graph;
    let v: VendingMachine;

    beforeEach(() => {
        g = new Graph;
        v = new VendingMachine(g);
        v.addToGraphWithAction();
    });

    test('money and can not deducted until we get feedback that can was vended', () => {
        v.insertCoinsAction.updateWithAction(100);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);
        expect(v.coinsDisplay).toBe(100);
        expect(v.cansDisplay).toBe(10);

        v.completeVendAction.updateWithAction();
        expect(v.coinsDisplay).toBe(0);
        expect(v.cansDisplay).toBe(9);
    });

    test('pressing button while vending is ignored', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.buttonAction.updateWithAction();
        expect(v.sodasVended).toBe(1);

        v.completeVendAction.updateWithAction();
        expect(v.coinsDisplay).toBe(100);
        expect(v.cansDisplay).toBe(9);
    });

    test('can vend again', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.completeVendAction.updateWithAction();
        v.buttonAction.updateWithAction();
        v.completeVendAction.updateWithAction();
        expect(v.coinsDisplay).toBe(0);
        expect(v.cansDisplay).toBe(8);
    });

});

describe('Version 5: Jammed', () => {

    class VendingMachine extends Extent {
        SODA_PRICE: number = 100;

        // side effects
        sodasVended: number = 0;
        cansDisplay: number = 0;
        coinsDisplay: number = 0;
        vendTimeoutTimerRunning: boolean = false;
        coinsReturned: number = 0;

        // measures
        buttonAction: Moment = new Moment(this);
        insertCoinsAction: Moment<number> = new Moment(this);
        restockAction: Moment<number> = new Moment(this);
        completeVendAction: Moment = new Moment(this);
        timeoutAction: Moment = new Moment(this);
        fixJamAction: Moment = new Moment(this);

        // resources
        vending: State<boolean> = new State(this, false);
        coinsTotal: State<number> = new State(this, 0);
        cansTotal: State<number> = new State(this, 0);
        jammed: State<boolean> = new State(this, false);

        constructor(graph: Graph) {
            super(graph);

            this.makeBehavior([this.coinsTotal], null, extent => {
                extent.sideEffect('coin display', (extent) => {
                    extent.coinsDisplay = extent.coinsTotal.value;
                });
            });

            this.makeBehavior([this.cansTotal], null, extent => {
                extent.sideEffect('can display', () => {
                    extent.cansDisplay = extent.cansTotal.value
                });
            });

            this.makeBehavior(
                [this.completeVendAction, this.insertCoinsAction, this.restockAction],
                [this.coinsTotal, this.cansTotal],
                extent => {

                    let coins = extent.coinsTotal.value;
                    let cans = extent.cansTotal.value;

                    if (extent.insertCoinsAction.justUpdated) {
                        let inserted = extent.insertCoinsAction.value!;
                        if (extent.jammed.traceValue) {
                            extent.sideEffect('return coins', (extent) => {
                                extent.coinsReturned = inserted;
                            });
                        } else {
                            coins += inserted;
                        }
                    }

                    if (extent.restockAction.justUpdated) {
                        cans += extent.restockAction.value!;
                    }

                    if (extent.completeVendAction.justUpdated) {
                        coins -= extent.SODA_PRICE;
                        cans -= 1;
                    }

                    extent.coinsTotal.update(coins, true);
                    extent.cansTotal.update(cans, true);

                });

            this.makeBehavior(
                [this.coinsTotal, this.cansTotal, this.buttonAction, this.completeVendAction, this.jammed],
                [this.vending],
                (extent) => {

                    let coins = extent.coinsTotal.value;
                    let cans = extent.cansTotal.value;
                    let vending = extent.vending.value;

                    if (vending) {
                        if (extent.completeVendAction.justUpdated) {
                            extent.vending.update(false, true);
                        } else if (extent.jammed.justUpdatedTo(true)) {
                            extent.vending.update(false, true);
                        }
                    } else {
                        if (extent.buttonAction.justUpdated) {
                            if (coins >= extent.SODA_PRICE && cans > 0) {
                                extent.vending.update(true, true);
                            }
                        }
                    }

                });

            this.makeBehavior([this.vending], null, (extent) => {
                if (extent.vending.justUpdatedTo(true)) {
                    extent.sideEffect('vend, start timeout timer',(extent) => {
                        extent.vendTimeoutTimerRunning = true;
                        extent.sodasVended += 1;
                    });
                } else if (extent.vending.justUpdatedTo(false)) {
                    extent.sideEffect('stop, timeout timer',(extent) => {
                        extent.vendTimeoutTimerRunning = false;
                    });
                }
            });

            this.makeBehavior(
                [this.timeoutAction, this.fixJamAction],
                [this.jammed],
                (extent) => {
                    // if we started vending
                    if (extent.vending.traceValue && extent.timeoutAction.justUpdated) {
                        extent.jammed.update(true, true);
                    } else if (extent.jammed.value && extent.fixJamAction.justUpdated) {
                        extent.jammed.update(false, true);
                    }
                }
            )
        }

    }

    let g: Graph;
    let v: VendingMachine;

    beforeEach(() => {
        g = new Graph;
        v = new VendingMachine(g);
        v.addToGraphWithAction();
    });

    test('enough time passes while vending means jammed', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();

        expect(v.vendTimeoutTimerRunning).toBe(true);

        v.timeoutAction.updateWithAction();
        expect(v.jammed.value).toBe(true);
        expect(v.vendTimeoutTimerRunning).toBe(false);
    });

    test('timeout timer cancelled when vended', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.completeVendAction.updateWithAction();
        expect(v.vendTimeoutTimerRunning).toBe(false);
    });


    test('timeout timer happens after vended', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.completeVendAction.updateWithAction();
        v.timeoutAction.updateWithAction();
        expect(v.jammed.value).toBe(false);
        expect(v.jammed.event).toBe(InitialEvent); // never jams
    });

    test('fix jam clears the jammed state', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.timeoutAction.updateWithAction();
        v.fixJamAction.updateWithAction();
        expect(v.jammed.value).toBe(false);
    });

    test('coins inserted while jammed are returned instead', () => {
        v.insertCoinsAction.updateWithAction(200);
        v.restockAction.updateWithAction(10);
        v.buttonAction.updateWithAction();
        v.timeoutAction.updateWithAction();
        v.insertCoinsAction.updateWithAction(20);
        expect(v.coinsReturned).toBe(20);
    });

});