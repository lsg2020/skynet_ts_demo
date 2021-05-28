import * as skynet from "skynet"
import * as debug from "skynet/debug"
import * as handle_gm from "cmds/handle_gm"

let handles = new Map<string, Function>();
handle_gm.register(handles);

async function dispatch_lua(context: skynet.CONTEXT, cmd: string, ...params: any) {
    let handle = handles.get(cmd);
    //console.trace()
    skynet.assert(handle, `not exists cmd:${cmd}`);
    await handle!(context, ...params);
}

WebAssembly.compile(new Uint8Array(`
  00 61 73 6d  01 00 00 00  01 0c 02 60  02 7f 7f 01
  7f 60 01 7f  01 7f 03 03  02 00 01 07  10 02 03 61
  64 64 00 00  06 73 71 75  61 72 65 00  01 0a 13 02
  08 00 20 00  20 01 6a 0f  0b 08 00 20  00 20 00 6c
  0f 0b`.trim().split(/[\s\r\n]+/g).map(str => parseInt(str, 16))
)).then(module => {
  const instance = new WebAssembly.Instance(module)
  const { add, square } = instance.exports

  console.log('wasm test: 2 + 4 =', (add as any)(2, 4))
  console.log('wasm test: 3^2 =', (square as any)(3))
  console.log('wasm test: (2 + 5)^2 =', (square as any)((add as any)(2 + 5)))
})


async function test() {
    let amount = 0;
    while (true) {
        let a = 1234;
        a = a + 1;
        let b = 4321;
        
        console.log(amount++, skynet.now());
        await skynet.sleep(700);
        let c = a + b;
        c = 0;
    }
}
skynet.start(async () => {
    let service_name = JS_INIT_ARGS.split(" ")[0];
    debug.v8inspector.enable(service_name);

    skynet.dispatch("lua", dispatch_lua);
    skynet.register(".test")
    //test()
})