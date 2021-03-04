import * as skynet from "skynet";
import * as pack from "pack";
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
        skynet_rt.socket_shutdown(id);
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
export function udp(callback, host = "", port = 0) {
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
export async function read(id, sz, buffer, offset) {
    let s = socket_pool.get(id);
    skynet.assert(s);
    let sb = s.buffer;
    if (!sz) {
        // read some bytes
        if (sb.size) {
            return [true, ..._read_all(sb, 0, false, buffer, offset)];
        }
        if (!s.connected) {
            return [false];
        }
        skynet.assert(!s.read_required);
        s.read_required = 0;
        await suspend(s);
        if (sb.size) {
            return [true, ..._read_all(sb, 0, false, buffer, offset)];
        }
        return [false];
    }
    skynet.assert(sz > 0, "socket invalid read size");
    let ret = _pop_buffer(sb, sz, buffer, offset);
    if (ret) {
        return [true, ret, sz];
    }
    if (!s.connected) {
        return [false, ..._read_all(sb, 0, false, buffer, offset)];
    }
    skynet.assert(!s.read_required);
    s.read_required = sz;
    await suspend(s);
    ret = _pop_buffer(sb, sz, buffer, offset);
    if (ret) {
        return [true, ret, sz];
    }
    else {
        return [false, ..._read_all(sb, 0, false, buffer, offset)];
    }
}
export async function readall(id, buffer, offset) {
    let s = socket_pool.get(id);
    skynet.assert(s);
    let sb = s.buffer;
    if (!s.connecting) {
        return _read_all(sb, 0, false, buffer, offset);
    }
    skynet.assert(!s.read_required);
    s.read_required = true;
    await suspend(s);
    skynet.assert(!s.connected);
    return _read_all(sb, 0, false, buffer, offset);
}
export async function readline(id, sep = '\n', buffer, offset) {
    let sep_buffer = new TextEncoder().encode(sep);
    let s = socket_pool.get(id);
    skynet.assert(s);
    let ret = _read_line(s, false, sep_buffer, buffer, offset);
    if (ret) {
        return [true, ...ret];
    }
    if (!s.connected) {
        return [false, ..._read_all(s.buffer, 0, false, buffer, offset)];
    }
    skynet.assert(!s.read_required);
    s.read_required = sep_buffer;
    await suspend(s);
    if (s.connected) {
        return [true, ..._read_line(s, false, sep_buffer, buffer, offset)];
    }
    else {
        return [false, ..._read_all(s.buffer, 0, false, buffer, offset)];
    }
}
let text_encoder = new TextEncoder();
function get_buffer(buffer, sz) {
    let t = typeof (buffer);
    if (t == "bigint") {
        return [buffer, sz];
    }
    else if (t == "string") {
        return skynet_rt.socket_alloc_msg(text_encoder.encode(buffer));
    }
    else if (buffer instanceof Uint8Array) {
        return skynet_rt.socket_alloc_msg(buffer);
    }
    else {
        return skynet_rt.socket_alloc_msg(...buffer);
    }
}
export function write(id, buffer, sz) {
    let [msg, len] = get_buffer(buffer, sz);
    let err = skynet_rt.socket_send(id, msg, len);
    return !err;
}
export function lwrite(id, buffer, sz) {
    let [msg, len] = get_buffer(buffer, sz);
    let err = skynet_rt.socket_send_lowpriority(id, msg, len);
    return !err;
}
export function sendto(id, address, buffer, sz) {
    let [msg, len] = get_buffer(buffer, sz);
    let err = skynet_rt.socket_sendto(id, address, msg, len);
    return !err;
}
export function nodelay(id) {
    skynet_rt.socket_nodelay(id);
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
socket_message[SKYNET_SOCKET_TYPE_DATA] = (id, size, buffer, offset) => {
    let s = socket_pool.get(id);
    if (!s) {
        skynet.error(`socket: drop package from ${id}`);
        //_pack_drop(data, size);
        return;
    }
    let msg = buffer.slice(offset, offset + size);
    let sz = _pack_push(s.buffer, msg);
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
        if (rr instanceof Uint8Array && _read_line(s, true, rr)) {
            // read line
            s.read_required = undefined;
            s.read_required_skip = undefined;
            wakeup(s);
        }
    }
};
socket_message[SKYNET_SOCKET_TYPE_CONNECT] = (id, _ud, buffer, offset) => {
    let s = socket_pool.get(id);
    if (!s) {
        return;
    }
    let [addr] = pack.decode_str(buffer, offset, 2, true);
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
socket_message[SKYNET_SOCKET_TYPE_ACCEPT] = (id, newid, buffer, offset) => {
    let s = socket_pool.get(id);
    if (!s) {
        _close(newid);
        return;
    }
    let [addr] = pack.decode_str(buffer, offset, 2, true);
    s.callback(newid, addr);
};
socket_message[SKYNET_SOCKET_TYPE_ERROR] = (id, _ud, buffer, offset) => {
    let [err] = pack.decode_str(buffer, offset, 2, true);
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
socket_message[SKYNET_SOCKET_TYPE_UDP] = (id, size, buffer, offset) => {
    let s = socket_pool.get(id);
    if (!s || !s.callback) {
        skynet.error(`socket: drop udp package from ${id}`);
        //_pack_drop(data, size);
        return;
    }
    let msg = buffer.slice(offset, offset + size);
    let [address] = pack.decode_str(buffer, offset + size, 2, true);
    //_pack_drop(data, size);
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
    unpack: (buf, offset, sz) => {
        return [skynet_rt.socket_unpack(skynet.get_cur_msgptr(), sz)];
    },
    dispatch: (context, is_new_bs) => {
        let buffer = skynet.get_shared_bs(is_new_bs);
        let offset = 0;
        let type = pack.decode_uint32(buffer, offset, true);
        offset += 4;
        let id = pack.decode_uint32(buffer, offset, true);
        offset += 4;
        let ud = pack.decode_uint32(buffer, offset, true);
        offset += 4;
        socket_message[type](id, ud, buffer, offset);
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
function _pack_push(sb, data) {
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
    free_node.buffer = data;
    free_node.sz = data.length;
    //free_node.buffer = skynet.fetch_message(data, sz, 0, free_node.buffer);
    //skynet_rt.free(data);
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
    sb.size += data.length;
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
    free_node.buffer = undefined;
    free_node.sz = 0;
    buffer_pool[0] = free_node;
}
function _pop_message(sb, sz, skip, buffer, offset) {
    offset = offset || 0;
    let read_sz = sz;
    let current = sb.head;
    if (sz < current.sz - sb.offset) {
        let msg = _pack_fetch(current.buffer, sb.offset, sz - skip, buffer, offset);
        sb.offset += sz;
        sb.size -= read_sz;
        return msg;
    }
    if (sz == current.sz - sb.offset) {
        let msg = _pack_fetch(current.buffer, sb.offset, sz - skip, buffer, offset);
        _node_free(sb);
        sb.size -= read_sz;
        return msg;
    }
    let msg = _pack_fetch_init(sz, buffer, offset);
    while (true) {
        let bytes = current.sz - sb.offset;
        if (bytes >= sz) {
            if (sz > skip) {
                let fetch_sz = sz - skip;
                _pack_fetch(current.buffer, sb.offset, fetch_sz, msg, offset);
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
            _pack_fetch(current.buffer, sb.offset, fetch_sz, msg, offset);
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
function _pop_buffer(sb, sz, buffer, offset) {
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    if (sb.size < sz || sz == 0) {
        return;
    }
    else {
        let msg = _pop_message(sb, sz, 0, buffer, offset);
        return msg;
    }
}
function _read_all(sb, skip = 0, peek = false, buffer, offset) {
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    let sb_offset = sb.offset;
    let sz = sb.size > skip ? sb.size - skip : 0;
    offset = offset || 0;
    let msg = _pack_fetch_init(sz, buffer, offset);
    let current = sb.head;
    while (current) {
        let pack_sz = current.buffer.length - sb_offset;
        if (skip < pack_sz) {
            _pack_fetch(current.buffer, sb_offset + skip, pack_sz - skip, msg, offset);
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
function _read_line(s, check, sep_buffer, buffer, offset) {
    offset = offset || 0;
    let sb = s.buffer;
    if (!sb) {
        throw new Error(`Need buffer object at param 1`);
    }
    let current = sb.head;
    if (!current) {
        return false;
    }
    let find_index = -1;
    let skip = s.read_required_skip || 0;
    let [msg, sz] = _read_all(sb, skip, true, buffer, offset);
    let check_end = (sz >= sep_buffer.length ? sz - sep_buffer.length + 1 : 0);
    for (let i = 0; i < check_end; i++) {
        let match = true;
        for (let j = 0; j < sep_buffer.length; j++) {
            if (msg[i + j + offset] != sep_buffer[j]) {
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
            s.read_required_skip = skip + check_end;
            return false;
        }
    }
    else {
        if (find_index >= 0) {
            let msg = _pop_message(sb, find_index + sep_buffer.length, sep_buffer.length, buffer, offset);
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
            sz: 0,
            next: pool,
        };
    }
    return pool;
}
function _pack_drop(data, size) {
    skynet_rt.free(data);
}
function _pack_fetch_init(sz, buffer, buffer_offset = 0) {
    if (buffer) {
        return skynet.alloc_buffer(sz + buffer_offset, buffer);
    }
    else {
        return skynet.alloc_buffer(sz + buffer_offset, true);
    }
}
function _pack_fetch(msg, msg_offset, sz, buffer, buffer_offset = 0) {
    //return skynet.fetch_message(msg, sz, buffer_offset, false, buffer);
    buffer = skynet.alloc_buffer(sz + buffer_offset, buffer);
    if (sz < 64) {
        buffer_offset = buffer_offset || 0;
        for (let i = 0; i < sz; i++) {
            buffer[buffer_offset + i] = msg[msg_offset + i];
        }
    }
    else {
        buffer.set(msg.subarray(msg_offset, msg_offset + sz), buffer_offset || 0);
    }
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
