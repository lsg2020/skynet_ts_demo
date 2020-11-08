import * as skynet from "skynet"

enum MSGID {
    add = "add",
    sleep = "sleep",
    call = "call",
}
interface MSGTYPE {
    [MSGID.add]: (a: number, b: number) => void,
    [MSGID.sleep]: (ti: number) => void,
    [MSGID.call]: (name: string, cmd: string, ...params: number[]) => void,
}

let handles = new Map<string, Function>();
function reg<K extends keyof MSGTYPE>(k: K, func: MSGTYPE[K]) {
    handles.set(k, func);
}

reg(MSGID.add, (a: number, b: number) => {
    skynet.retpack({result: a+ b}, a, b)
})

reg(MSGID.sleep, async (ti: number) => {
    let response = skynet.response()
    await skynet.sleep(ti)
    response(ti)
})

reg(MSGID.call, async (name: string, cmd: string, ...params: number[]) => {
    let response = skynet.response()
    let ret = await skynet.call(name, "lua", cmd, ...params)
    response(ret)
})

export function register(reg: Map<string, Function>) {
    for (let [k, fun] of handles) {
        reg.set(k, fun);
    }
}