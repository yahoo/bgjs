import * as bg from "behavior-graph";
import * as msg from "./messages.js";

export interface DevtoolConnection {
    send(message: msg.Message): void;
    listen(listener: (message: msg.Message) => void): void;
}

export enum ConnectionState {
    notConnected,
    connecting,
    connected
}

export class Devtool {
    graph: bg.Graph = new bg.Graph();
    extent: DevtoolExtent = new DevtoolExtent(this.graph);

    constructor() {
        this.extent.addToGraphWithAction();
    }

    connect(connection: DevtoolConnection) {
        connection.listen((message: msg.Message) => {
            this.handleMessage(message);
        });
        this.extent.connection.updateWithAction(connection);
    }

    handleMessage(message: msg.Message) {
        switch (message.type) {
            case "init-response":
                this.extent.initResponse.updateWithAction();
                break;
        }
    }
}

export class DevtoolExtent extends bg.Extent {
    connection: bg.State<DevtoolConnection|null> = this.state(null);
    connectionState: bg.State<ConnectionState> = this.state(ConnectionState.notConnected);
    initResponse: bg.Moment = this.moment();

    constructor(gr: bg.Graph) {
        super(gr);

        this.behavior()
            .supplies(this.connectionState)
            .demands(this.connection, this.initResponse)
            .runs(ext => {
                if (this.connection.justUpdated && this.connection.value != null) {
                    this.connectionState.update(ConnectionState.connecting);
                    this.sideEffect(ext1 => {
                        ext1.connection.value?.send(new msg.InitMessage);
                    })
                } else if (this.initResponse.justUpdated) {
                    // TODO what should I do if I get an init response from a wrong init? or if I'm not connecting?
                    this.connectionState.update(ConnectionState.connected);
                }
            });

    }
}