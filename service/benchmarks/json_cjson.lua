local skynet = require("skynet")
local amount = ...
amount = tonumber(amount)

skynet.start(function()

    print("======= begin test =======")
    
    local json = require("cjson")
    local result = {}

    local ts_begin = skynet.now() * 10;
    for i = 1, amount do
        local r = json.decode(string.format('{"a": 1234, "b": [1, 2, 3, 4, %d], "c": {"a": 1234, "b": [1, 2, 3, 4], "c": {}}}', i))
        table.insert(result, r)
    end
    local ts_end = skynet.now() * 10;
    
    print(string.format("\n\ncjson.so json decode result \tamount: %d\t\tms:%d\n\n", #result, ts_end - ts_begin))
    print("======= end test =======")

end)