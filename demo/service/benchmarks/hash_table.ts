import * as skynet from "skynet"

skynet.start(() => {
    let [service_name, amount_str] = JS_INIT_ARGS.split(" ");
    let amount = Number(amount_str);

    console.log("======= begin test =======")

    const text = ["The", "quick", "brown", "fox", "jumped", "over", "the", "lazy", "dog", "at", "a", "restaurant", "near", "the", "lake", "of", "a", "new", "era"];
    const map = new Map();
    const times = amount;

    let ts_begin = Date.now();
    let c = 0;
    for (var k = 0; k < text.length; k++) {
        c = 1;
        for (let i = 0; i < times; i++) {
            c++;
        }
        map.set(text[k], c);
    }

    //for (var key of text) {
    //    console.log(key, map.get(key));
    //}
    let ts_end = Date.now();

    console.log(`\n\nv8 hash table test \tamount:${amount}\t\tms:${ts_end - ts_begin}\n\n`);
    console.log("======= end test =======")
})