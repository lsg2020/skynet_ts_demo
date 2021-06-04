local skynet = require("skynet")
local amount = ...
amount = tonumber(amount)

skynet.start(function()

    print("======= begin test =======")
    
    local find_amount = 0
    local function isMunchausen(n)
        local sum, digit, acc = 0, 0, n
        while acc > 0 do
            digit = acc % 10.0
            sum = sum + digit ^ digit
            acc = acc // 10 -- integer div
        end
        return sum == n
    end

    local ts_begin = skynet.now() * 10;
    for i = 1, amount do
        if isMunchausen(i) then
            find_amount = find_amount + 1
        end
    end
    local ts_end = skynet.now() * 10;
    
    print(string.format("\n\nlua munchausen result:%d \tamount: %d\t\tms:%d\n\n", find_amount, amount, ts_end - ts_begin))
    print("======= end test =======")

end)