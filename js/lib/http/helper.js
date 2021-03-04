import * as skynet from "skynet";
import * as socket from "skynet/socket";
import { INTERFACE_TYPE } from "http/types";
import { utf8 } from "utf8";
let readbytes = socket.read;
let writebytes = socket.write;
export let SOCKET_ERROR = "[Socket Error]";
export function readfunc(fd) {
    return async (sz, buffer, offset) => {
        let [ret, msg, len] = await readbytes(fd, sz, buffer, offset);
        if (ret) {
            return [msg, len];
        }
        else {
            throw new Error(SOCKET_ERROR);
        }
    };
}
export const readall = socket.readall;
export function writefunc(fd) {
    return (content) => {
        let ok = writebytes(fd, content);
        if (!ok) {
            throw new Error(SOCKET_ERROR);
        }
    };
}
export function close(fd) {
    socket.close(fd);
}
export function shutdown(fd) {
    socket.shutdown(fd);
}
export async function connect(host, port, timeout) {
    if (timeout) {
        let token = skynet.gen_token();
        let fd = 0;
        let drop_fd = false;
        let async_conn = async () => {
            fd = await socket.open(host, port);
            if (drop_fd) {
                socket.close(fd);
            }
            else {
                skynet.wakeup(token);
            }
        };
        async_conn();
        await skynet.sleep(timeout, token);
        if (!fd) {
            drop_fd = true;
        }
        return fd;
    }
    let fd = await socket.open(host, port);
    return fd;
}
let tls_rt = Deno.tls;
export function gen_interface(type, fd, tls_ctx, websocket) {
    if (tls_ctx) {
        let socket_interface = {
            init: type == INTERFACE_TYPE.SERVER ? tls_init_responsefunc(fd, tls_ctx) : tls_init_requestfunc(fd, tls_ctx),
            close: tls_closefunc(tls_ctx),
            read: tls_readfunc(fd, tls_ctx),
            write: tls_writefunc(fd, tls_ctx),
            readall: tls_readallfunc(fd, tls_ctx),
            websocket: websocket == true,
        };
        return socket_interface;
    }
    else {
        let socket_interface = {
            read: readfunc(fd),
            write: writefunc(fd),
            readall: (buffer, offset) => {
                return socket.readall(fd, buffer, offset);
            },
            websocket: websocket == true,
        };
        return socket_interface;
    }
}
export function decode_str(buffer, start, end) {
    // String.fromCharCode.apply(null, Array.from(buffer.slice(start, end)))
    return utf8.read(buffer, start, end);
}
export function tls_init_requestfunc(fd, ctx) {
    let read = readfunc(fd);
    let write = writefunc(fd);
    return async () => {
        let bio_sz = tls_rt.handshake(ctx);
        let ds1 = skynet.alloc_buffer(bio_sz);
        let ds1_sz = tls_rt.bio_read(ctx, ds1.buffer, 0);
        write(ds1.subarray(0, ds1_sz));
        while (!tls_rt.finished(ctx)) {
            let [ds2, ds2_sz] = await read();
            tls_rt.bio_write(ctx, ds2.subarray(0, ds2_sz));
            bio_sz = tls_rt.handshake(ctx);
            if (bio_sz) {
                let ds3 = skynet.alloc_buffer(bio_sz);
                let ds3_sz = tls_rt.bio_read(ctx, ds3.buffer, 0);
                write(ds3.subarray(0, ds3_sz));
            }
        }
    };
}
export function tls_init_responsefunc(fd, ctx) {
    let read = readfunc(fd);
    let write = writefunc(fd);
    return async () => {
        let bio_sz;
        while (!tls_rt.finished(ctx)) {
            let [ds1, ds1_sz] = await read();
            tls_rt.bio_write(ctx, ds1.subarray(0, ds1_sz));
            bio_sz = tls_rt.handshake(ctx);
            if (bio_sz) {
                let ds2 = skynet.alloc_buffer(bio_sz);
                let ds2_sz = tls_rt.bio_read(ctx, ds2.buffer, 0);
                write(ds2.subarray(0, ds2_sz));
            }
        }
        bio_sz = tls_rt.ssl_write(ctx);
        let ds3 = skynet.alloc_buffer(bio_sz);
        let ds3_sz = tls_rt.bio_read(ctx, ds3.buffer, 0);
        write(ds3.subarray(0, ds3_sz));
    };
}
export function tls_closefunc(ctx) {
    return () => {
        tls_rt.free_tls(ctx);
    };
}
export function tls_newctx() {
    return tls_rt.new_ctx();
}
export function tls_newtls(ctx, type) {
    return tls_rt.new_tls(ctx, type);
}
let text_encoder = new TextEncoder();
export function tls_writefunc(fd, ctx) {
    let write = writefunc(fd);
    return (content) => {
        let bio_sz;
        if (typeof (content) == "string") {
            bio_sz = tls_rt.ssl_write(ctx, text_encoder.encode(content));
        }
        else if (content instanceof Uint8Array) {
            bio_sz = tls_rt.ssl_write(ctx, content);
        }
        else {
            bio_sz = tls_rt.ssl_write(ctx, ...content);
        }
        let buffer = skynet.alloc_buffer(bio_sz);
        let sz = tls_rt.bio_read(ctx, buffer.buffer, 0);
        return write(buffer.subarray(0, sz));
    };
}
export function tls_readallfunc(fd, ctx) {
    return async (buffer, offset = 0) => {
        [buffer, offset] = await socket.readall(fd, buffer, offset);
        let sz = tls_rt.bio_write(ctx, buffer.subarray(0, offset));
        while (sz) {
            buffer = skynet.alloc_buffer(sz + offset, buffer);
            let read_sz;
            [read_sz, sz] = tls_rt.ssl_read(ctx, buffer.buffer, offset, sz);
            offset += read_sz;
        }
        return [buffer, sz];
    };
}
export function tls_readfunc(fd, ctx) {
    let read = readfunc(fd);
    return async (sz, buffer, offset = 0) => {
        let alloc_sz = sz ? sz : 128;
        let recv_sz = 0;
        buffer = buffer ? skynet.alloc_buffer(alloc_sz + offset, buffer) : skynet.alloc_buffer(alloc_sz + offset, true);
        while (recv_sz < (sz ? sz : 1)) {
            let [read_sz, ssl_sz] = tls_rt.ssl_read(ctx, buffer.buffer, offset, alloc_sz);
            if (read_sz) {
                offset += read_sz;
                recv_sz += read_sz;
                alloc_sz -= read_sz;
            }
            else if (!ssl_sz) {
                let [raw_msg, raw_sz] = await read();
                tls_rt.bio_write(ctx, raw_msg.subarray(0, raw_sz));
            }
        }
        return [buffer, recv_sz];
    };
}
export function tls_setcert(ctx, certfile, keyfile) {
    tls_rt.set_cert(ctx, certfile, keyfile);
}
