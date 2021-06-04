import * as skynet from "skynet"

skynet.start(() => {
    let [service_name, amount_str] = JS_INIT_ARGS.split(" ");
    let amount = Number(amount_str);

    console.log("======= begin test =======")

    let find_amount = 0;
    function isMunchausen1(n: number) {
        let sum = 0;
        let digit = 0;
        let acc = n;
        while (acc > 0) {
            digit = acc % 10
            sum = sum + Math.pow(digit, digit)
            acc = Math.floor(acc / 10)
        }
        return sum == n
    }

    let isMunchausen2 = (n: number) =>
        n.toString()
            .split('')
            .reduce(
                (a, c) => (
                    d => a + Math.pow(d, d)
                )(parseInt(c, 10)),
                0
            ) === n;

    let ts_begin = Date.now();
    for (let i = 1; i <= amount; i++) {
        if (isMunchausen1(i)) {
            find_amount++;
        }
    }
    let ts_end = Date.now();

    console.log(`\n\nv8 munchausen result:${find_amount} \tamount:${amount}\t\tms:${ts_end - ts_begin}\n\n`);
    console.log("======= end test =======")
})