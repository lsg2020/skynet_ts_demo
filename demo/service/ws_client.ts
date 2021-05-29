import * as skynet from "skynet"

let sleep = (ms: number) => {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

skynet.start(async () => {
    let [service_name, port] = JS_INIT_ARGS.split(" ");

    let data = await fetch("https://www.baidu.com");
    console.log(data);

    let ws = new WebSocket(`ws://localhost:${port}`);
    ws.onopen = async () => {
        for (let i=0; i<100; i++) {
            ws.send(`test send msg ${i}`)
            await sleep(1000);
        }
    };
    ws.onmessage = (msg) => console.log(skynet.self(), "recv msg:", msg.data);
})