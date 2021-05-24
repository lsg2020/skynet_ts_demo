# skynet_ts_demo
* skynet_ts 测试示例


# 快速开始
* 构建参见`build`或使用编译好的cservice文件[snjs.so](https://github.com/lsg2020/skynet_ts/releases/download/0.1.0/snjs.so),并将`snjs.so`文件放在cservice搜索目录下
* skynet
    * v8虚拟机切换线程会恢复数据，消息频繁时这里可以优化提升性能[参见](https://github.com/lsg2020/skynet/commit/220654849aee414b274ff9ab6ad0a05daed1c84d),[临时测试](https://github.com/lsg2020/skynet_ts/releases/download/0.1.0/snjs.so)可忽略
    * skynet_ts在deno异步事件返回时会通知skynet消息,使用消息类型`234`,与项目中类型冲突时也可[修改](https://github.com/lsg2020/skynet_ts/blob/4789e7eaaaee8dd47e25bcf37032d2e8ae6e2c1e/src/interface.rs#L96)
* skynet config配置
    * `js_loader`: js服务入口文件,例如:`./js/skynet_ts/ts/lib/loader.js`,[loader](https://github.com/lsg2020/skynet_ts/blob/master/ts/lib/loader.ts)生成的js对应路径
    * `jslib`: js库搜索路径,例如:`js/demo/lib/?.js;js/demo/lib/?/index.js;js/skynet_ts/ts/lib/?.js;js/skynet_ts/ts/lib/?/index.js;js/skynet_ts/ts/lib/skynet/?.js;js/skynet_ts/ts/lib/skynet/?/index.js`
    * `jsservice`: js服务搜索路径,例如:`js/demo/service/?.js;js/demo/service/?/main.js;js/skynet_ts/ts/service/?.js;js/skynet_ts/ts/service/?/main.js`
* 启动js服务 `skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "test")`
* 使用skynet消息接口
``` ts
import * as skynet from "skynet"
skynet.start(async () => {
    skynet.dispatch("lua", async (context: skynet.CONTEXT, cmd: string, ...params: any) => {
        console.log(cmd);
    });
    skynet.register(".test")
})
```
* 使用deno接口
``` ts
import * as skynet from "skynet"
import * as uuid from "std/uuid/mod"
skynet.start(async () => {
    let data = await fetch("https://www.baidu.com");
    console.log(data);
    console.log(WebSocket);
    console.log(uuid.v4.generate());
})
```

# build on ubuntu
* `apt install autoconf autogen gcc g++ python openssl libssl-dev pkg-config build-essential libglib2.0-dev`
* Rust `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
* TypeScript `npm install typescript -g`
* 配置http代理 编译google v8 例:
``` shell
export https_proxy=192.168.163.1:10809
export http_proxy=192.168.163.1:10809
```
* make
