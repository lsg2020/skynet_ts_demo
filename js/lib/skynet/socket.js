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
    let id = skynet_rt.socket_listen(host, port, backlog || 32);
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
export function header(msg, len) {
    if (len > 4 || len < 1) {
        throw new Error(`Invalid read ${msg.slice(0, len)}`);
    }
    let sz = 0;
    for (let i = 0; i < len; i++) {
        sz <<= 8;
        sz |= msg[i];
    }
    return sz;
}
export async function read(id, sz) {
    let s = socket_pool.get(id);
    skynet.assert(s);
    let sb = s.buffer;
    if (!sz) {
        // read some bytes
        if (sb.size) {
            return [true, ..._read_all(sb)];
        }
        if (!s.connected) {
            return [false];
        }
        skynet.assert(!s.read_required);
        s.read_required = 0;
        await suspend(s);
        if (sb.size) {
            return [true, ..._read_all(sb)];
        }
        return [false];
    }
    let ret = _pop_buffer(sb, sz);
    if (ret) {
        return [true, ret, sz];
    }
    if (!s.connected) {
        return [false, ..._read_all(sb)];
    }
    skynet.assert(!s.read_required);
    s.read_required = sz;
    await suspend(s);
    ret = _pop_buffer(sb, sz);
    if (ret) {
        return [true, ret, sz];
    }
    else {
        return [false, ..._read_all(sb)];
    }
}
export async function readall(id) {
    let s = socket_pool.get(id);
    skynet.assert(s);
    let sb = s.buffer;
    if (!s.connecting) {
        return _read_all(sb);
    }
    skynet.assert(!s.read_required_skip);
    s.read_required = true;
    await suspend(s);
    skynet.assert(!s.connected);
    return _read_all(sb);
}
export async function readline(id, sep = '\n') {
    let s = socket_pool.get(id);
    skynet.assert(s);
    let ret = _read_line(s, false, sep);
    if (ret) {
        return [true, ...ret];
    }
    if (!s.connected) {
        return [false, ..._read_all(s.buffer)];
    }
    skynet.assert(!s.read_required_skip);
    s.read_required = sep;
    await suspend(s);
    if (s.connected) {
        return [true, ..._read_line(s, false, sep)];
    }
    else {
        return [false, ..._read_all(s.buffer)];
    }
}
let socket_pool = new Map();
let buffer_pool = new Array();
let socket_message = Object.create(null);
const SKYNET_SOCKET_TYPE_DATA = 1;
const SKYNET_SOCKET_TYPE_CONNECT = 2;
const SKYNET_SOCKET_TYPE_CLOSE = 3;
const SKYNET_SOCKET_TYPE_ACCEPT = 4;
const SKYNET_SOCKET_TYPE_ERROR = 5;
const SKYNET_SOCKET_TYPE_UDP = 6;
const SKYNET_SOCKET_TYPE_WARNING = 7;
socket_message[SKYNET_SOCKET_TYPE_DATA] = (id, size, data) => {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.error(`socket: drop package from ${id}`);
        _pack_drop(data, size);
        return;
    }
    let sz = _pack_push(s.buffer, data, size);
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
        if (rrt == "string" && _read_line(s, true, rr)) {
            // read line
            s.read_required = undefined;
            s.read_required_skip = undefined;
            wakeup(s);
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
    _shutdown(id);
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
    _pack_drop(data, size);
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
const LARGE_PAGE_NODE = 12;
function _pack_push(sb, data, sz) {
    let free_node = buffer_pool[0];
    if (!free_node) {
        let tsz = buffer_pool.length;
        if (tsz == 0) {
            tsz++;
        }
        let size = 8;
        if (tsz <= LARGE_PAGE_NODE - 3) {
            size <<= tsz;
        }
        else {
            size <<= LARGE_PAGE_NODE - 3;
        }
        let pool = _pool_new(size);
        free_node = pool;
        buffer_pool[tsz] = pool;
    }
    buffer_pool[0] = free_node.next;
    free_node.msg = data;
    free_node.sz = sz;
    free_node.next = undefined;
    if (!sb.head) {
        skynet.assert(!sb.tail);
        sb.head = free_node;
        sb.tail = free_node;
    }
    else {
        sb.tail.next = free_node;
        sb.tail = free_node;
    }
    sb.size += sz;
    return sb.size;
}
function _node_free(sb) {
    let free_node = sb.head;
    sb.offset = 0;
    sb.head = free_node.next;
    if (!sb.head) {
        sb.tail = undefined;
    }
    free_node.next = buffer_pool[0];
    skynet_rt.free(free_node.msg);
    free_node.msg = 0n;
    free_node.sz = 0;
    buffer_pool[0] = free_node;
}
function _pop_message(sb, sz, skip) {
    let read_sz = sz;
    let current = sb.head;
    if (sz < current.sz - sb.offset) {
        let msg = _pack_fetch(current.msg + BigInt(sb.offset), sz - skip);
        sb.offset += sz;
        sb.size -= read_sz;
        return msg;
    }
    if (sz == current.sz - sb.offset) {
        let msg = _pack_fetch(current.msg + BigInt(sb.offset), sz - skip);
        _node_free(sb);
        sb.size -= read_sz;
        return msg;
    }
    let msg = _pack_fetch_init(sz);
    let offset = 0;
    while (true) {
        let bytes = current.sz - sb.offset;
        if (bytes >= sz) {
            if (sz > skip) {
                let fetch_sz = sz - skip;
                _pack_fetch(current.msg + BigInt(sb.offset), fetch_sz, offset);
                offset += fetch_sz;
            }
            sb.offset += sz;
            if (bytes == sz) {
                _node_free(sb);
            }
            break;
        }
        let real_sz = sz - skip;
        if (real_sz > 0) {
            let fetch_sz = (real_sz < bytes) ? real_sz : bytes;
            _pack_fetch(current.msg + BigInt(sb.offset), fetch_sz, offset);
            offset += fetch_sz;
        }
        _node_free(sb);
        sz -= bytes;
        if (sz == 0) {
            break;
        }
        current = sb.head;
        skynet.assert(current);
    }
    sb.size -= read_sz;
    return msg;
}
function _pop_buffer(sb, sz) {
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    if (sb.size < sz || sz == 0) {
        return;
    }
    else {
        let msg = _pop_message(sb, sz, 0);
        return msg;
    }
}
function _read_all(sb, skip = 0, peek = false) {
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    let sb_offset = sb.offset;
    let sz = sb.size > skip ? sb.size - skip : 0;
    let msg = _pack_fetch_init(sz);
    let offset = 0;
    let current = sb.head;
    while (current) {
        let pack_sz = current.sz - sb_offset;
        if (skip < pack_sz) {
            _pack_fetch(current.msg + BigInt(sb_offset + skip), pack_sz - skip, offset);
            offset += pack_sz - skip;
        }
        skip = skip > pack_sz ? skip - pack_sz : 0;
        sb_offset = 0;
        current = current.next;
        if (!peek) {
            _node_free(sb);
        }
    }
    if (!peek) {
        sb.size = 0;
    }
    return [msg, sz];
}
function _read_line(s, check, sep) {
    let sb = s.buffer;
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    let current = sb.head;
    if (!current) {
        return false;
    }
    let sep_buffer = new TextEncoder().encode(sep); // TODO
    let find_index = -1;
    let skip = s.read_required_skip || 0;
    let [msg, sz] = _read_all(sb, skip, true);
    let check_end = (sz > sep_buffer.length ? sz - sep_buffer.length : 0);
    for (let i = 0; i < check_end; i++) {
        let match = true;
        for (let j = 0; j < sep_buffer.length; j++) {
            if (msg[i + j] != sep_buffer[j]) {
                match = false;
                break;
            }
        }
        if (match) {
            find_index = i + skip;
            break;
        }
    }
    if (check) {
        if (find_index >= 0) {
            return true;
        }
        else {
            s.read_required_skip = skip + (check_end ? check_end + 1 : 0);
            return false;
        }
    }
    else {
        if (find_index >= 0) {
            let msg = _pop_message(sb, find_index + sep_buffer.length, sep_buffer.length);
            return [msg, find_index];
        }
        else {
            return false;
        }
    }
}
function _buffer_free(s) {
    let sb = s.buffer;
    if (!sb) {
        return;
    }
    while (sb.head) {
        _node_free(sb);
    }
}
function _buffer_new() {
    let buffer = {
        size: 0,
        offset: 0,
    };
    return buffer;
}
function _pool_new(sz) {
    let pool = undefined;
    for (let i = 1; i < sz; i++) {
        pool = {
            msg: 0n,
            sz: 0,
            next: pool,
        };
    }
    return pool;
}
function _pack_drop(data, size) {
    skynet_rt.free(data);
}
function _pack_fetch_init(sz) {
    return skynet.fetch_message(0n, sz, 0, true);
}
function _pack_fetch(msg, sz, offset = 0) {
    return skynet.fetch_message(msg, sz, offset);
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
    if (!func) {
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
