local skynet = require("skynet")

skynet.start(function()

    print("----------------------- json test --------------------------")
    local json_amount = 100000
    skynet.newservice("benchmarks/json_lua", json_amount)
    skynet.newservice("benchmarks/json_cjson", json_amount)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/pure_js_json", json_amount)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/v8_json", json_amount)

    print("--------- Munchausen_numbers test (http://rosettacode.org/wiki/Munchausen_numbers) ----------")
    local munchausen_max_number = 5000000
    skynet.newservice("benchmarks/munchausen", munchausen_max_number);
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/munchausen", munchausen_max_number)

    print("--------- hash tables test (https://gist.github.com/spion/3049314) ----------")
    local hashtable_amount = 10000000
    skynet.newservice("benchmarks/hash_table", hashtable_amount)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/hash_table", hashtable_amount)

    print("----------------------- md5 test --------------------------")
    local md5_test_amount = 1000000
    local md5_base_str = "abcdefghijklmnopqrstuvwxyz012345678910"
    skynet.newservice("benchmarks/md5_luac", md5_base_str, md5_test_amount)
    skynet.call(".launcher", "lua" , "LAUNCH", "snjs", "benchmarks/md5", md5_base_str, md5_test_amount)
    skynet.newservice("benchmarks/md5_pure_lua", md5_base_str, 100);

end)