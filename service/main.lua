local skynet = require "skynet"
require "skynet.manager"

skynet.start(function()

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

    skynet.kill(test)
    skynet.sleep(200)

    print("test lua msg")
    local testlua = skynet.newservice("test1")
    skynet.newservice("test_send", testlua, 2000)
    skynet.newservice("test_send", testlua, 2000)
    skynet.newservice("test_send", testlua, 2000)
    skynet.sleep(2000)
    skynet.kill(testlua)

    skynet.sleep(500)

    print("test js msg")
    local testjs = skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "test1")
    skynet.newservice("test_send", testjs, 2000)
    skynet.newservice("test_send", testjs, 2000)
    skynet.newservice("test_send", testjs, 2000)
    skynet.sleep(2000)
    skynet.kill(testjs)

end)