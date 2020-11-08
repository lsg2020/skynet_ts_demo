# skynet_ts_demo
* skynet_ts 测试示例 完善中
# build
* Rust `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
* TypeScript `npm install typescript -g`
* 配置http代理 编译google v8 例:
``` shell
export https_proxy=192.168.163.1:10809
export http_proxy=192.168.163.1:10809
```
* make
# 示例
``` typescript
import * as skynet from "skynet"

skynet.start(() => {
    skynet.dispatch("lua", (session: number, source: number, cmd: string, ...params: any) => {
        if (cmd == "hello") {
            return skynet.retpack("hello world");
        }

        console.log(`unknown cmd:${cmd}`);
    });
    skynet.register(".test")
})
```

``` lua
local test = skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "test")
local ret = skynet.call(test, "lua", "hello", 1, 2, 3, 4)
```
# 每秒lua消息测试
* lua 服务平均每秒处理消息数: 219844
* js 服务平均每秒处理消息数: 197587
