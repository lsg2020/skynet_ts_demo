import * as skynet from "skynet"
import * as debug from "skynet/debug"

let amount_pre_sec = 0;
let total = 0;
let begin_ts = 0;
let ts = 0;

skynet.start(() => {
    let service_name = JS_INIT_ARGS.split(" ")[0];
    debug.v8inspector.enable(service_name);

    skynet.dispatch("lua", () => {
        amount_pre_sec++;
        total++;
        let now = skynet.now();

        if (ts == 0) {
            ts = now;
            begin_ts = now;
        }

        if (now - ts > 100) {
            console.log("js msg per sec:", amount_pre_sec, Math.floor(total / Math.floor((now - begin_ts)/100)), skynet.memory_info());
            amount_pre_sec = 0;
            ts = now;
        }
    });
    skynet.register(".testjs");
})