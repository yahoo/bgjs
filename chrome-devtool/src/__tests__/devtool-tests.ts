import * as dt from "../devtool.js";
import * as dc from "../devtool-client.js";
import * as bg from "behavior-graph";
import {TestConnection} from "./utils/TestConnection";
import {ConnectionState} from "../devtool.js";
import * as msg from "../messages.js";

test("devtool initially has no connection", () => {
    let tool = new dt.Devtool();
    expect(tool.extent.connection.value).toBeNull();
    expect(tool.extent.connectionState.value).toEqual(ConnectionState.notConnected);
});

test("setting connection sends init message and gets response", () => {
    // |> Given we've set up a connection
    let tool = new dt.Devtool();
    let connection = new TestConnection();

    // |> When we connect
    tool.connect(connection);

    // |> Then the tool should be connecting
    expect(tool.extent.connectionState.value).toEqual(ConnectionState.connecting);
    // and we sent init message
    expect(connection.messagesFromTool[0].type).toEqual("init");

    // |> and when client connection.tst_flushClient send the response
    connection.tst_flushClientMessages();

    // |> client sent init-response
    expect(connection.sentMessagesFromClient[0].type).toEqual("init-response");
    // and tool responds by being connected
    expect(tool.extent.connectionState.value).toEqual(ConnectionState.connected);
});

describe("messages", () => {
    let tool: dt.Devtool;
    let connection: TestConnection;
    let testGraph1: bg.Graph;
    let testGraph2: bg.Graph;

    beforeEach(() => {
        tool = new dt.Devtool();
        connection = new TestConnection();

        testGraph1 = new bg.Graph();
        testGraph2 = new bg.Graph();
        connection.clientHook.graphs.set(testGraph1._graphId, testGraph1);
        connection.clientHook.graphs.set(testGraph2._graphId, testGraph2);

        tool.connect(connection);
    });

    test("after initialization devtool asks for graphs", () => {
        // |> Given we are initialized
        // |> When we connect
        connection.tst_flushClientMessages();

        // |> Then we request a list of graphs
        expect(connection.messagesFromTool.at(-1)?.type).toEqual("list-graphs");

        // |> And when the client responds
        connection.tst_flushClientMessages();

        // |> We have the graphs available in devtool
        expect(connection.sentMessagesFromClient.at(-1)?.type).toEqual("all-graphs");
        let graphs = tool.extent.graphs.value!;
        expect(graphs.length).toEqual(2);
        expect(graphs[0].id).toEqual(testGraph1._graphId);
    });

    test("request for graph details provides that information", () => {
        // |> Given we are initialized
        connection.tst_flushClientMessages();
        connection.tst_flushClientMessages();

        // |> When request graph details
        tool.requestGraphDetails(testGraph1._graphId);

        // |> Then we send a message for graph details
        let sentMessage = connection.messagesFromTool.at(-1) as msg.GraphDetails;
        expect(sentMessage).not.toBeUndefined();
        expect(sentMessage.type).toEqual("graph-details");
        expect(sentMessage.graphId).toEqual(testGraph1._graphId);

        // |> And when the client responds
        let responseMessage = connection.queuedMessagesFromClient.at(-1) as msg.GraphDetailsResponse;

        // |> We have the graph details available in devtool
        expect(responseMessage).not.toBeUndefined();
        expect(responseMessage.type).toEqual("graph-details-response");
        expect(responseMessage.graphId).toEqual(testGraph1._graphId);
    });

    test
});

// try connecting multiple times does what?
// init comes back from client and I'm not connecting?