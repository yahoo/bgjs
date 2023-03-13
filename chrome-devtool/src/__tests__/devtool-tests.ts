import * as dt from "../devtool.js";
import * as dc from "../devtool-client.js";
import {TestConnection} from "./utils/TestConnection";
import {ConnectionState} from "../devtool.js";

test("devtool initially has no connection", () => {
    let tool = new dt.Devtool();
    expect(tool.extent.connection.value).toBeNull();
    expect(tool.extent.connectionState.value).toEqual(ConnectionState.notConnected);
});

test('setting connection sends init message and gets response', () => {
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

// try connecting multiple times does what?
// init comes back from client and I'm not connecting?