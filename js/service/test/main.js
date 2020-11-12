import * as skynet from "skynet";
import * as handle_gm from "cmds/handle_gm";
let handles = new Map();
handle_gm.register(handles);
function dispatch_lua(context, cmd, ...params) {
    let handle = handles.get(cmd);
    console.trace();
    skynet.assert(handle, `not exists cmd:${cmd}`);
    handle(context, ...params);
}
skynet.start(() => {
    skynet.dispatch("lua", dispatch_lua);
    skynet.register(".test");
});
