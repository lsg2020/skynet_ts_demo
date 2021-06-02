local skynet = require("skynet")
skynet.start(function()
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/http")
end)