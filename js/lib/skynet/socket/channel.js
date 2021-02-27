import * as socket from "skynet/socket";
import * as skynet from "skynet";
let socket_error = "SOCKET_ERROR";
export class Channel {
    constructor(ops) {
        this._closed = false;
        this._host = "";
        this._port = 0;
        this._socket = 0;
        this._dispatch_thread = false;
        this._request = new Array();
        this._thread = new Array();
        this._wait_response = 0;
        this._result = new Map();
        this._result_data = new Map();
        this._host = ops.host;
        this._port = ops.port;
        this._auth = ops.auth;
        this._backup = ops.backup;
        this._nodelay = ops.nodelay;
        this._response = ops.response;
    }
    async connect(once) {
        this._closed = false;
        return await this.block_connect(once);
    }
    async request(request, response, padding) {
        await this.block_connect(true);
        if (padding) {
            // padding may be a table, to support multi part request
            // multi part request use low priority socket write
            // now socket_lwrite returns as socket_write    
            if (!socket.lwrite(this._socket, request)) {
                this.sock_err();
            }
            padding.forEach((buff) => {
                if (!socket.lwrite(this._socket, buff)) {
                    this.sock_err();
                }
            });
        }
        else {
            if (!socket.write(this._socket, request)) {
                this.sock_err();
            }
        }
        if (!response) {
            // no response
            return;
        }
        return this.wait_for_response(response);
    }
    async response(response) {
        await this.block_connect();
        return this.wait_for_response(response);
    }
    close() {
        if (!this._closed) {
            this.term_dispatch_thread();
            this._closed = true;
            this.close_channel_socket();
        }
    }
    change_host(host, port) {
        this._host = host;
        if (port) {
            this._port = port;
        }
        if (!this._closed) {
            this.close_channel_socket();
        }
    }
    change_backup(backup) {
        this._backup = backup;
    }
    async read(sz, buffer, offset) {
        try {
            return await socket.read(this._socket, sz, buffer, offset);
        }
        catch (e) {
            throw new Error(socket_error);
        }
    }
    async readline(sep, buffer, offset) {
        try {
            return await socket.readline(this._socket, sep, buffer, offset);
        }
        catch (e) {
            throw new Error(socket_error);
        }
    }
    sock_err() {
        this.close_channel_socket();
        this.wakeup_all("");
        throw new Error(socket_error);
    }
    async wait_for_response(response) {
        let token = skynet.gen_token();
        this.push_response(response, token);
        await skynet.wait(token);
        let result = this._result.get(token);
        let result_data = this._result_data.get(token);
        this._result.delete(token);
        this._result_data.delete(token);
        if (result == socket_error) {
            throw new Error(result_data || socket_error);
        }
        else {
            skynet.assert(result, result_data);
            return result_data;
        }
    }
    close_channel_socket() {
        if (this._socket) {
            let sock = this._socket;
            this._socket = 0;
            socket.close(sock);
        }
    }
    wakeup_all(errmsg) {
        if (this._response) {
            this._thread.forEach((token) => {
                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);
            });
            this._thread = [];
        }
        else {
            this._request = [];
            this._thread.forEach((token) => {
                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);
            });
            this._thread = [];
        }
    }
    async dispatch_by_session() {
        let response = this._response;
        while (this._socket) {
            try {
                let [session, result_ok, result_data] = await response(this);
                let token = this._thread[session];
                if (token) {
                    delete this._thread[session];
                    this._result.set(token, result_ok);
                    this._result_data.set(token, result_data);
                    skynet.wakeup(token);
                }
                else {
                    delete this._thread[session];
                    skynet.error(`socket: unknown session ${session}`);
                }
            }
            catch (e) {
                this.close_channel_socket();
                let errmsg = "";
                if (e.message != socket_error) {
                    errmsg = e.message;
                }
                this.wakeup_all(errmsg);
            }
        }
    }
    async pop_response() {
        while (true) {
            if (this._request.length && this._thread.length) {
                return [this._request.shift(), this._thread.shift()];
            }
            this._wait_response = skynet.gen_token();
            await skynet.wait(this._wait_response);
        }
    }
    push_response(response, token) {
        if (this._response) {
            // response is session
            this._thread[response] = token;
        }
        else {
            // response is a function, push it to __request
            this._request.push(response);
            this._thread.push(token);
            if (this._wait_response) {
                let token = this._wait_response;
                this._wait_response = 0;
                skynet.wakeup(token);
            }
        }
    }
    async get_response(func) {
        let [result_ok, d] = await func(this);
        return [result_ok, d];
    }
    async dispatch_by_order() {
        while (this._socket) {
            let [func, token] = await this.pop_response();
            if (!token) {
                // close signal
                this.wakeup_all("channel_closed");
                break;
            }
            try {
                let [result_ok, result_data] = await this.get_response(func);
                this._result.set(token, result_ok);
                this._result_data.set(token, result_data);
                skynet.wakeup(token);
            }
            catch (e) {
                this.close_channel_socket();
                let errmsg = "";
                if (e.message != socket_error) {
                    errmsg = e.message;
                }
                this._result.set(token, socket_error);
                this._result_data.set(token, errmsg);
                skynet.wakeup(token);
                this.wakeup_all(errmsg);
            }
        }
    }
    term_dispatch_thread() {
        if (!this._response && this._dispatch_thread) {
            // dispatch by order, send close signal to dispatch thread
            this.push_response(0, 0);
        }
    }
    async connect_once() {
        if (this._closed) {
            return false;
        }
        let addr_list = new Array();
        let addr_set = new Set();
        let _add_backup = () => {
            this._backup && this._backup.forEach((addr) => {
                let host, port;
                if (typeof (addr) == "string") {
                    host = addr;
                    port = this._port;
                }
                else {
                    host = addr.host;
                    port = addr.port;
                }
                let hostkey = `${host}:${port}`;
                if (!addr_set.has(hostkey)) {
                    addr_set.add(hostkey);
                    addr_list.push({ host, port });
                }
            });
        };
        let _next_addr = () => {
            let addr = addr_list.shift();
            if (addr) {
                skynet.error(`socket: connect to backup host ${addr.host}:${addr.port}`);
            }
            return addr;
        };
        let _connect_once;
        _connect_once = async (addr) => {
            let fd = 0;
            let err;
            try {
                fd = await socket.open(addr.host, addr.port);
            }
            catch (e) {
                err = e;
            }
            if (!fd) {
                // try next one
                let addr = _next_addr();
                if (!addr) {
                    throw err;
                }
                return _connect_once(addr);
            }
            this._host = addr.host;
            this._port = addr.port;
            skynet.assert(!this._socket);
            this.term_dispatch_thread();
            this._nodelay && socket.nodelay(fd);
            // register overload warning
            if (this._overload_notify) {
                let overload_trigger = (id, size) => {
                    // TODO
                };
                socket.warning(fd, overload_trigger);
            }
            while (this._dispatch_thread) {
                await skynet.sleep(1);
            }
            this._socket = fd;
            this._dispatch_thread = true;
            let dispatch_fn = async () => {
                try {
                    if (this._response) {
                        await this.dispatch_by_session();
                    }
                    else {
                        await this.dispatch_by_order();
                    }
                }
                finally {
                    this._dispatch_thread = false;
                }
            };
            dispatch_fn();
            if (this._auth) {
                try {
                    await this._auth(this);
                    if (!this._socket) {
                        // auth may change host, so connect again
                        return this.connect_once();
                    }
                }
                catch (e) {
                    this.close_channel_socket();
                    if (e.message != socket_error) {
                        skynet.error(`socket: auth failed ${e.message}`);
                    }
                    // auth failed, try next addr
                    _add_backup();
                    let next_addr = _next_addr();
                    if (!next_addr) {
                        throw new Error(`no more backup host`);
                    }
                    return _connect_once(next_addr);
                }
            }
            return true;
        };
        _add_backup();
        return await _connect_once({ host: this._host, port: this._port });
    }
    async try_connect(once) {
        let t = 0;
        while (!this._closed) {
            try {
                await this.connect_once();
                if (!once) {
                    skynet.error(`socket: connect to ${this._host}:${this._port}`);
                }
                return;
            }
            catch (e) {
                if (once) {
                    return e.message;
                }
                skynet.error(`socket: connect ${e.message}`);
            }
            if (t > 1000) {
                skynet.error(`socket: try to reconnect ${this._host}:${this._port}`);
                await skynet.sleep(t);
                t = 0;
            }
            else {
                await skynet.sleep(t);
            }
            t += 100;
        }
    }
    check_connect() {
        if (this._socket) {
            if (socket.disconnected(this._socket)) {
                // closed by peer
                skynet.error(`socket: disconnect detected ${this._host}:${this._port}`);
                this.close_channel_socket();
                return;
            }
            return true;
        }
        if (this._closed) {
            return false;
        }
        return;
    }
    async block_connect(once) {
        let r = this.check_connect();
        if (r !== undefined) {
            return r;
        }
        let err;
        if (this._connecting) {
            let token = skynet.gen_token();
            this._connecting.push(token);
            await skynet.wait(token);
        }
        else {
            this._connecting = new Array();
            err = await this.try_connect(once);
            let connect_token = this._connecting;
            this._connecting = undefined;
            connect_token.forEach((token) => skynet.wakeup(token));
        }
        r = this.check_connect();
        if (r === undefined) {
            skynet.error(`Connect to ${this._host}:${this._port} ${err}`);
            throw new Error(err);
        }
        return r;
    }
}
