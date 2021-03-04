import { utf8 } from "utf8";
import * as pack from "pack";
const TYPE_NIL = 0;
const TYPE_BOOLEAN = 1;
// hibits 0 false 1 true
const TYPE_NUMBER = 2;
// hibits 0 : 0 , 1: byte, 2:word, 4: dword, 6: qword, 8 : double
const TYPE_NUMBER_ZERO = 0;
const TYPE_NUMBER_BYTE = 1;
const TYPE_NUMBER_WORD = 2;
const TYPE_NUMBER_DWORD = 4;
const TYPE_NUMBER_QWORD = 6;
const TYPE_NUMBER_REAL = 8;
const TYPE_USERDATA = 3;
const TYPE_SHORT_STRING = 4;
// hibits 0~31 : len
const TYPE_LONG_STRING = 5;
const TYPE_TABLE = 6;
const MAX_DEPTH = 100;
const MAX_COOKIE = 32;
const INITIAL_BUFFER_SIZE = 2048;
class encoder {
    constructor(bytes, offset) {
        this.bytes = bytes || new Uint8Array(INITIAL_BUFFER_SIZE);
        this.pos = offset || 0;
    }
    serialize() {
        return this.bytes.subarray(0, this.pos);
    }
    ensure_write_size(sz) {
        if (this.bytes.length < this.pos + sz) {
            let new_bytes = new Uint8Array((this.pos + sz) * 2);
            new_bytes.set(this.bytes);
            this.bytes = new_bytes;
        }
    }
    encode(object, depth = 0) {
        if (depth > MAX_DEPTH) {
            throw new Error(`too deep objects in depth ${depth}`);
        }
        let type = typeof (object);
        if (object == null) {
            this.encode_nil();
        }
        else if (type == "boolean") {
            this.encode_boolean(object);
        }
        else if (type == "string") {
            this.encode_string(object);
        }
        else if (type == "number") {
            this.encode_number(object);
        }
        else if (type == "bigint") {
            this.encode_bigint(object);
        }
        else if (type == "object") {
            this.encode_object(object, depth + 1);
        }
        else {
            throw new Error(`unsupport type: ${type} to serialize`);
        }
    }
    encode_nil() {
        this.write_u8(TYPE_NIL);
    }
    encode_boolean(v) {
        this.write_u8(this.combin_type(TYPE_BOOLEAN, v ? 1 : 0));
    }
    encode_bigint(v) {
        this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_QWORD));
        this.write_bigint(v);
    }
    encode_number(v) {
        if (Number.isSafeInteger(v)) {
            if (v == 0) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_ZERO));
            }
            else if (v < -2147483648 || v > 2147483648) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_QWORD));
                this.write_i64(v);
            }
            else if (v < 0) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_DWORD));
                this.write_i32(v);
            }
            else if (v < 0x100) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_BYTE));
                this.write_u8(v);
            }
            else if (v < 0x10000) {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_WORD));
                this.write_u16(v);
            }
            else {
                this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_DWORD));
                this.write_u32(v);
            }
        }
        else {
            this.write_u8(this.combin_type(TYPE_NUMBER, TYPE_NUMBER_REAL));
            this.write_f64(v);
        }
    }
    encode_string(v) {
        let len = utf8.length(v);
        if (len < MAX_COOKIE) {
            this.write_u8(this.combin_type(TYPE_SHORT_STRING, len));
        }
        else if (len < 0x10000) {
            this.write_u8(this.combin_type(TYPE_LONG_STRING, 2));
            this.write_u16(len);
        }
        else {
            this.write_u8(this.combin_type(TYPE_LONG_STRING, 4));
            this.write_u32(len);
        }
        if (len) {
            this.write_string(v);
        }
    }
    encode_object(v, depth) {
        if (Array.isArray(v)) {
            let array_size = v.length;
            if (array_size >= MAX_COOKIE - 1) {
                this.write_u8(this.combin_type(TYPE_TABLE, MAX_COOKIE - 1));
                this.encode_number(array_size);
            }
            else {
                this.write_u8(this.combin_type(TYPE_TABLE, array_size));
            }
            for (let i = 0; i < array_size; i++) {
                this.encode(v[i], depth);
            }
            this.encode_nil();
        }
        else {
            this.write_u8(this.combin_type(TYPE_TABLE, 0));
            for (let k in v) {
                this.encode(k, depth);
                this.encode(v[k], depth);
            }
            this.encode_nil();
        }
    }
    combin_type(t, v) {
        return t | (v << 3);
    }
    write_u8(v) {
        this.ensure_write_size(1);
        pack.encode_uint8(this.bytes, this.pos, v, true);
        this.pos++;
    }
    write_i16(v) {
        this.ensure_write_size(2);
        pack.encode_int16(this.bytes, this.pos, v, true);
        this.pos += 2;
    }
    write_u16(v) {
        this.ensure_write_size(2);
        pack.encode_uint16(this.bytes, this.pos, v, true);
        this.pos += 2;
    }
    write_i32(v) {
        this.ensure_write_size(4);
        pack.encode_int32(this.bytes, this.pos, v, true);
        this.pos += 4;
    }
    write_u32(v) {
        this.ensure_write_size(4);
        pack.encode_uint32(this.bytes, this.pos, v, true);
        this.pos += 4;
    }
    write_i64(v) {
        this.ensure_write_size(8);
        pack.encode_safe_int64(this.bytes, this.pos, v, true);
        this.pos += 8;
    }
    write_bigint(v) {
        this.ensure_write_size(8);
        pack.encode_bigint(this.bytes, this.pos, v, 8, true);
        this.pos += 8;
    }
    write_f64(v) {
        this.ensure_write_size(8);
        pack.encode_double(this.bytes, this.pos, v, true);
        this.pos += 8;
    }
    write_string(v) {
        let len = utf8.length(v);
        this.ensure_write_size(len);
        utf8.write(v, this.bytes, this.pos);
        this.pos += len;
    }
}
class decoder {
    constructor(buffer, sz, pos = 0) {
        this.pos = 0;
        this.sz = 0;
        this.pos = pos;
        this.sz = sz;
        if (buffer && buffer.length) {
            this.bytes = buffer;
        }
    }
    decode() {
        if (!this.bytes) {
            return [];
        }
        let result = [];
        while (this.pos < this.sz) {
            result.push(this.decode_one());
        }
        return result;
    }
    decode_one() {
        let type = this.read_u8();
        let subtype = type >> 3;
        type = type & 0x7;
        if (type == TYPE_NIL) {
            return null;
        }
        else if (type == TYPE_BOOLEAN) {
            return subtype ? true : false;
        }
        else if (type == TYPE_NUMBER) {
            return this.decode_number(subtype);
        }
        else if (type == TYPE_SHORT_STRING) {
            return this.read_string(subtype);
        }
        else if (type == TYPE_LONG_STRING) {
            let len = 0;
            if (subtype == 2) {
                len = this.read_u16();
            }
            else {
                len = this.read_u32();
            }
            return this.read_string(len);
        }
        else if (type == TYPE_TABLE) {
            let len = subtype;
            if (subtype >= MAX_COOKIE - 1) {
                len = this.decode_one();
            }
            if (len > 0) {
                let v = [];
                for (let i = 0; i < len; i++) {
                    v.push(this.decode_one());
                }
                do {
                    let type = this.look_u8() & 0x7;
                    if (type == TYPE_NIL) {
                        this.read_u8();
                        break;
                    }
                    let k = this.decode_one();
                    v[k] = this.decode_one();
                } while (true);
                return v;
            }
            else {
                let v = {};
                do {
                    let type = this.look_u8() & 0x7;
                    if (type == TYPE_NIL) {
                        this.read_u8();
                        break;
                    }
                    let k = this.decode_one();
                    v[k] = this.decode_one();
                } while (true);
                return v;
            }
        }
    }
    decode_number(subtype) {
        if (subtype == TYPE_NUMBER_ZERO) {
            return 0;
        }
        else if (subtype == TYPE_NUMBER_BYTE) {
            return this.read_u8();
        }
        else if (subtype == TYPE_NUMBER_WORD) {
            return this.read_u16();
        }
        else if (subtype == TYPE_NUMBER_DWORD) {
            return this.read_i32();
        }
        else if (subtype == TYPE_NUMBER_QWORD) {
            return this.read_i64();
        }
        else if (subtype == TYPE_NUMBER_REAL) {
            return this.read_f64();
        }
    }
    ensure_read_size(sz) {
        if (!this.bytes || (this.sz - this.pos) < sz) {
            throw new Error(`invalid serialize stream ${sz} ${this.bytes.length} ${this.pos}`);
        }
    }
    look_u8() {
        this.ensure_read_size(1);
        return pack.decode_uint8(this.bytes, this.pos, true);
    }
    read_u8() {
        this.ensure_read_size(1);
        return pack.decode_uint8(this.bytes, this.pos++, true);
    }
    read_u16() {
        this.ensure_read_size(2);
        let v = pack.decode_uint16(this.bytes, this.pos, true);
        this.pos += 2;
        return v;
    }
    read_i32() {
        this.ensure_read_size(4);
        let v = pack.decode_int32(this.bytes, this.pos, true);
        this.pos += 4;
        return v;
    }
    read_u32() {
        this.ensure_read_size(4);
        let v = pack.decode_uint32(this.bytes, this.pos, true);
        this.pos += 4;
        return v;
    }
    read_i64() {
        this.ensure_read_size(8);
        let v = pack.decode_bigint(this.bytes, this.pos, 8, true);
        this.pos += 8;
        return v;
    }
    read_f64() {
        this.ensure_read_size(8);
        let v = pack.decode_double(this.bytes, this.pos, true);
        this.pos += 8;
        return v;
    }
    read_string(len) {
        this.ensure_read_size(len);
        let v = utf8.read(this.bytes, this.pos, this.pos + len);
        this.pos += len;
        return v;
    }
}
function encode(...datas) {
    let wb = new encoder();
    for (let d of datas) {
        wb.encode(d);
    }
    return wb.serialize();
}
function encode_ex(bytes, offset, ...datas) {
    let wb = new encoder(bytes, offset);
    for (let d of datas) {
        wb.encode(d);
    }
    return [wb.bytes, wb.pos - offset];
}
function decode(buffer, sz) {
    return new decoder(buffer, sz).decode();
}
function decode_ex(buffer, offset, sz) {
    return new decoder(buffer, offset + sz, offset).decode();
}
export { encode, encode_ex, decode, decode_ex, };
