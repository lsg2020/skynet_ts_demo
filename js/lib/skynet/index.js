let skynet_rt = Deno.skynet;
let proto = Object.create(null);
let ptype = {
    // read skynet.h
    PTYPE_TEXT: 0,
    PTYPE_RESPONSE: 1,
    PTYPE_MULTICAST: 2,
    PTYPE_CLIENT: 3,
    PTYPE_SYSTEM: 4,
    PTYPE_HARBOR: 5,
    PTYPE_SOCKET: 6,
    PTYPE_ERROR: 7,
    PTYPE_QUEUE: 8,
    PTYPE_DEBUG: 9,
    PTYPE_LUA: 10,
    PTYPE_SNAX: 11,
    PTYPE_TRACE: 12,
};
let shared_bytes;
let session_id_coroutine = Object.create(null);
let dispatch_proto;
let dispatch_session = 0;
let dispatch_source = 0;
async function dispatch_message(prototype, session, source, sz, new_shared) {
    //console.log(prototype, session, source, sz, new_shared);
    if (!shared_bytes || new_shared) {
        shared_bytes = new Uint8Array(Deno.core.shared);
    }
    if (prototype == ptype.PTYPE_RESPONSE) {
        let response_func = session_id_coroutine[session];
        assert(response_func);
        delete session_id_coroutine[session];
        response_func([shared_bytes, sz]);
    }
    else {
        dispatch_proto = proto[prototype];
        dispatch_session = session;
        dispatch_source = source;
        assert(dispatch_proto);
        await dispatch_proto.dispatch(session, source, ...dispatch_proto.unpack(shared_bytes, sz));
    }
}
function start(start_func) {
    Deno.core.recv(dispatch_message);
    timeout(0, () => {
        init_service(start_func);
    });
}
function init_service(start) {
    try {
        start();
        send(".launcher", "lua", "LAUNCHOK");
    }
    catch (e) {
        skynet_rt.error(`init service failed: ${e} ${e.stack}`);
        send(".launcher", "lua", "ERROR");
        exit();
    }
}
function register_protocol(p) {
    let name = p.name;
    let id = p.id;
    assert(proto[name] == null && proto[id] == null);
    assert(typeof (name) == "string" && typeof (id) == "number" && id >= 0 && id <= 255);
    proto[name] = p;
    proto[id] = p;
}
function dispatch(name, func) {
    let p = proto[name];
    assert(p);
    if (func) {
        let ret = p.dispatch;
        p.dispatch = func;
        return ret;
    }
    else {
        return p && p.dispatch;
    }
}
function timeout(ti, func) {
    let session = Number(skynet_rt.command("TIMEOUT", ti).result);
    assert(session);
    assert(session_id_coroutine[session] == null);
    session_id_coroutine[session] = func;
}
function sleep(ti) {
    let promise = new Promise((resolve, reject) => {
        timeout(ti, resolve);
    });
    return promise;
}
function send(addr, typename, ...params) {
    let p = proto[typename];
    let pack = p.pack(...params) || [];
    return skynet_rt.send(addr, p.id, 0, ...pack);
}
async function call(addr, typename, ...params) {
    let p = proto[typename];
    let pack = p.pack(...params) || [];
    let session = skynet_rt.send(addr, p.id, null, ...pack);
    let response;
    let promise = new Promise((resolve, reject) => {
        response = resolve;
    });
    session_id_coroutine[session] = response;
    let [bytes, sz] = (await promise);
    return p.unpack(bytes, sz);
}
function exit() {
    skynet_rt.exit();
}
function assert(cond, msg) {
    if (!cond) {
        let err = msg ? new Error(`assert failed ${cond} ${msg}`) : new Error(`assert failed ${cond}`);
        throw err;
    }
}
function string_unpack(bytes, sz) {
    return [new TextDecoder().decode(bytes.slice(0, sz))];
}
function string_pack(msg) {
    return [new TextEncoder().encode(msg)];
}
import * as lua_seri from "lua_seri";
register_protocol({
    id: ptype.PTYPE_LUA,
    name: "lua",
    pack: lua_seri.encode,
    unpack: (bytes, sz) => { return lua_seri.decode(bytes, sz); },
    //unpack: () => {return []},
    dispatch: undefined,
});
register_protocol({
    id: ptype.PTYPE_TEXT,
    name: "text",
    pack: string_pack,
    unpack: string_unpack,
    dispatch: undefined,
});
function get_env(name, d) {
    return skynet_rt.get_env(name, d);
}
function now() {
    return skynet_rt.now();
}
function ret(pack) {
    let ret = skynet_rt.send(dispatch_source, ptype.PTYPE_RESPONSE, dispatch_session, pack);
    if (ret) {
        return true;
    }
    else if (ret === false) {
        skynet_rt.send(dispatch_source, ptype.PTYPE_ERROR, dispatch_session);
    }
    return false;
}
function retpack(...params) {
    let pack = dispatch_proto.pack(...params) || [];
    skynet_rt.send(dispatch_source, ptype.PTYPE_RESPONSE, dispatch_session, ...pack);
}
function response() {
    let source = dispatch_source;
    let session = dispatch_session;
    let p = dispatch_proto;
    return (...params) => {
        let pack = p.pack(...params) || [];
        skynet_rt.send(source, ptype.PTYPE_RESPONSE, session, ...pack);
    };
}
function register(name) {
    skynet_rt.command("REG", name);
}
export { ptype, assert, start, timeout, sleep, send, call, exit, register_protocol, dispatch, get_env, now, string_unpack, string_pack, ret, retpack, response, register, };
