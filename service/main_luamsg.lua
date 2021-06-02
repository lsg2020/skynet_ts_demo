local skynet = require("skynet")
require "skynet.manager"

skynet.start(function()
    local test_time = 20*100

    print("test lua msg")
    local testlua = skynet.newservice("lua_msg_test")
    skynet.newservice("lua_msg_send", testlua, test_time)
    skynet.newservice("lua_msg_send", testlua, test_time)
    skynet.newservice("lua_msg_send", testlua, test_time)
    skynet.newservice("lua_msg_send", testlua, test_time)
    skynet.sleep(test_time+100)
    skynet.kill(testlua)

    skynet.sleep(500)

    print("test js msg")
    local testjs = skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/lua_msg")
    skynet.newservice("lua_msg_send", testjs, test_time)
    skynet.newservice("lua_msg_send", testjs, test_time)
    skynet.newservice("lua_msg_send", testjs, test_time)
    skynet.newservice("lua_msg_send", testjs, test_time)
    skynet.sleep(test_time+100)
    skynet.kill(testjs)
end)