import * as skynet from "skynet"
import * as socket from "skynet/socket"
import * as websocket from "skynet/http/websocket"

let handle: websocket.HANDLE = {
    [websocket.HANDLE_TYPE.CONNECT]: (socket_id: number) => {
        //console.log(`---- connect`, socket_id);
    },
    [websocket.HANDLE_TYPE.CLOSE]: (socket_id: number, code?: number, reason?: string) => {
        //console.log(`---- close`, socket_id, code, reason);
    },
    [websocket.HANDLE_TYPE.MESSAGE]: (socket_id: number, msg: Uint8Array, sz: number) => {
        //console.log(`---- message`, socket_id, lua_seri.decode(msg, sz));
        recv_amount++;
        websocket.write(socket_id, msg.subarray(0, sz), sz, websocket.OP_CODE.TEXT);
    },
}

let recv_amount = 0;
async function print_amount() {
    while (true) {
        console.log(`recv: ${recv_amount}`);
        recv_amount = 0;
        await skynet.sleep(100);
    }
}

skynet.start(async () => {
    let [service_name, listen_port] = JS_INIT_ARGS.split(" ");

    print_amount();

    let s = await socket.listen(`0.0.0.0:${listen_port}`);
    await socket.start(s, async (accept_id: number, address: string) => {
        await websocket.accept({
            socket_id: accept_id,
            addr: address,
            protocol: "ws",
            handle: handle,
        });
    });

    console.log(`websocket start listen:${listen_port}`);
})