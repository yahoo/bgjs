import * as bg from 'behavior-graph'
import * as msg from './messages.js'

export interface DevtoolClientHook {
    allGraphs(): Map<number, bg.Graph>
}

export interface DevtoolClientConnection {
    clientSend(message: msg.Message): void;
    clientListen(listener: (message: msg.Message) => void): void;
}

class DefaultHook implements DevtoolClientHook {
    allGraphs(): Map<number, bg.Graph> {
        // @ts-ignore
        if (globalThis.__bgAllGraphs !== undefined) {
            // @ts-ignore
            return globalThis.__bgAllGraphs as Map<number, bg.Graph>;
        } else {
            return new Map() as Map<number, bg.Graph>;
        }
    }
}

export class DevtoolClient {

    clientHook: DevtoolClientHook;
    connection: DevtoolClientConnection;
    graph: bg.Graph = new bg.Graph();
    extent: ClientExtent = new ClientExtent(this.graph);

    constructor(connection: DevtoolClientConnection) {
        this.extent.addToGraphWithAction();

        this.clientHook = new DefaultHook();
        this.connection = connection;
        connection.clientListen((message: msg.Message) => {
            this.handleMessage(message);
        });
    }

    handleMessage(message: msg.Message) {
        switch (message.type) {
            case "init":
                this.connection.clientSend(new msg.InitResponseMessage())
                break;
            case "list-graphs":
            {
                let graphs: msg.GraphSpec[] = [];
                this.clientHook.allGraphs().forEach((value, key) => {
                    graphs.push({
                        id: key,
                        debugName: ""
                    });
                });
                let responseMessage = new msg.AllGraphs(graphs);
                this.connection.clientSend(responseMessage);
                break;
            }
            case "graph-details":
            {
                let detailsMessage = message as msg.GraphDetails;
                let allGraphs = this.clientHook.allGraphs();
                let graph = this.clientHook.allGraphs().get(detailsMessage.graphId);
                if (graph === undefined) {
                    // TODO respond with not found
                } else {
                    let responseMessage = new msg.GraphDetailsResponse(graph._graphId);
                    this.connection.clientSend(responseMessage);
                    break;
                }
            }
        }
    }
}

class ClientExtent extends bg.Extent {

    constructor(graph: bg.Graph) {
        super(graph);


    }

}