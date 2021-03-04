import * as skynet from "skynet";
import * as socket from "skynet/socket";
import * as crypt from "crypt";
import * as internal from "http/internal";
import * as httpd from "http/httpd";
import * as http_helper from "http/helper";
import { INTERFACE_TYPE } from "http/types";
import * as pack from "pack";
let GLOBAL_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
let MAX_FRAME_SIZE = 256 * 1024; // max frame is 256K
const BUFFER_INIT_SIZE = 512;
const SENDBUFFER_PRE_HEADER = 20;
export var HANDLE_TYPE;
(function (HANDLE_TYPE) {
    HANDLE_TYPE[HANDLE_TYPE["MESSAGE"] = 0] = "MESSAGE";
    HANDLE_TYPE[HANDLE_TYPE["CONNECT"] = 1] = "CONNECT";
    HANDLE_TYPE[HANDLE_TYPE["CLOSE"] = 2] = "CLOSE";
    HANDLE_TYPE[HANDLE_TYPE["HANDSHAKE"] = 3] = "HANDSHAKE";
    HANDLE_TYPE[HANDLE_TYPE["PING"] = 4] = "PING";
    HANDLE_TYPE[HANDLE_TYPE["PONG"] = 5] = "PONG";
    HANDLE_TYPE[HANDLE_TYPE["ERROR"] = 6] = "ERROR";
    HANDLE_TYPE[HANDLE_TYPE["WARNING"] = 7] = "WARNING";
})(HANDLE_TYPE || (HANDLE_TYPE = {}));
export var OP_CODE;
(function (OP_CODE) {
    OP_CODE[OP_CODE["FRAME"] = 0] = "FRAME";
    OP_CODE[OP_CODE["TEXT"] = 1] = "TEXT";
    OP_CODE[OP_CODE["BINARY"] = 2] = "BINARY";
    OP_CODE[OP_CODE["CLOSE"] = 8] = "CLOSE";
    OP_CODE[OP_CODE["PING"] = 9] = "PING";
    OP_CODE[OP_CODE["PONG"] = 10] = "PONG";
})(OP_CODE || (OP_CODE = {}));
var WS_MODULE;
(function (WS_MODULE) {
    WS_MODULE["CLIENT"] = "client";
    WS_MODULE["SERVER"] = "server";
})(WS_MODULE || (WS_MODULE = {}));
let ws_pool = new Map();
function _close_websocket(ws_obj) {
    let id = ws_obj.socket_id;
    skynet.assert(ws_pool.get(id) == ws_obj);
    if (!ws_obj.is_close) {
        ws_obj.is_close = true;
        ws_pool.delete(id);
        ws_obj.close();
    }
}
async function _write_handshake(ws, host, url, header) {
    let key = crypt.base64encode(new Uint8Array([...crypt.randomkey(), ...crypt.randomkey()]));
    let request_header = new Map([
        ["Upgrade", "websocket"],
        ["Connection", "Upgrade"],
        ["Sec-WebSocket-Version", "13"],
        ["Sec-WebSocket-Key", key],
    ]);
    header && header.forEach((v, k) => request_header.set(k, v));
    let [code, body, recv_header] = await internal.request(ws.socket, {
        method: "GET",
        host,
        url,
        header: request_header,
    });
    if (code != 101) {
        throw new Error(`websocket handshake error: code[${code}] info:${body}`);
    }
    if (!recv_header.has("upgrade") || recv_header.get("upgrade").toLowerCase() != "websocket") {
        throw new Error(`websocket handshake upgrade must websocket`);
    }
    if (!recv_header.has("connection") || recv_header.get("connection").toLowerCase() != "upgrade") {
        throw new Error(`websocket handshake connection must upgrade`);
    }
    let sw_key = recv_header.get("sec-websocket-accept");
    if (!sw_key) {
        throw new Error(`websocket handshake need Sec-WebSocket-Accept`);
    }
    sw_key = String.fromCharCode.apply(null, Array.from(crypt.base64decode(sw_key)));
    if (sw_key != String.fromCharCode.apply(null, Array.from(crypt.sha1(key + GLOBAL_GUID)))) {
        throw new Error(`websocket handshake invalid Sec-WebSocket-Accept`);
    }
}
async function _read_handshake(ws, accept_ops) {
    let header, url, method;
    if (accept_ops && accept_ops.upgrade) {
        url = accept_ops.upgrade.url;
        method = accept_ops.upgrade.method;
        header = accept_ops.upgrade.header;
    }
    else {
        let tmpline = new Array();
        let header_body = await internal.recvheader(ws.socket.read, tmpline, new Uint8Array(), 0);
        if (!header_body) {
            return [443];
        }
        let request = tmpline[0];
        let r = request.match(/^(\w+)\s+(.+)\s+HTTP\/([\d\.]+)/);
        if (!r) {
            return [400];
        }
        let httpver;
        [method, url, httpver] = [r[1], r[2], Number(r[3])];
        if (method != "GET") {
            return [400, "need GET method"];
        }
        if (httpver < 1.1) {
            return [505];
        }
        header = internal.parseheader(tmpline, 1, new Map());
    }
    if (!header) {
        return [400];
    }
    if (!header.has("upgrade") || header.get("upgrade").toLowerCase() != "websocket") {
        return [426, "Upgrade Required"];
    }
    if (!header.get("host")) {
        return [400, "host Required"];
    }
    if (!header.has("connection") || header.get("connection").toLowerCase().indexOf("upgrade") < 0) {
        return [400, "Connection must Upgrade"];
    }
    let sw_key = header.get("sec-websocket-key");
    if (!sw_key) {
        return [400, "Sec-WebSocket-Key Required"];
    }
    else {
        let raw_key = crypt.base64decode(sw_key);
        if (raw_key.length != 16) {
            return [400, "Sec-WebSocket-Key invalid"];
        }
    }
    if (header.get("sec-websocket-version") != "13") {
        return [400, "Sec-WebSocket-Version must 13"];
    }
    let sw_protocol = header.get("sec-websocket-protocol");
    let sub_pro = "";
    if (sw_protocol) {
        let has_chat = false;
        sw_protocol.split(/[\s,]+/).forEach((sub_protocol) => {
            if (sub_protocol == "chat") {
                sub_pro = "Sec-WebSocket-Protocol: chat\r\n";
                has_chat = true;
            }
        });
        if (!has_chat) {
            return [400, "Sec-WebSocket-Protocol need include chat"];
        }
    }
    // response handshake
    let accept = crypt.base64encode(crypt.sha1(sw_key + GLOBAL_GUID));
    let resp = "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n` +
        sub_pro + "\r\n";
    ws.socket.write(resp);
    return [0, url, header];
}
function _try_handle(ws, type, ...params) {
    if (ws && ws.handle && ws.handle[type]) {
        let handle = ws.handle[type];
        handle(ws.socket_id, ...params);
    }
}
function _write_frame(ws, op, payload_data, payload_sz, masking_key) {
    let payload_len = payload_sz || 0;
    let v1 = 0x80 | op;
    let mask = masking_key && 0x80 || 0x00;
    let end_pos = SENDBUFFER_PRE_HEADER + payload_len;
    ws.send_buffer = skynet.alloc_buffer(end_pos, ws.send_buffer || new Uint8Array(BUFFER_INIT_SIZE));
    if (payload_data && payload_data != ws.send_buffer) {
        ws.send_buffer.set(payload_data, SENDBUFFER_PRE_HEADER);
    }
    let header_offset = SENDBUFFER_PRE_HEADER;
    if (masking_key) {
        header_offset -= 4;
        pack.encode_uint32(ws.send_buffer, header_offset, masking_key);
        crypt.xor(ws.send_buffer, SENDBUFFER_PRE_HEADER, end_pos, ws.send_buffer.subarray(header_offset, header_offset + 4));
    }
    // mask set to 0
    if (payload_len < 126) {
        header_offset -= 2;
        pack.encode_uint8(ws.send_buffer, header_offset, v1);
        pack.encode_uint8(ws.send_buffer, header_offset + 1, mask | payload_len);
    }
    else if (payload_len < 0xffff) {
        header_offset -= 4;
        pack.encode_uint8(ws.send_buffer, header_offset + 0, v1);
        pack.encode_uint8(ws.send_buffer, header_offset + 1, 126);
        pack.encode_uint16(ws.send_buffer, header_offset + 2, payload_len);
    }
    else {
        header_offset -= 10;
        pack.encode_uint8(ws.send_buffer, header_offset + 0, v1);
        pack.encode_uint8(ws.send_buffer, header_offset + 1, 127);
        pack.encode_safe_uint64(ws.send_buffer, header_offset + 2, payload_len);
    }
    ws.socket.write(ws.send_buffer.subarray(header_offset, end_pos));
}
function _read_close(payload_data, payload_len) {
    let code = 0;
    let reason = "";
    if (payload_len >= 2) {
        code = pack.decode_uint16(payload_data, 0);
        reason = String.fromCharCode.apply(null, Array.from(payload_data.slice(2, payload_len)));
    }
    return [code, reason];
}
async function _read_frame(ws, buffer, offset = 0) {
    buffer = buffer || ws.recv_buffer;
    if (!buffer) {
        ws.recv_buffer = new Uint8Array(BUFFER_INIT_SIZE);
        buffer = ws.recv_buffer;
    }
    let [header, header_sz] = await ws.socket.read(2);
    let v1 = pack.decode_uint8(header, 0);
    let v2 = pack.decode_uint8(header, 1);
    let fin = ((v1 & 0x80) != 0);
    let op = v1 & 0x0f;
    let mask = ((v2 & 0x80) != 0);
    let payload_len = (v2 & 0x7f);
    if (payload_len == 126) {
        let [s] = await ws.socket.read(2);
        payload_len = pack.decode_uint16(s, 0);
    }
    else if (payload_len == 127) {
        let [s] = await ws.socket.read(8);
        payload_len = pack.decode_uint(s, 0, 8);
    }
    if (ws.mode == WS_MODULE.SERVER && payload_len > MAX_FRAME_SIZE) {
        throw new Error("payload_len is too large");
    }
    let masking_key;
    if (mask) {
        [masking_key] = await ws.socket.read(4);
    }
    if (payload_len > 0) {
        let [msg, sz] = await ws.socket.read(payload_len, buffer, offset);
        if (buffer == ws.recv_buffer) {
            ws.recv_buffer = msg;
        }
        buffer = msg;
        offset += sz;
    }
    if (masking_key && buffer) {
        crypt.xor(buffer, offset - payload_len, offset, masking_key, 4);
    }
    return [fin, op, buffer, payload_len];
}
async function _resolve_accept(ws, options) {
    _try_handle(ws, HANDLE_TYPE.CONNECT);
    let [code, err, header] = await _read_handshake(ws, options);
    if (code) {
        httpd.write_response(ws.socket.write, code, err);
        _try_handle(ws, HANDLE_TYPE.CLOSE);
        return;
    }
    let url = err;
    _try_handle(ws, HANDLE_TYPE.HANDSHAKE, [header, url]);
    let recv_count = 0;
    while (true) {
        if (ws.is_close) {
            _try_handle(ws, HANDLE_TYPE.CLOSE);
            return;
        }
        let [fin, op, payload_data, payload_size] = await _read_frame(ws, undefined, recv_count);
        recv_count += payload_size;
        if (op == OP_CODE.CLOSE) {
            let [code, reason] = await _read_close(payload_data, recv_count);
            _write_frame(ws, OP_CODE.CLOSE);
            _try_handle(ws, HANDLE_TYPE.CLOSE, code, reason);
            break;
        }
        else if (op == OP_CODE.PING) {
            _write_frame(ws, OP_CODE.PONG, payload_data.subarray(0, payload_size), payload_size);
            _try_handle(ws, HANDLE_TYPE.PING);
        }
        else if (op == OP_CODE.PONG) {
            _try_handle(ws, HANDLE_TYPE.PONG);
        }
        else {
            if (recv_count > MAX_FRAME_SIZE) {
                throw new Error("payload_len is to large");
            }
            if (fin) {
                _try_handle(ws, HANDLE_TYPE.MESSAGE, payload_data, recv_count);
                recv_count = 0;
            }
        }
    }
}
let SSLCTX_CLIENT;
async function _new_client_ws(socket_id, protocol) {
    let obj;
    if (protocol == "wss") {
        SSLCTX_CLIENT = SSLCTX_CLIENT || http_helper.tls_newctx();
        let tls_ctx = http_helper.tls_newtls(SSLCTX_CLIENT, INTERFACE_TYPE.CLIENT);
        await http_helper.tls_init_requestfunc(socket_id, tls_ctx)();
        obj = {
            close: () => {
                socket.close(socket_id);
                http_helper.tls_closefunc(tls_ctx)();
            },
            socket: http_helper.gen_interface(INTERFACE_TYPE.CLIENT, socket_id, tls_ctx, true),
            mode: WS_MODULE.CLIENT,
            socket_id: socket_id,
        };
    }
    else {
        obj = {
            close: () => {
                socket.close(socket_id);
            },
            socket: http_helper.gen_interface(INTERFACE_TYPE.CLIENT, socket_id, undefined, true),
            mode: WS_MODULE.CLIENT,
            socket_id: socket_id,
        };
    }
    ws_pool.set(socket_id, obj);
    return obj;
}
async function _new_server_ws(socket_id, handle, protocol, tls_ctx) {
    let obj;
    if (protocol == "wss") {
        skynet.assert(tls_ctx);
        await http_helper.tls_init_responsefunc(socket_id, tls_ctx)();
        obj = {
            close: () => {
                socket.close(socket_id);
                http_helper.tls_closefunc(tls_ctx)();
            },
            socket: http_helper.gen_interface(INTERFACE_TYPE.SERVER, socket_id, tls_ctx, true),
            mode: WS_MODULE.SERVER,
            socket_id: socket_id,
            handle: handle,
        };
    }
    else {
        obj = {
            close: () => {
                socket.close(socket_id);
            },
            socket: http_helper.gen_interface(INTERFACE_TYPE.SERVER, socket_id, undefined, true),
            mode: WS_MODULE.SERVER,
            socket_id: socket_id,
            handle: handle,
        };
    }
    ws_pool.set(socket_id, obj);
    return obj;
}
export async function accept(accept_ops) {
    if (!accept_ops.upgrade) {
        await socket.start(accept_ops.socket_id);
    }
    let protocol = accept_ops.protocol || "ws";
    let ws_obj = await _new_server_ws(accept_ops.socket_id, accept_ops.handle, protocol, accept_ops.tls_ctx);
    ws_obj.addr = accept_ops.addr;
    let on_warning = accept_ops.handle && accept_ops.handle[HANDLE_TYPE.WARNING];
    if (on_warning) {
        socket.warning(accept_ops.socket_id, (id, sz) => {
            on_warning(ws_obj, sz);
        });
    }
    let ok = true;
    let err;
    try {
        await _resolve_accept(ws_obj, accept_ops);
    }
    catch (e) {
        ok = false;
        err = e.message;
    }
    if (!ws_obj.is_close) {
        _close_websocket(ws_obj);
    }
    if (!ok) {
        if (err == http_helper.SOCKET_ERROR) {
            if (ws_obj.is_close) {
                _try_handle(ws_obj, HANDLE_TYPE.CLOSE);
            }
            else {
                _try_handle(ws_obj, HANDLE_TYPE.ERROR);
            }
        }
        else {
            return [false, err];
        }
    }
    return [true];
}
export async function connect(url, header, timeout) {
    let r = url.match(/^(wss?):\/\/([^\/]+)(.*)$/);
    if (!r) {
        throw new Error(`invalid url: ${url}`);
    }
    let [protocol, host, uri] = [r[1], r[2], r[3]];
    r = host.match(/^([^:]+):?(\d*)$/);
    if (!r) {
        throw new Error(`invalid host: ${host}`);
    }
    let host_name = r[1];
    let host_port = (protocol == "ws" ? 80 : 443);
    if (r[2]) {
        host_port = Number(r[2]);
    }
    uri = url || "/";
    let fd_id = await http_helper.connect(host_name, host_port, timeout);
    let ws_obj = await _new_client_ws(fd_id, protocol);
    ws_obj.addr = host;
    await _write_handshake(ws_obj, host_name, uri, header);
    return fd_id;
}
export async function read(id) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    let recv_count = 0;
    while (true) {
        let [fin, op, payload_data, payload_len] = await _read_frame(ws_obj, undefined, recv_count);
        recv_count += payload_len;
        if (op == OP_CODE.CLOSE) {
            _close_websocket(ws_obj);
            return [false, payload_data, recv_count];
        }
        else if (op == OP_CODE.PING) {
            _write_frame(ws_obj, OP_CODE.PONG, payload_data.subarray(0, payload_len), payload_len);
        }
        else if (op != OP_CODE.PONG) {
            if (fin) {
                return [true, payload_data, recv_count];
            }
        }
    }
}
export function write(id, data, sz, fmt, masking_key) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    fmt = fmt || OP_CODE.TEXT;
    skynet.assert(fmt == OP_CODE.TEXT || fmt == OP_CODE.BINARY);
    _write_frame(ws_obj, fmt, data, sz, masking_key);
}
export function ping(id) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    _write_frame(ws_obj, OP_CODE.PING);
}
export function addrinfo(id) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    return ws_obj.addr;
}
export function close(id, code, reason = "") {
    let ws_obj = ws_pool.get(id);
    if (!ws_obj) {
        return;
    }
    try {
        let payload_data;
        if (code) {
            let reason_buf = new TextEncoder().encode(reason);
            payload_data = new Uint8Array(2 + reason_buf.length);
            pack.encode_uint16(payload_data, 0, code);
            payload_data.set(reason_buf, 2);
        }
        _write_frame(ws_obj, OP_CODE.CLOSE, payload_data, payload_data ? payload_data.length : 0);
    }
    catch (e) {
        skynet.error(e.message);
    }
    _close_websocket(ws_obj);
}
export function get_sendbuffer(id) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    return [ws_obj.send_buffer || new Uint8Array(BUFFER_INIT_SIZE), SENDBUFFER_PRE_HEADER];
}
export function set_sendbuffer(id, buffer) {
    let ws_obj = skynet.assert(ws_pool.get(id));
    ws_obj.send_buffer = buffer;
}
