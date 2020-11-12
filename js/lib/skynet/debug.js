import * as skynet from "skynet";
import * as lua_seri from "lua_seri";
let extern_dbgcmd = new Map();
export function reg_debugcmd(name, fn) {
    let prev = extern_dbgcmd.get(name);
    extern_dbgcmd.set(name, fn);
    return prev;
}
let internal_info_func = undefined;
export function info_func(func) {
    let prev = internal_info_func;
    internal_info_func = func;
    return prev;
}
skynet.register_protocol({
    id: skynet.PTYPE_ID.DEBUG,
    name: skynet.PTYPE_NAME.DEBUG,
    pack: lua_seri.encode,
    unpack: lua_seri.decode,
    dispatch: _debug_dispatch,
});
let dbgcmd = new Map([
    [
        "MEM",
        (context) => {
            let mem = skynet.memory_info();
            skynet.retpack(context, Math.floor(mem.v8.total_heap_size / 1024));
        },
    ],
    [
        "GC",
        (context) => {
            skynet.retpack(context, true);
        },
    ],
    [
        "STAT",
        (context) => {
            skynet.retpack(context, {
                task: skynet.task(),
                mqlen: skynet.stat("mqlen"),
                cpu: skynet.stat("cpu"),
                message: skynet.stat("message"),
            });
        },
    ],
    [
        "TASK",
        (context) => {
            skynet.retpack(context, {});
        },
    ],
    [
        "INFO",
        async (context, ...params) => {
            if (internal_info_func) {
                skynet.retpack(context, await internal_info_func(...params));
            }
            else {
                skynet.retpack(context, null);
            }
        },
    ],
    [
        "EXIT",
        async (context, ...params) => {
            skynet.exit();
        },
    ],
    [
        "RUN",
        async (context, ...params) => {
            skynet.retpack(context, null);
        },
    ],
    [
        "TERM",
        async (context, ...params) => {
            skynet.term(params[0]);
        },
    ],
    [
        "SUPPORT",
        async (context, ...params) => {
            skynet.retpack(context, skynet.dispatch(params[0]));
        },
    ],
    [
        "PING",
        async (context, ...params) => {
            skynet.ret(context);
        },
    ],
    [
        "LINK",
        async (context, ...params) => {
            skynet.response(context);
        },
    ],
]);
async function _debug_dispatch(context, cmd, ...params) {
    let f = dbgcmd.get(cmd) || extern_dbgcmd.get(cmd);
    skynet.assert(f, cmd);
    await f(context, ...params);
}
