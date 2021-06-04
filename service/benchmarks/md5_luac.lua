local skynet = require("skynet")
local base_str, amount = ...
amount = tonumber(amount)

skynet.start(function()

    print("======= begin test =======")
    
    local md5 = require("md5.core")
    local source_str = {}
    for i = 1, amount do
        table.insert(source_str, base_str .. i)
    end

    local ts_begin = skynet.now() * 10;
    for k, v in ipairs(source_str) do
        source_str[k] = md5.sum(v)
    end
    local ts_end = skynet.now() * 10;
    
    print(string.format("\n\nlua md5.so result \tamount: %d\t\tms:%d\n\n", amount, ts_end - ts_begin))
    print("======= end test =======")

end)