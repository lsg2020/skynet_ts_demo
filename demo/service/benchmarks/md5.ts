import * as skynet from "skynet"
import * as md5 from "skynet/crypt/md5"

skynet.start(() => {
    let [service_name, base_str, amount_str] = JS_INIT_ARGS.split(" ");
    let amount = Number(amount_str);

    console.log("======= begin test =======")

    let source_str:string[] = [];
    let dest: Int32Array[] = [];
    for (let i = 0; i < amount; i++) {
      source_str.push(base_str + i)
    }
  
    let ts_begin = Date.now();
    for (let k in source_str) {
      dest.push(md5.Md5.hashStr(source_str[k], true));
    }
    let ts_end = Date.now();
  
    console.log(`\n\nv8 md5 test \tamount:${amount}\t\tms:${ts_end - ts_begin}\n\n`);
    console.log("======= end test =======")
})