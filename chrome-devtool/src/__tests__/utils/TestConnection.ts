import {DevtoolConnection} from "../../devtool";
import {DevtoolClient, DevtoolClientConnection, DevtoolClientHook} from "../../devtool-client";
import * as bg from "behavior-graph";
import {Message} from "../../messages.js";

class TestHook implements DevtoolClientHook {
    graphs: Map<number, bg.Graph> = new Map();

    allGraphs(): Map<number, bg.Graph> {
        return this.graphs;
    }
}


export class TestConnection implements DevtoolConnection, DevtoolClientConnection {
    client: DevtoolClient;
    clientHook: TestHook;
    messagesFromTool: Message[] = [];
    queuedMessagesFromClient: Message[] = [];
    sentMessagesFromClient: Message[] = [];
    clientListener: ((arg0: Message) => void)|null = null;
    listener: ((arg0: Message) => void)|null = null;

    constructor() {
        this.clientHook = new TestHook();
        this.client = new DevtoolClient(this);
        this.client.clientHook = this.clientHook;
    }

    send(message: Message) {
        this.messagesFromTool.push(message);
        this.clientListener?.(message);
    }

    listen(listener: (message: Message) => void) {
        this.listener = listener;
    }

    clientSend(message: Message) {
        this.queuedMessagesFromClient.push(message);
    }

    clientListen(listener: (message: Message) => void) {
        this.clientListener = listener;
    }

    tst_flushClientMessages() {
        for (let message of this.queuedMessagesFromClient) {
            this.listener?.(message);
            this.sentMessagesFromClient.push(message);
        }
        this.queuedMessagesFromClient.length = 0;
    }
}