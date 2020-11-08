local skynet = require "skynet"
require "skynet.manager"

local amount_pre_sec = 0;
local total = 0;
local begin_ts = 0;
local ts = 0;
skynet.start(function()
    skynet.dispatch("lua", function(session, source, ...)
        local now = skynet.now()
        amount_pre_sec = amount_pre_sec + 1
        total = total + 1

        if ts == 0 then
            ts = now
            begin_ts = now
        end
        
        if now - ts > 100 then
            print("lua msg per sec:", amount_pre_sec, total // ((now - begin_ts)//100))
            amount_pre_sec = 0
            ts = now
        end
    end)
    skynet.register(".testlua")
end)