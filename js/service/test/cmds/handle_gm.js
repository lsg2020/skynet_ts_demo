import * as skynet from "skynet";
var MSGID;
(function (MSGID) {
    MSGID["add"] = "add";
    MSGID["sleep"] = "sleep";
    MSGID["call"] = "call";
})(MSGID || (MSGID = {}));
let handles = new Map();
function reg(k, func) {
    handles.set(k, func);
}
reg(MSGID.add, (a, b) => {
    skynet.retpack({ result: a + b }, a, b);
});
reg(MSGID.sleep, async (ti) => {
    let response = skynet.response();
    await skynet.sleep(ti);
    response(ti);
});
reg(MSGID.call, async (name, cmd, ...params) => {
    let response = skynet.response();
    let ret = await skynet.call(name, "lua", cmd, ...params);
    response(ret);
});
export function register(reg) {
    for (let [k, fun] of handles) {
        reg.set(k, fun);
    }
}
