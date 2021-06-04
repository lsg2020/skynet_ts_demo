local skynet = require("skynet")
local amount = ...
amount = tonumber(amount)

skynet.start(function()

    print("======= begin test =======")
    
    local text = {"The", "quick", "brown", "fox", "jumped", "over", "the", "lazy", "dog", "at", "a", "restaurant", "near", "the", "lake", "of", "a", "new", "era"}
    local map = {}
    local times = amount
    local n = #text

    local ts_begin = skynet.now() * 10;
    for i = 1, n do
        map[text[i]] = 1
        for _ = 1, times do  
            map[text[i]] = map[text[i]] + 1
        end
    end
    local ts_end = skynet.now() * 10;

    --for i = 1, n do
    --    io.write(text[i], " ", map[text[i]], "\n")
    --end
    
    print(string.format("\n\nlua hash table result \tamount: %d\t\tms:%d\n\n", amount, ts_end - ts_begin))
    print("======= end test =======")

end)