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

# ubuntu编译
* `apt install autoconf autogen gcc g++ python openssl libssl-dev pkg-config build-essential libglib2.0-dev npm`
* Rust `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
* TypeScript `npm install typescript -g`
* 配置http代理 编译google v8 例:
``` shell
export https_proxy=192.168.163.1:10809
export http_proxy=192.168.163.1:10809
```
* clone && make

# windows编译 比较麻烦可以考虑编译好的[文件](https://github.com/lsg2020/skynet_ts_demo/releases)
* 环境配置
    * 安装[rust](https://www.rust-lang.org/learn/get-started)
    * 安装[msys2](https://www.msys2.org/) `pacman -S libreadline-devel base-devel gcc git python`
    * 安装[vs2019](https://visualstudio.microsoft.com/zh-hans/downloads/) 
        * `MSVC v142 - VS 2019 C++ x64/x86 build tools` 
        * `Windows 10 SDK` 
        * `英文语言包`
    * [win10 sdk](https://developer.microsoft.com/en-us/windows/downloads/windows-10-sdk/)
    * 安装[vcpkg](https://github.com/microsoft/vcpkg) `vcpkg install openssl:x86-windows-static`
    * 配置代理
```
set https_proxy=192.168.163.1:10809
set http_proxy=192.168.163.1:10809
```
    * `msys2_shell.cmd` 开启 `set MSYS2_PATH_TYPE=inherit`
* 编译
    * 执行 `msys2_shell.cmd` 
        * `git clone https://github.com/lsg2020/skynet_ts_demo`
        * 编译skynet mingw版本 `cd skynet_ts_demo && make -f win.mk`
    * 编译skynet_ts windows版本 `cd skynet_ts && set V8_FROM_SOURCE=1 && cargo build --release && copy target\release\sndeno.dll ..\build\cservice\snjs.so /y`
* 测试 `.\build\skynet config`
