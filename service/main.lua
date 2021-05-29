local skynet = require("skynet")
skynet.start(function()
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "grpc/grpc_server", 5022)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "grpc/grpc_client", 5022)
    skynet.sleep(300)
    
    skynet.dispatch("lua", function(session, source, cmd, ...)
        print("lua recv call", cmd, ...)
        skynet.retpack(...)
    end)

    local test = skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "test")
    local add_ret, a, b = skynet.call(".test", "lua", "add", 1, 100)
    assert(add_ret.result == 101 and a == 1 and b == 100)
    print("sleep", skynet.now())
    local sleep_ret = skynet.call(".test", "lua", "sleep", 100)
    assert(sleep_ret == 100)
    print("sleep_ret", skynet.now())
    local call_ret = skynet.call(".test", "lua", "call", skynet.self(), "test1234", 1, 2, 3, 4)
    assert(call_ret[1] == 1 and call_ret[4] == 4)    


    print("------------ test deno websocket")
    local ws_port = 5023
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "ws_server", ws_port)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "ws_client", ws_port)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "ws_client", ws_port)
end)