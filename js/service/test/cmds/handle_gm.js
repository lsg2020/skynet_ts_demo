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
reg(MSGID.add, (context, a, b) => {
    skynet.retpack(context, { result: a + b }, a, b);
});
reg(MSGID.sleep, async (context, ti) => {
    let response = skynet.response(context);
    await skynet.sleep(ti);
    response(true, ti);
});
reg(MSGID.call, async (context, name, cmd, ...params) => {
    let response = skynet.response(context);
    let ret = await skynet.call(name, "lua", cmd, ...params);
    response(true, ret);
});
export function register(reg) {
    for (let [k, fun] of handles) {
        reg.set(k, fun);
    }
}
