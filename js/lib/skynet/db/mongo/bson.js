import * as skynet from "skynet";
import * as pack from "pack";
import * as utf8 from "utf8";
const MAX_DEPTH = 128;
const BSON_INT32_MAX = 0x7fffffff;
const BSON_INT32_MIN = -0x80000000;
const BSON_INT64_MAX = Math.pow(2, 63) - 1;
const BSON_INT64_MIN = -Math.pow(2, 63);
const JS_INT_MAX = Math.pow(2, 53);
const JS_INT_MIN = -Math.pow(2, 53);
const BSON_DATA_NUMBER = 1;
const BSON_DATA_STRING = 2;
const BSON_DATA_OBJECT = 3;
const BSON_DATA_ARRAY = 4;
const BSON_DATA_BINARY = 5;
const BSON_DATA_UNDEFINED = 6;
const BSON_DATA_OID = 7;
const BSON_DATA_BOOLEAN = 8;
const BSON_DATA_DATE = 9;
const BSON_DATA_NULL = 10;
const BSON_DATA_REGEXP = 11;
const BSON_DATA_DBPOINTER = 12;
const BSON_DATA_CODE = 13;
const BSON_DATA_SYMBOL = 14;
const BSON_DATA_CODE_W_SCOPE = 15;
const BSON_DATA_INT = 16;
const BSON_DATA_TIMESTAMP = 17;
const BSON_DATA_LONG = 18;
const BSON_DATA_DECIMAL128 = 19;
const BSON_DATA_MIN_KEY = 0xff;
const BSON_DATA_MAX_KEY = 0x7f;
const BSON_BINARY_SUBTYPE_DEFAULT = 0;
const BSON_BINARY_SUBTYPE_FUNCTION = 1;
const BSON_BINARY_SUBTYPE_BYTE_ARRAY = 2;
const BSON_BINARY_SUBTYPE_UUID = 3;
const BSON_BINARY_SUBTYPE_UUID_NEW = 4;
const BSON_BINARY_SUBTYPE_MD5 = 5;
const BSON_BINARY_SUBTYPE_USER_DEFINED = 128;
export function encode(datas) {
    let b = new pack.encoder();
    b.reserve(4);
    for (let key in datas) {
        append_one(b, key, datas[key], 0);
    }
    b.uint8(0, true);
    pack.encode_uint32(b._buffer, 0, b._pos, true);
    return b.finish();
}
export function encode_order(...params) {
    if (params.length % 2 != 0) {
        throw new Error(`invalid ordered dict`);
    }
    let b = new pack.encoder();
    b.reserve(4);
    for (let i = 0; i < params.length; i += 2) {
        let key = params[i];
        if (typeof (key) != "string") {
            throw new Error(`argument ${i} need a string`);
        }
        append_one(b, key, params[i + 1], 0);
    }
    b.uint8(0, true);
    pack.encode_uint32(b._buffer, 0, b._pos, true);
    return b.finish();
}
export function decode(data, len, pos) {
    let decoder = new pack.decoder(data, len - 1, pos);
    return unpack_dict(decoder);
}
function append_key(b, k, t) {
    b.uint8(t, true);
    b.utf8_str(k, 0);
    b.reserve(1);
}
function append_number(b, k, v) {
    if (Number.isSafeInteger(v)) {
        if (v >= BSON_INT32_MIN && v <= BSON_INT32_MAX) {
            append_key(b, k, BSON_DATA_INT);
            b.int32(v, true);
        }
        else {
            append_key(b, k, BSON_DATA_LONG);
            b.safe_int64(v, true);
        }
    }
    else {
        append_key(b, k, BSON_DATA_NUMBER);
        b.double(v, true);
    }
}
function append_string(b, v) {
    let pos = b.reserve(4);
    b.utf8_str(v, 0);
    b.reserve(1);
    pack.encode_uint32(b._buffer, pos, b._pos - pos - 4, true);
}
function append_one(b, k, v, depth) {
    if (depth > MAX_DEPTH) {
        throw new Error(`too depth while encoding bson`);
    }
    let vt = typeof (v);
    if (vt == "number") {
        append_number(b, k, v);
    }
    else if (vt == "bigint") {
        append_key(b, k, BSON_DATA_LONG);
        b.bigint(v, 8, true);
    }
    else if (vt == "boolean") {
        append_key(b, k, BSON_DATA_BOOLEAN);
        b.uint8(v ? 1 : 0, true);
    }
    else if (vt == "string") {
        append_key(b, k, BSON_DATA_STRING);
        append_string(b, v);
    }
    else if (v instanceof Date) {
        append_key(b, k, BSON_DATA_DATE);
        b.safe_uint64(v.getTime(), true);
    }
    else if (v instanceof Uint8Array) {
        append_key(b, k, BSON_DATA_BINARY);
        b.uint32(v.length, true);
        b.uint8(BSON_BINARY_SUBTYPE_DEFAULT, true);
        b.buffer(v, 0);
    }
    else if (v === undefined || v === null) {
        append_key(b, k, BSON_DATA_NULL);
    }
    else if (v instanceof data_base) {
        v.encode(b, k);
    }
    else if (v instanceof Array) {
        append_key(b, k, BSON_DATA_ARRAY);
        let pos = b.reserve(4);
        for (let i = 0; i < v.length; i++) {
            append_one(b, String(i), v[i], depth + 1);
        }
        b.uint8(0, true);
        pack.encode_uint32(b._buffer, pos, b._pos - pos, true);
    }
    else if (v instanceof Map) {
        append_key(b, k, BSON_DATA_OBJECT);
        let pos = b.reserve(4);
        for (let [key, val] of v) {
            append_one(b, String(key), val, depth + 1);
        }
        b.uint8(0, true);
        pack.encode_uint32(b._buffer, pos, b._pos - pos, true);
    }
    else if (vt == "object") {
        append_key(b, k, BSON_DATA_OBJECT);
        let pos = b.reserve(4);
        for (let k in v) {
            append_one(b, String(k), v[k], depth + 1);
        }
        b.uint8(0, true);
        pack.encode_uint32(b._buffer, pos, b._pos - pos, true);
    }
    else {
        throw new Error(`unsupport type: ${vt}`);
    }
}
function unpack_string(decoder) {
    let len = decoder.uint32(true);
    let v = utf8.utf8.read(decoder._buffer, decoder._pos, decoder._pos + len - 1);
    decoder._pos += len;
    return v;
}
function unpack_dict(decoder, is_array) {
    let sz = decoder.int32(true);
    let result = (is_array ? [] : {});
    while (decoder.size() > 0) {
        let bt = decoder.uint8(true);
        if (bt == 0) {
            break;
        }
        let key = decoder.cstring();
        let val;
        switch (bt) {
            case BSON_DATA_NUMBER:
                val = decoder.double(true);
                break;
            case BSON_DATA_BOOLEAN:
                val = decoder.uint8(true) ? true : false;
                break;
            case BSON_DATA_STRING:
                val = unpack_string(decoder);
                break;
            case BSON_DATA_INT:
                val = decoder.uint32(true);
                break;
            case BSON_DATA_LONG:
                val = decoder.safe_uint64(true);
                break;
            case BSON_DATA_UNDEFINED:
                val = undefined;
                break;
            case BSON_DATA_NULL:
                val = null;
                break;
            case BSON_DATA_DATE:
                val = new Date(decoder.safe_uint64(true));
                break;
            case BSON_DATA_BINARY:
                let len = decoder.uint32(true);
                let sub_type = decoder.uint8(true);
                val = decoder.raw_buffer(len);
                break;
            case BSON_DATA_OBJECT:
                val = unpack_dict(decoder);
                break;
            case BSON_DATA_ARRAY:
                val = unpack_dict(decoder, true);
                break;
            case BSON_DATA_OID:
                val = data_object_id.decode(decoder);
                break;
            case BSON_DATA_CODE:
                val = data_code.decode(decoder);
                break;
            case BSON_DATA_REGEXP:
                val = data_regexp.decode(decoder);
                break;
            case BSON_DATA_MIN_KEY:
                val = data_minkey.decode(decoder);
                break;
            case BSON_DATA_MAX_KEY:
                val = data_maxkey.decode(decoder);
                break;
            case BSON_DATA_TIMESTAMP:
                val = data_timestamp.decode(decoder);
                break;
            case BSON_DATA_SYMBOL:
                val = data_symbol.decode(decoder);
                break;
            case BSON_DATA_DBPOINTER:
                val = data_dbpointer.decode(decoder);
                break;
            case BSON_DATA_CODE_W_SCOPE:
                val = data_code_w_scope.decode(decoder);
                break;
            default:
                skynet.assert(false, "bson decode unsupport type:" + bt);
                break;
        }
        ;
        if (is_array) {
            result.push(val);
        }
        else {
            result[key] = val;
        }
    }
    return result;
}
export class data_base {
    encode(b, k) {
    }
}
export class data_object_id extends data_base {
    constructor(id) {
        super();
        this.id = data_object_id.empty_id;
        if (id.length != 12) {
            throw new Error(`invalid object id`);
        }
        this.id = id;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_OID);
        b.buffer(this.id, 0);
    }
    static decode(decoder) {
        return new data_object_id(decoder.raw_buffer(12));
    }
}
data_object_id.empty_id = new Uint8Array(12);
export class data_code extends data_base {
    constructor(code) {
        super();
        this.code = "";
        this.code = code;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_CODE);
        append_string(b, this.code);
    }
    static decode(decoder) {
        return new data_code(decoder.utf8_str(4, true));
    }
}
export class data_regexp extends data_base {
    constructor(regexp, options) {
        super();
        this.regexp = "";
        this.options = "";
        this.regexp = regexp;
        this.options = options || this.options;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_REGEXP);
        b.utf8_cstr(this.regexp);
        b.utf8_cstr(this.options);
    }
    static decode(decoder) {
        let regexp = decoder.utf8_cstr();
        let options = decoder.utf8_cstr();
        return new data_regexp(regexp, options);
    }
}
export class data_minkey extends data_base {
    constructor() {
        super();
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_MIN_KEY);
    }
    static decode(decoder) {
        return new data_minkey();
    }
}
export class data_maxkey extends data_base {
    constructor() {
        super();
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_MAX_KEY);
    }
    static decode(decoder) {
        return new data_maxkey();
    }
}
export class data_timestamp extends data_base {
    constructor(ts) {
        super();
        this.ts = 0n;
        this.ts = ts;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_TIMESTAMP);
        b.bigint(this.ts, 8, true);
    }
    static decode(decoder) {
        return new data_timestamp(decoder.bigint(true));
    }
}
export class data_symbol extends data_base {
    constructor(s) {
        super();
        this.str = "";
        this.str = s;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_SYMBOL);
        append_string(b, this.str);
    }
    static decode(decoder) {
        return new data_symbol(decoder.utf8_str(4, true));
    }
}
export class data_dbpointer extends data_base {
    constructor(s, b) {
        super();
        this.str = "";
        this.bytes = data_dbpointer.empty_id;
        this.str = s;
        this.bytes = b;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_DBPOINTER);
        append_string(b, this.str);
        b.buffer(this.bytes, 0);
    }
    static decode(decoder) {
        let s = decoder.utf8_str(4, true);
        let b = decoder.raw_buffer(12);
        return new data_dbpointer(s, b);
    }
}
data_dbpointer.empty_id = new Uint8Array(12);
export class data_code_w_scope extends data_base {
    constructor(s, o) {
        super();
        this.str = "";
        this.obj = undefined;
        this.str = s;
        this.obj = o;
    }
    encode(b, k) {
        append_key(b, k, BSON_DATA_CODE_W_SCOPE);
        append_string(b, this.str);
        let pos = b.reserve(4);
        if (this.obj) {
            for (let k in this.obj) {
                append_one(b, String(k), this.obj[k], 1);
            }
        }
        b.uint8(0, true);
        pack.encode_uint32(b._buffer, pos, b._pos - pos, true);
    }
    static decode(decoder) {
        let s = decoder.utf8_str(4, true);
        let o = unpack_dict(decoder);
        return new data_code_w_scope(s, o);
    }
}
