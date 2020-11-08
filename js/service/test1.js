import * as skynet from "skynet";
let amount_pre_sec = 0;
let total = 0;
let begin_ts = 0;
let ts = 0;
skynet.start(() => {
    skynet.dispatch("lua", () => {
        amount_pre_sec++;
        total++;
        let now = skynet.now();
        if (ts == 0) {
            ts = now;
            begin_ts = now;
        }
        if (now - ts > 100) {
            console.log("js msg per sec:", amount_pre_sec, Math.floor(total / Math.floor((now - begin_ts) / 100)));
            amount_pre_sec = 0;
            ts = now;
        }
    });
    skynet.register(".testjs");
});
