local skynet    = require "skynet"
local socket    = require "skynet.socket"
require "skynet.manager"

local router        = require "router"
local http_helper   = require "http_helper"
local websocket     = require "http.websocket"

local listen_addr = ...
local listen_ip, listen_port = listen_addr:match("([^:]+):(%d+)")

local PTYPE_INSPECT = 101

local services = {}

local command = {}
function command.enable(addr, name, listen_addr)
    print("v8_inspector enable:", addr)
    if services[addr] then
        skynet.retpack(
            skynet.self(), 
            PTYPE_INSPECT, 
            string.format("ws://localhost:%s/pause/%s", listen_port, addr),
            string.format("ws://localhost:%s/resume/%s", listen_port, addr)
        )
        return;    
    end
    local http_socket = socket.listen(listen_addr:match("([^:]+):(%d+)"))

    local service = {
        addr = addr,
        name = name,
        listen_addr = listen_addr,
        sessions = {},
        websockets = {},
        http_socket = http_socket,
    }
    services[addr] = service;

    local close_ws = function(id)
        local session_id = service.websockets[id]
        if not session_id then return end

        skynet.send(service.addr, "debug", "v8inspector", "disconnect", session_id)

        service.websockets[id] = nil
        service.sessions[session_id] = nil

        if next(service.sessions) == nil and service.proxy then
            websocket.write(service.proxy, "quit", "text")
            socket.close(service.proxy)
            service.proxy = nil
        end
    end

    local handler = {
        connect = function(id)
            print("connect", id)
            local session_id = skynet.call(service.addr, "debug", "v8inspector", "connect", id)
            assert(session_id ~= 0)
            service.sessions[session_id] = id
            service.websockets[id] = session_id
        end,
        message = function(id, msg)
            -- print("message", id, msg)
            if service.proxy then
                websocket.write(service.proxy, service.websockets[id]..msg, "text")
            else
                skynet.send(service.addr, "debug", "v8inspector", "msg", service.websockets[id], msg)
            end
        end,
        close = function(id)
            print("close", id)
            close_ws(id)
        end,
        error = function(id)
            print("error", id)
            close_ws(id)    
        end,
    }

    local devtools = string.format("devtools://devtools/bundled/inspector.html?v8only=true&ws=%s/ws/%s", listen_addr, addr)
    service.devtools = devtools
    local debug_template = {
        ["_DEBUG_ID_"] = string.format("%d", addr),
        ["_DEBUG_NAME_"] = string.format("%s:%s", name, addr),
        ["_DEBUG_ADDR_"] = string.format("%s/ws/%s", listen_addr, addr),
        ["_DEBUG_DEVTOOLS_"] = devtools,
    }
    local template = [[
        {
            "type": "node",
            "id": "_DEBUG_ID_",
            "title": "_DEBUG_NAME_ debug tools for V8",
            "devtoolsFrontendUrl": "_DEBUG_DEVTOOLS_",
            "devtoolsFrontendUrlCompat": "_DEBUG_DEVTOOLS_",
            "webSocketDebuggerUrl": "ws://_DEBUG_ADDR_"
        }
    ]]
    for k, v in pairs(debug_template) do
        template = string.gsub(template, k, v)
    end

    local http_router = router.new()
    http_router:get("/ws/:addr", function(request)
        local addr = tonumber(request.addr)
        assert(addr == service.addr)
        return http_helper.upgrade(handler, request)
    end)
    http_router:get("/json", function(request)
        http_helper.response(request.id, 200, "[" .. template .. "]")
    end)
    http_router:get("/json/version", function(request)
        http_helper.response(request.id, 200, [[
            {
                "Browser": "skynet_ts/0.1.0",
                "Protocol-Version": "1.3"
            } 
        ]])
    end)

    socket.start(http_socket, function(id, addr)
        socket.start(id)
        skynet.fork(http_helper.dispatch, http_router, id, addr)
    end)

    skynet.retpack(
        skynet.self(), 
        PTYPE_INSPECT, 
        string.format("ws://localhost:%s/pause/%s", listen_port, addr),
        string.format("http://localhost:%s/resume/%s", listen_port, addr)
    )

    skynet.fork(function()
        local ok, xx = pcall(skynet.call, addr, "debug", "LINK")
        command.disable(addr)
    end)
end

function command.disable(addr)
    print("v8_inspector disable:", addr)
    local service = services[addr]
    if not service then
        return
    end

    services[addr] = nil
    socket.close(service.http_socket)
    if service.proxy then
        socket.close(service.proxy)
    end
    for session_id in pairs(service.sessions) do
        skynet.send(addr, "debug", "v8inspector", "disconnect", session_id)
    end
    for ws_id in pairs(service.websockets) do
        socket.close(ws_id)
    end
end

skynet.register_protocol({
    name = "v8inspector",
    id = PTYPE_INSPECT,
    unpack = skynet.tostring,
    dispatch = function(session, source, msg)
        local index, index_end = string.find(msg, "{")
        local session_id = tonumber(string.sub(msg, 1, index-1))
        local msg = string.sub(msg, index_end)
        local service = services[source]
        if not service then return end
        local ws_id = service.sessions[session_id]
        if not ws_id then return end

        -- print(ws_id, type(ws_id), #msg, msg)
        websocket.write(ws_id, msg, "text")
    end
})


local http_router = router.new()
http_router:get("/", function(request)
    local template = [[
<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>skynet_ts inspect</title>
</head>
<body>
  <div id="content"></div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    document.getElementById('content').innerHTML =
      marked(`_CONTENT_`);
  </script>
</body>
</html>
    ]]

    local contents = {"# skynet_ts inspect"}
    for _, service in pairs(services) do
        table.insert(contents, string.format("## [%s:%s](%s)\n* %s\n* %s\n", service.name, service.addr, service.devtools, service.listen_addr, service.devtools))
    end
    http_helper.response(request.id, 200, string.gsub(template, "_CONTENT_", table.concat(contents, "\n")))
end)
http_router:get("/pause/:addr", function(request)
    local addr = tonumber(request.addr)
    local service = services[addr]
    if not service then
        return http_helper.response(request.id, 404, string.format("service %s disable v8inspect", addr))
    end

    local handler = {
        connect = function(id)
            print("pause connect", id)
            service.proxy = request.id
        end,
        close = function(id)
            print("pause close", id)
            service.proxy = nil
        end,
        error = function(id)
            print("pause error", id)
            service.proxy = nil
        end,
        message = function(id, msg)
            print("pause message", id, msg)
        end,
    }
    return http_helper.upgrade(handler, request)
end)

http_router:get("/resume/:addr", function(request)
    print("resume", request.addr)
    local addr = tonumber(request.addr)
    local service = services[addr]
    assert(service)

    local proxy = service.proxy
    service.proxy = nil

    websocket.write(proxy, "quit", "text")
    socket.close(proxy)
    http_helper.response(request.id, 200, "ok")
end)

skynet.start(function ()
    local http_socket = socket.listen(listen_ip, listen_port)
    socket.start(http_socket, function(id, addr)
        socket.start(id)
        skynet.fork(http_helper.dispatch, http_router, id, addr)
    end)

    skynet.dispatch("lua", function(_, _, cmd, ...)
        local f = assert(command[cmd], cmd)
        f(...)
    end)

    skynet.register(".v8_inspector")
end)
