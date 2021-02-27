import { sha_variant_error } from "jsSHA/common";
import jsSHA1 from "jsSHA/sha1";
import jsSHA256 from "jsSHA/sha256";
import jsSHA512 from "jsSHA/sha512";
import jsSHA3 from "jsSHA/sha3";
export default class jsSHA {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(variant, inputFormat, options) {
        if ("SHA-1" == variant) {
            this.shaObj = new jsSHA1(variant, inputFormat, options);
        }
        else if ("SHA-224" == variant || "SHA-256" == variant) {
            this.shaObj = new jsSHA256(variant, inputFormat, options);
        }
        else if ("SHA-384" == variant || "SHA-512" == variant) {
            this.shaObj = new jsSHA512(variant, inputFormat, options);
        }
        else if ("SHA3-224" == variant ||
            "SHA3-256" == variant ||
            "SHA3-384" == variant ||
            "SHA3-512" == variant ||
            "SHAKE128" == variant ||
            "SHAKE256" == variant ||
            "CSHAKE128" == variant ||
            "CSHAKE256" == variant ||
            "KMAC128" == variant ||
            "KMAC256" == variant) {
            this.shaObj = new jsSHA3(variant, inputFormat, options);
        }
        else {
            throw new Error(sha_variant_error);
        }
    }
    /**
     * Takes `input` and hashes as many blocks as possible. Stores the rest for either a future `update` or `getHash` call.
     *
     * @param input The input to be hashed
     */
    update(input) {
        this.shaObj.update(input);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getHash(format, options) {
        return this.shaObj.getHash(format, options);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setHMACKey(key, inputFormat, options) {
        this.shaObj.setHMACKey(key, inputFormat, options);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getHMAC(format, options) {
        return this.shaObj.getHMAC(format, options);
    }
}
