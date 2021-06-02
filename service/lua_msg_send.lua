local skynet = require "skynet"

local name, count = ...

skynet.start(function()
    skynet.fork(function()
        for i = 1, count do
            local test_array = {1,2,3,4,5,6,7,8,9,10}
            for _=1, 1000 do
                --[[
                skynet.send(name, "lua", "abcdef", "1234", 
                {90000, 80000, 70000, 600000}, 
                {a = 1234, b = {c = 432111}, d = "123456789"},
                test_array
                )
                -- ]]
                skynet.send(name, "lua", {1,2,3,4})
    
                if #test_array < 50 then
                    table.insert(test_array, #test_array)
                end    
                --skynet.sleep(500)
            end
    
            skynet.sleep(1)
        end
    end)
end)