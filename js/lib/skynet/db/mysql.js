import * as skynet from "skynet";
import * as socket_channel from "skynet/socket/channel";
import * as pack from "pack";
import * as crypt from "crypt";
import { utf8 } from "utf8";
let CHARSET_MAP = new Map([
    ["_default", 0],
    ["big5", 1],
    ["dec8", 3],
    ["cp850", 4],
    ["hp8", 6],
    ["koi8r", 7],
    ["latin1", 8],
    ["latin2", 9],
    ["swe7", 10],
    ["ascii", 11],
    ["ujis", 12],
    ["sjis", 13],
    ["hebrew", 16],
    ["tis620", 18],
    ["euckr", 19],
    ["koi8u", 22],
    ["gb2312", 24],
    ["greek", 25],
    ["cp1250", 26],
    ["gbk", 28],
    ["latin5", 30],
    ["armscii8", 32],
    ["utf8", 33],
    ["ucs2", 35],
    ["cp866", 36],
    ["keybcs2", 37],
    ["macce", 38],
    ["macroman", 39],
    ["cp852", 40],
    ["latin7", 41],
    ["utf8mb4", 45],
    ["cp1251", 51],
    ["utf16", 54],
    ["utf16le", 56],
    ["cp1256", 57],
    ["cp1257", 59],
    ["utf32", 60],
    ["binary", 63],
    ["geostd8", 92],
    ["cp932", 95],
    ["eucjpms", 97],
    ["gb18030", 248],
]);
var FieldType;
(function (FieldType) {
    FieldType["OK"] = "OK";
    FieldType["ERR"] = "ERR";
    FieldType["EOF"] = "EOF";
    FieldType["DATA"] = "DATA";
})(FieldType || (FieldType = {}));
;
const COM_QUERY = new Uint8Array([0x03]);
const COM_PING = new Uint8Array([0x0e]);
const COM_STMT_PREPARE = new Uint8Array([0x16]);
const COM_STMT_EXECUTE = new Uint8Array([0x17]);
const COM_STMT_CLOSE = new Uint8Array([0x19]);
const COM_STMT_RESET = new Uint8Array([0x1a]);
const CURSOR_TYPE_NO_CURSOR = 0x00;
const SERVER_MORE_RESULT_EXISTS = 8;
let converters = new Map([
    [0x01, Number],
    [0x02, Number],
    [0x03, Number],
    [0x04, Number],
    [0x05, Number],
    [0x08, Number],
    [0x09, Number],
    [0x0d, Number],
    [0xf6, Number],
]);
class ResultError extends Error {
    constructor(msg, errno, sqlstate) {
        super(msg);
        this.msg = msg;
        this.errno = errno;
        this.sqlstate = sqlstate;
    }
}
;
export class Mysql {
    constructor(ops) {
        this.max_packet_size = 0;
        this.protocol_ver = 0;
        this.server_ver = "";
        this.server_capabilities = 0;
        this.server_lang = 0;
        this.server_status = 0;
        this.packet_no = 0;
        this.compact = false;
        this.max_packet_size = ops.max_packet_size || 1024 * 1024; // default 1MB
        this.compact = ops.compact || false;
        this.channel = new socket_channel.Channel({
            host: ops.host,
            port: ops.port || 3306,
            overload: ops.overload,
            auth: this._mysql_login(ops.user || "", ops.password || "", CHARSET_MAP.get(ops.charset) || 33, ops.database || "", ops.on_connect),
        });
    }
    static async connect(ops) {
        let mysql = new Mysql(ops);
        // try connect first only once
        await mysql.connect(true);
        return mysql;
    }
    async connect(once) {
        await this.channel.connect(once);
    }
    disconnect() {
        this.channel.close();
    }
    async query(query) {
        let query_buff;
        if (typeof (query) == "string") {
            query_buff = new TextEncoder().encode(query);
        }
        else {
            query_buff = query;
        }
        let query_packet = this._compose_com_packet(COM_QUERY, query_buff);
        let channel = this.channel;
        if (!this.query_resp) {
            this.query_resp = this._query_resp();
        }
        return await channel.request(query_packet, this.query_resp);
    }
    async prepare(sql) {
        let query_buff;
        if (typeof (sql) == "string") {
            query_buff = new TextEncoder().encode(sql);
        }
        else {
            query_buff = sql;
        }
        let query_packet = this._compose_com_packet(COM_STMT_PREPARE, query_buff);
        let channel = this.channel;
        if (!this.prepare_resp) {
            this.prepare_resp = this._prepare_resp();
        }
        return await channel.request(query_packet, this.prepare_resp);
    }
    async execute(stmt, ...params) {
        let query_packet;
        try {
            query_packet = this._compose_stmt_execute(stmt, CURSOR_TYPE_NO_CURSOR, ...params);
        }
        catch (e) {
            return {
                badresult: true,
                errno: 30902,
                err: e.message,
            };
        }
        let channel = this.channel;
        if (!this.execute_resp) {
            this.execute_resp = this._execute_resp();
        }
        return channel.request(query_packet, this.execute_resp);
    }
    async stmt_reset(stmt) {
        let packet = this._packet_alloc();
        packet.buffer(COM_STMT_RESET, 0);
        packet.uint32(stmt.prepare_id, true);
        let query = this._compose_packet(packet);
        if (!this.query_resp) {
            this.query_resp = this._query_resp();
        }
        return this.channel.request(query, this.query_resp);
    }
    async stmt_close(stmt) {
        let packet = this._packet_alloc();
        packet.buffer(COM_STMT_CLOSE, 0);
        packet.uint32(stmt.prepare_id, true);
        let query = this._compose_packet(packet);
        return this.channel.request(query);
    }
    async ping() {
        let packet = this._compose_com_packet(COM_PING);
        let channel = this.channel;
        if (!this.query_resp) {
            this.query_resp = this._query_resp();
        }
        return channel.request(packet, this.query_resp);
    }
    static _from_length_coded_bin(data, pos) {
        let first = pack.decode_uint8(data, pos, true);
        if (first === undefined) {
            return [pos, undefined];
        }
        if (first >= 0 && first <= 250) {
            return [pos + 1, first];
        }
        if (first == 251) {
            return [pos + 1, undefined];
        }
        if (first == 252) {
            return [pos + 3, pack.decode_uint(data, pos + 1, 2, true)];
        }
        if (first == 253) {
            return [pos + 4, pack.decode_uint(data, pos + 1, 3, true)];
        }
        if (first == 254) {
            return [pos + 9, pack.decode_uint(data, pos + 1, 8, true)];
        }
        return [pos + 1, undefined];
    }
    static _set_length_code_bin(data, n) {
        if (n < 251) {
            data.uint8(n, true);
            return;
        }
        if (n < (1 << 16)) {
            data.uint8(0xfc, true);
            data.uint(n, 2, true);
            return;
        }
        if (n < (1 << 24)) {
            data.uint8(0xfd, true);
            data.uint(n, 3, true);
            return;
        }
        data.uint8(0xfe, true);
        data.uint(n, 8, true);
        return;
    }
    static _from_length_coded_buffer(data, pos) {
        let len;
        [pos, len] = Mysql._from_length_coded_bin(data, pos);
        if (len === undefined) {
            return [pos, pos];
        }
        return [pos, pos + len];
    }
    static _from_length_coded_str(data, pos) {
        let [start, end] = Mysql._from_length_coded_buffer(data, pos);
        return [end, pack.sub_str(data, start, end)];
    }
    _packet_alloc() {
        let packet = new pack.encoder();
        packet.reserve(4);
        return packet;
    }
    _compose_packet(packet) {
        this.packet_no++;
        if (this.packet_no > 255) {
            this.packet_no = 0;
        }
        let buffer = packet.finish();
        let size = buffer.length - 4;
        let pos = 0;
        pack.encode_uint(buffer, pos, size, 3, true);
        pos += 3;
        pack.encode_uint8(buffer, pos, this.packet_no, true);
        pos += 1;
        return buffer;
    }
    async _recv_packet(sock) {
        let [ok, msg, sz] = await sock.read(4);
        if (!ok) {
            throw new Error("failed to receive packet header");
        }
        let len = pack.decode_uint(msg, 0, 3, true);
        if (len == 0) {
            throw new Error("empty packet");
        }
        this.packet_no = pack.decode_uint8(msg, 3, true);
        [ok, msg, sz] = await sock.read(len);
        if (!ok) {
            throw new Error("failed to read packet content");
        }
        let field_count = pack.decode_uint8(msg, 0, true);
        let type;
        if (field_count == 0x00) {
            type = FieldType.OK;
        }
        else if (field_count == 0xff) {
            type = FieldType.ERR;
        }
        else if (field_count == 0xfe) {
            type = FieldType.EOF;
        }
        else {
            type = FieldType.DATA;
        }
        return [msg.subarray(0, sz), type];
    }
    _compute_token(password, scramble1, scramble2) {
        if (password == "") {
            return new Uint8Array(0);
        }
        let stage1 = crypt.sha1(password);
        let stage2 = crypt.sha1(stage1);
        let temp = new Uint8Array(scramble1.length + scramble2.length + stage2.length);
        temp.set(scramble1, 0);
        temp.set(scramble2, scramble1.length);
        temp.set(stage2, scramble1.length + scramble2.length);
        let stage3 = crypt.sha1(temp);
        let r = stage3;
        for (let i = 0; i < r.length; i++) {
            r[i] = r[i] ^ stage1[i];
        }
        return r;
    }
    _parse_ok_packet(packet) {
        let res = { server_status: 0, warning_count: 0 };
        let pos = 1;
        [pos, res.affected_rows] = Mysql._from_length_coded_bin(packet, pos);
        [pos, res.insert_id] = Mysql._from_length_coded_bin(packet, pos);
        res.server_status = pack.decode_uint16(packet, pos, true);
        pos += 2;
        res.warning_count = pack.decode_uint16(packet, pos, true);
        pos += 2;
        let message = pack.sub_str(packet, pos);
        if (message && message != "") {
            res.message = message;
        }
        return res;
    }
    _parse_eof_packet(packet) {
        let pos = 1;
        let warning_count;
        let status_flags;
        warning_count = pack.decode_uint16(packet, pos, true);
        pos += 2;
        status_flags = pack.decode_uint16(packet, pos, true);
        pos += 2;
        return [warning_count, status_flags];
    }
    _parse_err_packet(packet) {
        let pos = 1;
        let errno = pack.decode_uint16(packet, pos, true);
        pos += 2;
        let marker = pack.sub_str(packet, pos, pos + 1);
        let sqlstate;
        if (marker == '#') {
            // with sqlstate
            pos += 1;
            sqlstate = pack.sub_str(packet, pos, pos + 5);
            pos += 5;
        }
        let message = pack.sub_str(packet, pos);
        return [errno, message, sqlstate];
    }
    _parse_result_set_header_packet(packet) {
        let field_count;
        let extra;
        let pos = 0;
        [pos, field_count] = Mysql._from_length_coded_bin(packet, pos);
        [pos, extra] = Mysql._from_length_coded_bin(packet, pos);
        return [field_count || 0, extra || 0, pos];
    }
    _parse_field_packet(data) {
        let catalog;
        let db;
        let table;
        let orig_table;
        let orig_name;
        let charsetnr;
        let length;
        let flags;
        let col_name;
        let col_type;
        let col_is_signed = false;
        let pos = 0;
        [pos, catalog] = Mysql._from_length_coded_str(data, pos);
        [pos, db] = Mysql._from_length_coded_str(data, pos);
        [pos, table] = Mysql._from_length_coded_str(data, pos);
        [pos, orig_table] = Mysql._from_length_coded_str(data, pos);
        [pos, col_name] = Mysql._from_length_coded_str(data, pos);
        [pos, orig_name] = Mysql._from_length_coded_str(data, pos);
        pos += 1;
        charsetnr = pack.decode_uint16(data, pos, true);
        pos += 2;
        length = pack.decode_uint32(data, pos, true);
        pos += 4;
        col_type = pack.decode_uint8(data, pos, true);
        pos += 1;
        pos += 1;
        flags = pack.decode_uint16(data, pos, true);
        pos += 2;
        if ((flags & 0x20) == 0) {
            col_is_signed = true;
        }
        return {
            name: col_name,
            type: col_type,
            is_signed: col_is_signed,
        };
    }
    _parse_row_data_packet(data, cols, compact) {
        let pos = 0;
        let row = compact ? new Array() : new Map();
        cols.forEach((col) => {
            let value;
            let start;
            [start, pos] = Mysql._from_length_coded_buffer(data, pos);
            if (start !== undefined) {
                let conv = converters.get(col.type);
                if (conv) {
                    value = conv(pack.sub_str(data, start, pos));
                }
                else {
                    value = data.slice(start, pos);
                }
            }
            if (compact) {
                row.push(value);
            }
            else {
                row.set(col.name, value);
            }
        });
        return row;
    }
    async _recv_field_packet(sock) {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }
        if (type != FieldType.DATA) {
            throw new ResultError(`bad field packet type: ${type}`);
        }
        return this._parse_field_packet(packet);
    }
    _recv_decode_packet_resp() {
        return async (sock) => {
            let packet, type;
            try {
                [packet, type] = await this._recv_packet(sock);
            }
            catch (e) {
                return [false, `failed to receive the result pack ${e.message}`];
            }
            if (type == FieldType.ERR) {
                let [errno, msg, sqlstate] = this._parse_err_packet(packet);
                return [false, `errno:${errno} msg:${msg} sqlstate:${sqlstate}`];
            }
            if (type == FieldType.EOF) {
                return [false, `old pre-4.1 authentication protocol not supported`];
            }
            return [true, packet];
        };
    }
    _mysql_login(user, password, charset, database, on_connect) {
        return async (sockchannel) => {
            let dispatch_resp = this._recv_decode_packet_resp();
            let packet = await sockchannel.response(dispatch_resp);
            let pos = 0;
            this.protocol_ver = pack.decode_uint8(packet, pos, true);
            pos += 1;
            let server_ver = pack.sub_str(packet, pos, packet.indexOf(0, pos));
            if (!server_ver) {
                throw new Error(`bad handshake initialization packet: bad server version`);
            }
            this.server_ver = server_ver;
            pos += server_ver.length + 1;
            let thread_id = pack.decode_uint32(packet, pos, true);
            pos += 4;
            //let scramble1 = pack.sub_str(packet, pos, pos + 8);
            let scramble1 = packet.slice(pos, pos + 8);
            if (scramble1.length != 8) {
                throw new Error(`1st part of scramble not found`);
            }
            pos += 9;
            this.server_capabilities = pack.decode_uint16(packet, pos, true);
            pos += 2;
            this.server_lang = pack.decode_uint8(packet, pos, true);
            pos += 1;
            this.server_status = pack.decode_uint16(packet, pos, true);
            pos += 2;
            let more_capabilities = pack.decode_uint16(packet, pos, true);
            pos += 2;
            this.server_capabilities = this.server_capabilities | more_capabilities << 16;
            let len = 21 - 8 - 1;
            pos = pos + 1 + 10;
            //let scramble_part2 = pack.sub_str(packet, pos, pos+len);
            let scramble_part2 = packet.slice(pos, pos + len);
            if (scramble_part2.length != len) {
                throw new Error(`2nd part of scramble not found`);
            }
            //let scramble = scramble1 + scramble_part2;
            let token = this._compute_token(password, scramble1, scramble_part2);
            let client_flags = 260047;
            let req = this._packet_alloc();
            req.uint32(client_flags, true);
            req.uint32(this.max_packet_size, true);
            req.uint8(charset, true);
            req.reserve(23);
            req.cstring(user);
            req.buffer(token, 1);
            req.cstring(database);
            let auth_packet = this._compose_packet(req);
            await sockchannel.request(auth_packet, dispatch_resp);
            if (on_connect) {
                on_connect(this);
            }
        };
    }
    _compose_com_packet(type, ...reqs) {
        this.packet_no = -1;
        let packet = this._packet_alloc();
        packet.buffer(type, 0);
        reqs.forEach((req) => packet.buffer(req, 0));
        return this._compose_packet(packet);
    }
    async _read_result(sock) {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }
        if (type == FieldType.OK) {
            let res = this._parse_ok_packet(packet);
            return [res, ((res.server_status & SERVER_MORE_RESULT_EXISTS) != 0)];
        }
        if (type != FieldType.DATA) {
            throw new ResultError(`packet type ${type} not supported`);
        }
        let [field_count, extra] = this._parse_result_set_header_packet(packet);
        let cols = new Array();
        for (let i = 0; i < field_count; i++) {
            cols[i] = await this._recv_field_packet(sock);
        }
        let [packet_eof, type_eof] = await this._recv_packet(sock);
        if (type_eof != FieldType.EOF) {
            throw new ResultError(`unexpected packet type ${type} while eof packet is expected`);
        }
        let compact = this.compact;
        let rows = new Array();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                let [warning_count, status_flags] = this._parse_eof_packet(packet);
                if ((status_flags & SERVER_MORE_RESULT_EXISTS) != 0) {
                    return [rows, true];
                }
                break;
            }
            rows.push(this._parse_row_data_packet(packet, cols, compact));
        }
        return [rows, false];
    }
    _query_resp() {
        return async (sock) => {
            let res;
            let again;
            try {
                [res, again] = (await this._read_result(sock));
                if (!again) {
                    return [true, res];
                }
            }
            catch (e) {
                if (e instanceof ResultError) {
                    return [true, {
                            badresult: true,
                            err: e.message,
                            errno: e.errno,
                            sqlstate: e.sqlstate,
                        }];
                }
                return [false, e.message];
            }
            let multi_resultset = [res];
            do {
                try {
                    let rows;
                    [rows, again] = (await this._read_result(sock));
                    multi_resultset.push(rows);
                }
                catch (e) {
                    if (e instanceof ResultError) {
                        return [true, {
                                badresult: true,
                                err: e.message,
                                errno: e.errno,
                                sqlstate: e.sqlstate,
                            }];
                    }
                    return [false, e.message];
                }
            } while (again);
            return [true, multi_resultset];
        };
    }
    async _read_prepare_result(sock) {
        let packet;
        let type;
        try {
            [packet, type] = await this._recv_packet(sock);
        }
        catch (e) {
            return [false, {
                    badresult: true,
                    errno: 300101,
                    err: e.message,
                }];
        }
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            return [true, {
                    badresult: true,
                    errno: errno,
                    err: msg,
                    sqlstate: sqlstate,
                }];
        }
        if (type != FieldType.OK) {
            return [false, {
                    badresult: true,
                    errno: 300201,
                    err: `first typ must be OK,now ${type}`,
                }];
        }
        let pos = 1;
        let resp = {};
        resp.prepare_id = pack.decode_uint32(packet, pos, true);
        pos += 4;
        resp.field_count = pack.decode_uint16(packet, pos, true);
        pos += 2;
        resp.param_count = pack.decode_uint16(packet, pos, true);
        pos += 2;
        pos += 1;
        resp.warning_count = pack.decode_uint16(packet, pos, true);
        pos += 2;
        resp.params = new Array();
        resp.fields = new Array();
        if (resp.param_count > 0) {
            while (true) {
                try {
                    let col = await this._recv_field_packet(sock);
                    resp.params.push(col);
                }
                catch (e) {
                    break;
                }
            }
        }
        if (resp.field_count > 0) {
            while (true) {
                try {
                    let col = await this._recv_field_packet(sock);
                    resp.fields.push(col);
                }
                catch (e) {
                    break;
                }
            }
        }
        return [true, resp];
    }
    _prepare_resp() {
        return async (sock) => {
            return this._read_prepare_result(sock);
        };
    }
    _compose_stmt_execute(stmt, cursor_type, ...args) {
        let arg_num = args.length;
        if (arg_num != stmt.param_count) {
            throw new Error(`require stmt.param_count ${stmt.param_count} get arg_num: ${arg_num}`);
        }
        this.packet_no = -1;
        let cmd_packet = this._packet_alloc();
        cmd_packet.buffer(COM_STMT_EXECUTE, 0);
        cmd_packet.uint32(stmt.prepare_id, true);
        cmd_packet.uint8(cursor_type, true);
        cmd_packet.uint32(0x01, true);
        if (arg_num > 0) {
            let null_count = Math.floor((arg_num + 7) / 8);
            let field_index = 0;
            for (let i = 0; i < null_count; i++) {
                let byte = 0;
                for (let j = 0; j < 8; j++) {
                    if (field_index < arg_num) {
                        if (args[field_index] === undefined) {
                            byte |= (1 << j);
                        }
                    }
                    field_index++;
                }
                cmd_packet.uint8(byte, true);
            }
            cmd_packet.uint8(0x01, true);
            for (let i = 0; i < arg_num; i++) {
                let v = args[i];
                let f = Mysql._store_types.get(typeof (v));
                if (!f) {
                    throw new Error(`invalid parameter type ${typeof (v)}`);
                }
                f[0](cmd_packet, v);
            }
            for (let i = 0; i < arg_num; i++) {
                let v = args[i];
                let f = Mysql._store_types.get(typeof (v));
                if (f) {
                    f[1](cmd_packet, v);
                }
            }
        }
        return this._compose_packet(cmd_packet);
    }
    static _get_datetime(data, pos) {
        let len;
        let value;
        [pos, len] = Mysql._from_length_coded_bin(data, pos);
        if (len == 7) {
            let year = pack.decode_uint16(data, pos, true);
            pos += 2;
            let month = pack.decode_uint8(data, pos, true);
            pos += 1;
            let day = pack.decode_uint8(data, pos, true);
            pos += 1;
            let hour = pack.decode_uint8(data, pos, true);
            pos += 1;
            let minute = pack.decode_uint8(data, pos, true);
            pos += 1;
            let second = pack.decode_uint8(data, pos, true);
            pos += 1;
            value = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
        }
        else {
            value = "2012-05-12 00:00:00";
            // unsupported format
            pos += len;
        }
        return [pos, value];
    }
    static _get_buffer(data, pos) {
        let start;
        [start, pos] = Mysql._from_length_coded_buffer(data, pos);
        return [pos, data.slice(start, pos)];
    }
    _parse_row_data_binary(data, cols, compact) {
        let ncols = cols.length;
        let null_count = Math.floor((ncols + 9) / 8);
        let pos = 1 + null_count;
        let null_fields = [];
        let field_index = 0;
        for (let i = 1; i < pos; i++) {
            let byte = pack.decode_uint8(data, i, true);
            for (let j = 0; j < 8; j++) {
                if (field_index > 2) {
                    null_fields[field_index - 2] = ((byte & (1 << j)) != 0);
                }
                field_index++;
            }
        }
        let row = compact ? new Array() : new Map();
        let value;
        for (let i = 0; i < ncols; i++) {
            let col = cols[i];
            if (!null_fields[i]) {
                let parse = Mysql._binary_parse.get(col.type);
                if (!parse) {
                    throw new Error(`_parse_row_data_binary() error, unsupported field type ${col.type}`);
                }
                [pos, value] = parse(data, pos /*, col.is_signed*/);
                if (compact) {
                    row[i] = value;
                }
                else {
                    row.set(col.name, value);
                }
            }
        }
        return row;
    }
    async _read_execute_result(sock) {
        let [packet, type] = await this._recv_packet(sock);
        if (type == FieldType.ERR) {
            let [errno, msg, sqlstate] = this._parse_err_packet(packet);
            throw new ResultError(msg, errno, sqlstate);
        }
        if (type == FieldType.OK) {
            let res = this._parse_ok_packet(packet);
            return [res, ((res.server_status & SERVER_MORE_RESULT_EXISTS) != 0)];
        }
        if (type != FieldType.DATA) {
            throw new ResultError(`packet type ${type} not supported`);
        }
        let [field_count, extra] = this._parse_result_set_header_packet(packet);
        let cols = new Array();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                this._parse_eof_packet(packet);
                break;
            }
            cols.push(this._parse_field_packet(packet));
        }
        if (cols.length < 1) {
            return [[], false];
        }
        let compact = this.compact;
        let rows = new Array();
        while (true) {
            let [packet, type] = await this._recv_packet(sock);
            if (type == FieldType.EOF) {
                let [warning_count, status_flags] = this._parse_eof_packet(packet);
                if ((status_flags & SERVER_MORE_RESULT_EXISTS) != 0) {
                    return [rows, true];
                }
                break;
            }
            rows.push(this._parse_row_data_binary(packet, cols, compact));
        }
        return [rows, false];
    }
    _execute_resp() {
        return async (sock) => {
            let res;
            let again;
            try {
                [res, again] = (await this._read_execute_result(sock));
                if (!again) {
                    return [true, res];
                }
            }
            catch (e) {
                if (e instanceof ResultError) {
                    return [true, {
                            badresult: true,
                            err: e.message,
                            errno: e.errno,
                            sqlstate: e.sqlstate,
                        }];
                }
                return [false, e.message];
            }
            let multi_resultset = [res];
            do {
                try {
                    let rows;
                    [rows, again] = (await this._read_execute_result(sock));
                    multi_resultset.push(rows);
                }
                catch (e) {
                    if (e instanceof ResultError) {
                        return [true, {
                                badresult: true,
                                err: e.message,
                                errno: e.errno,
                                sqlstate: e.sqlstate,
                            }];
                    }
                    return [false, e.message];
                }
            } while (again);
            return [true, multi_resultset];
        };
    }
}
Mysql._store_types = new Map([
    ["number", [(data, v) => {
                if (Number.isSafeInteger(v)) {
                    data.uint16(0x08, true);
                }
                else {
                    data.uint16(0x05, true);
                }
            }, (data, v) => {
                if (Number.isSafeInteger(v)) {
                    data.safe_uint64(v, true);
                }
                else {
                    data.double(v, true);
                }
            }]],
    ["string", [(data, v) => {
                data.uint16(0x0f, true);
            }, (data, v) => {
                let s = v;
                Mysql._set_length_code_bin(data, utf8.length(s));
                data.utf8_str(s, 0);
            }]],
    ["boolean", [(data, v) => {
                data.uint16(0x01, true);
            }, (data, v) => {
                if (v) {
                    data.uint8(1, true);
                }
                else {
                    data.uint8(0, true);
                }
            }]],
    ["undefined", [(data, v) => {
                data.uint16(0x06, true);
            }, (data, v) => {
            }]],
    ["object", [(data, v) => {
                if (v instanceof Uint8Array) {
                    data.uint16(0x0f, true);
                }
                else {
                    skynet.assert(false);
                }
            }, (data, v) => {
                if (v instanceof Uint8Array) {
                    data.buffer(v, 0);
                }
                else {
                    skynet.assert(false);
                }
            }]],
]);
Mysql._binary_parse = new Map([
    [0x01, (data, pos) => {
            return [pos + 1, pack.decode_uint8(data, pos, true)];
        }],
    [0x02, (data, pos) => {
            return [pos + 2, pack.decode_uint16(data, pos, true)];
        }],
    [0x03, (data, pos) => {
            return [pos + 4, pack.decode_uint32(data, pos, true)];
        }],
    [0x04, (data, pos) => {
            return [pos + 4, pack.decode_float(data, pos, true)];
        }],
    [0x05, (data, pos) => {
            return [pos + 8, pack.decode_double(data, pos, true)];
        }],
    [0x07, Mysql._get_datetime],
    [0x08, (data, pos) => {
            return [pos + 8, pack.decode_uint(data, pos, 8, true)];
        }],
    [0x09, (data, pos) => {
            return [pos + 3, pack.decode_uint(data, pos, 3, true)];
        }],
    [0x0c, Mysql._get_datetime],
    [0x0f, Mysql._get_buffer],
    [0x10, Mysql._get_buffer],
    [0xf9, Mysql._get_buffer],
    [0xfa, Mysql._get_buffer],
    [0xfb, Mysql._get_buffer],
    [0xfc, Mysql._get_buffer],
    [0xfd, Mysql._get_buffer],
    [0xfe, Mysql._get_buffer],
]);
