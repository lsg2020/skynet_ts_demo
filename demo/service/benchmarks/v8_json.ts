import * as skynet from "skynet"

skynet.start(() => {
    let [service_name, amount_str] = JS_INIT_ARGS.split(" ");
    let amount = Number(amount_str);

    console.log("======= begin test =======")
    
    let result: any[] = [];
    let ts_begin = Date.now();
    for (let i = 1; i <= amount; i++) {
        let r = JSON.parse(`{"a": 1234, "b": [1, 2, 3, 4, ${i}], "c": {"a": 1234, "b": [1, 2, 3, 4], "c": {}}}`)
        result.push(r)
    }
    let ts_end = Date.now();

    console.log(`\n\nv8 json decode result \tamount:${result.length}\t\tms:${ts_end - ts_begin}\n\n`);
    console.log("======= end test =======")
})