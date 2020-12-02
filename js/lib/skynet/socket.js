import * as skynet from "skynet";
let skynet_rt = Deno.skynet;
export var PROTOCOL_TYPE;
(function (PROTOCOL_TYPE) {
    PROTOCOL_TYPE["TCP"] = "TCP";
    PROTOCOL_TYPE["UDP"] = "UDP";
})(PROTOCOL_TYPE || (PROTOCOL_TYPE = {}));
// socket api
export async function open(addr, port) {
    [addr, port] = _address_port(addr, port);
    let socket_id = skynet_rt.socket_connect(addr, port);
    return await _connect(socket_id);
}
export async function bind(os_fd) {
    let id = skynet_rt.socket_bind(os_fd);
    return await _connect(id);
}
export async function stdin() {
    return await bind(0);
}
export async function start(id, func) {
    skynet_rt.socket_start(id);
    return await _connect(id, func);
}
export function shutdown(id) {
    let s = socket_pool.get(id);
    if (s) {
        _buffer_free(s);
        // the framework would send SKYNET_SOCKET_TYPE_CLOSE , need close(id) later
        skynet_rt.shutdown(id);
    }
}
export function close_fd(id) {
    skynet.assert(!socket_pool.has(id), "Use socket.close instead");
    skynet_rt.socket_close(id);
}
export async function close(id) {
    let s = socket_pool.get(id);
    if (!s) {
        return;
    }
    if (s.connecting) {
        skynet_rt.socket_close(id);
        if (s.suspend_token) {
            skynet.assert(!s.closing);
            s.closing = skynet.gen_token();
            await skynet.wait(s.closing);
        }
        else {
            await suspend(s);
        }
        s.connected = false;
    }
    _buffer_free(s);
    skynet.assert(!s.lock || !s.lock.length);
    socket_pool.delete(id);
}
export async function block(id) {
    let s = socket_pool.get(id);
    if (!s || !s.connected) {
        return false;
    }
    skynet.assert(!s.read_required);
    s.read_required = 0;
    await suspend(s);
    return s.connected;
}
export async function invalid(id) {
    return !socket_pool.has(id);
}
export function disconnected(id) {
    let s = socket_pool.get(id);
    if (s) {
        return !(s.connected || s.connecting);
    }
    return false;
}
export function listen(host, port, backlog) {
    if (!port) {
        [host, port] = _address_port(host, port);
        port = Number(port);
    }
    let id = skynet_rt.socket_listen(host, port, backlog || 0);
    if (id < 0) {
        skynet.error(`Listen error`);
    }
    return id;
}
export async function lock(id) {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.assert(false);
        return;
    }
    let lock_set = s.lock;
    if (!lock_set) {
        lock_set = [];
        s.lock = lock_set;
    }
    if (!lock_set.length) {
        lock_set.push(1);
    }
    else {
        let token = skynet.gen_token();
        lock_set.push(token);
        await skynet.wait(token);
    }
}
export async function unlock(id) {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.assert(false);
        return;
    }
    let lock_set = s.lock;
    lock_set.shift();
    if (lock_set[0]) {
        await skynet.wakeup(lock_set[0]);
    }
}
export function abandon(id) {
    let s = socket_pool.get(id);
    if (s) {
        _buffer_free(s);
        s.connected = false;
        wakeup(s);
        socket_pool.delete(id);
    }
}
export function limit(id, limit) {
    let s = socket_pool.get(id);
    if (s) {
        s.buffer_limit = limit;
    }
}
function create_udp_object(id, cb) {
    skynet.assert(!socket_pool.has(id), "socket is not closed");
    socket_pool.set(id, {
        id,
        connected: true,
        protocol: PROTOCOL_TYPE.UDP,
        callback: cb,
        connecting: false,
        suspend_token: 0,
    });
}
export function udp(callback, host, port) {
    let id = skynet_rt.socket_udp(host, port);
    create_udp_object(id, callback);
    return id;
}
export function udp_connect(id, host, port, callback) {
    let s = socket_pool.get(id);
    if (s) {
        skynet.assert(s.protocol == PROTOCOL_TYPE.UDP);
        if (callback) {
            s.callback = callback;
        }
    }
    else {
        create_udp_object(id, callback);
    }
    skynet_rt.socket_udp_connect(id, host, port);
}
export function warning(id, callback) {
    let s = socket_pool.get(id);
    let old;
    if (s) {
        old = s.on_warning;
        s.on_warning = callback;
    }
    return old;
}
let socket_pool = new Map();
let buffer_pool = {};
const SKYNET_SOCKET_TYPE_DATA = 1;
const SKYNET_SOCKET_TYPE_CONNECT = 2;
const SKYNET_SOCKET_TYPE_CLOSE = 3;
const SKYNET_SOCKET_TYPE_ACCEPT = 4;
const SKYNET_SOCKET_TYPE_ERROR = 5;
const SKYNET_SOCKET_TYPE_UDP = 6;
const SKYNET_SOCKET_TYPE_WARNING = 7;
let socket_message = Object.create(null);
socket_message[SKYNET_SOCKET_TYPE_DATA] = (id, size, data) => {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.error(`socket: drop package from ${id}`);
        _pack_drop(data, size);
        return;
    }
    let sz = _pack_push(s.buffer, buffer_pool, data, size);
    let rr = s.read_required;
    let rrt = typeof (rr);
    if (rrt == "number") {
        if (sz >= rr) {
            s.read_required = undefined;
            wakeup(s);
        }
    }
    else {
        if (s.buffer_limit && sz > s.buffer_limit) {
            skynet.error(`socket buffer overflow: fd=${id} size=${sz}`);
            _buffer_free(s);
            skynet_rt.socket_close(id);
            return;
        }
        if (rrt == "string") {
            // TODO read line
        }
    }
};
socket_message[SKYNET_SOCKET_TYPE_CONNECT] = (id, _ud, addr) => {
    let s = socket_pool.get(id);
    if (!s) {
        return;
    }
    // log remote addr
    s.connected = true;
    wakeup(s);
};
socket_message[SKYNET_SOCKET_TYPE_CLOSE] = (id) => {
    let s = socket_pool.get(id);
    if (!s) {
        return;
    }
    s.connected = false;
    wakeup(s);
};
socket_message[SKYNET_SOCKET_TYPE_ACCEPT] = (id, newid, addr) => {
    let s = socket_pool.get(id);
    if (!s) {
        _close(newid);
        return;
    }
    s.callback(newid, addr);
};
socket_message[SKYNET_SOCKET_TYPE_ERROR] = (id, _ud, err) => {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.error(`socket: error on unknown ${id} ${err}`);
        return;
    }
    if (s.connected) {
        skynet.error(`socket: error on ${id} ${err}`);
    }
    else if (s.connecting) {
        s.error = err;
    }
    s.connected = false;
    skynet_rt.socket_shutdown(id);
    wakeup(s);
};
socket_message[SKYNET_SOCKET_TYPE_UDP] = (id, size, data, address) => {
    let s = socket_pool.get(id);
    if (!s || !s.callback) {
        skynet.error(`socket: drop udp package from ${id}`);
        _pack_drop(data, size);
        return;
    }
    let msg = skynet.fetch_message(data, size);
    // TODO trash
    s.callback(msg, size, address);
};
socket_message[SKYNET_SOCKET_TYPE_WARNING] = (id, size) => {
    let s = socket_pool.get(id);
    if (s) {
        let warning = s.on_warning || _default_warning;
        warning(id, size);
    }
};
skynet.register_protocol({
    id: skynet.PTYPE_ID.SOCKET,
    name: skynet.PTYPE_NAME.SOCKET,
    unpack: skynet_rt.socket_unpack,
    dispatch: (context, type, id, ud, msg, udp_address) => {
        socket_message[type](id, ud, msg, udp_address);
    },
});
function wakeup(s) {
    let token = s.suspend_token;
    if (token) {
        s.suspend_token = 0;
        skynet.wakeup(token);
    }
}
async function suspend(s) {
    skynet.assert(!s.suspend_token);
    s.suspend_token = skynet.gen_token();
    await skynet.wait(s.suspend_token);
    if (s.closing) {
        skynet.wakeup(s.closing);
    }
}
function _pack_drop(data, size) {
    // TODO
}
function _pack_push(buffer, buffer_pool, data, size) {
    return 0;
}
function _buffer_free(s) {
    // TODO
}
function _buffer_new() {
    let buffer = {
        size: 0,
        offset: 0,
    };
    return buffer;
}
function _close(id) {
    skynet_rt.socket_close(id);
}
function _shutdown(id) {
    skynet_rt.socket_shutdown(id);
}
function _default_warning(id, size) {
    let s = socket_pool.get(id);
    if (!s) {
        return;
    }
    skynet.error(`WARNING: ${size} K bytes need to send out (fd = ${id})`);
}
function _error(s) {
    throw new Error(`unknwon socket error ${s.id} ${s.error}`);
}
async function _connect(id, func) {
    let buffer;
    if (func) {
        buffer = _buffer_new();
    }
    let s = {
        id,
        buffer,
        connected: false,
        connecting: true,
        callback: func,
        protocol: PROTOCOL_TYPE.TCP,
        error: undefined,
        suspend_token: 0,
    };
    skynet.assert(!socket_pool.has(id), "socket is not closed");
    socket_pool.set(id, s);
    await suspend(s);
    s.connecting = false;
    if (s.connected) {
        return id;
    }
    else {
        socket_pool.delete(id);
        _error(s);
        return 0;
    }
}
function _address_port(addr, port) {
    if (port) {
        return [addr, port];
    }
    let r;
    if (r = addr.match(/\[(.*)\]:(\d+)/)) {
        // is ipv6
        return [r[1], Number(r[2])];
    }
    else if (r = addr.match(/([^:]+):(\d+)/)) {
        // is ipv4
        return [r[1], Number(r[2])];
    }
    else {
        skynet.assert(false, `invalid addr ${addr}`);
        return ["", 0];
    }
}
