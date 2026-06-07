/**
 * Cryptographic primitives for the AirPlay-2 / MRP tunnel — HKDF-SHA512,
 * ChaCha20-Poly1305, and the HAP/AirPlay salt+info constants. Ported from
 * bunatv (MIT, © pyatv © Pierre Ståhl) crypto/{constants,hkdf,chacha20}.ts,
 * with the only change being a portable Node logging shim. Byte-exact:
 * every salt/info string and the SRP hex-transform are preserved verbatim.
 */
import crypto from "node:crypto";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";

// ---- Constants (verbatim from bunatv crypto/constants.ts) ----

export const HAP_SALT = {
  PAIR_SETUP_ENCRYPT: Buffer.from("Pair-Setup-Encrypt-Salt", "utf8"),
  PAIR_SETUP_CONTROLLER: Buffer.from("Pair-Setup-Controller-Sign-Salt", "utf8"),
  PAIR_SETUP_ACCESSORY: Buffer.from("Pair-Setup-Accessory-Sign-Salt", "utf8"),
  PAIR_VERIFY_ENCRYPT: Buffer.from("Pair-Verify-Encrypt-Salt", "utf8"),
  PAIR_VERIFY_INFO: Buffer.from("Pair-Verify-Encrypt-Info", "utf8"),
};

export const HAP_INFO = {
  CONTROL_READ: Buffer.from("Control-Read-Encryption-Key", "utf8"),
  CONTROL_WRITE: Buffer.from("Control-Write-Encryption-Key", "utf8"),
  PAIR_SETUP_CONTROLLER_SIGN_INFO: Buffer.from("Pair-Setup-Controller-Sign-Info", "utf8"),
  PAIR_SETUP_ENCRYPT_INFO: Buffer.from("Pair-Setup-Encrypt-Info", "utf8"),
};

export const AIRPLAY_CRYPTO = {
  SESSION_SALT: Buffer.from("Control-Salt", "utf8"),
  CLIENT_ENCRYPT_INFO: Buffer.from("Control-Write-Encryption-Key", "utf8"),
  SERVER_ENCRYPT_INFO: Buffer.from("Control-Read-Encryption-Key", "utf8"),
};

export const AIRPLAY_EVENT_CRYPTO = {
  SESSION_SALT: Buffer.from("Events-Salt", "utf8"),
  // Reversed because connection originates from receiver
  CLIENT_ENCRYPT_INFO: Buffer.from("Events-Read-Encryption-Key", "utf8"),
  SERVER_ENCRYPT_INFO: Buffer.from("Events-Write-Encryption-Key", "utf8"),
};

export const AIRPLAY_DATASTREAM_CRYPTO = {
  SALT_PREFIX: Buffer.from("DataStream-Salt", "utf8"),
  INPUT_INFO: Buffer.from("DataStream-Input-Encryption-Key", "utf8"),
  OUTPUT_INFO: Buffer.from("DataStream-Output-Encryption-Key", "utf8"),
};

export const SRP_CONFIG = {
  PRIME_BITS: 3072,
  HASH_ALGORITHM: "sha512" as const,
  GENERATOR: 5,
};

// ---- ChaCha20-Poly1305 (verbatim logic from bunatv crypto/chacha20.ts) ----

export class ChaCha20Utils {
  static encryptSync(key: Uint8Array, nonce: Uint8Array, data: Uint8Array, additionalData?: Uint8Array): Uint8Array {
    const cipher = chacha20poly1305(key, nonce, additionalData);
    return cipher.encrypt(data);
  }

  static decryptSync(
    key: Uint8Array,
    nonce: Uint8Array,
    encryptedData: Uint8Array,
    additionalData?: Uint8Array,
  ): Uint8Array {
    const cipher = chacha20poly1305(key, nonce, additionalData);
    return cipher.decrypt(encryptedData);
  }

  static generateNonce(): Uint8Array {
    const nonce = new Uint8Array(12);
    crypto.getRandomValues(nonce);
    return nonce;
  }
}

// ---- HKDF-SHA512 (verbatim logic from bunatv crypto/hkdf.ts) ----

export type DerivedKeys = { readKey: Uint8Array; writeKey: Uint8Array };

export class HkdfUtils {
  static deriveSync(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    if (length <= 0) throw new Error("HKDF length must be greater than 0");
    const derived = crypto.hkdfSync("sha512", Buffer.from(ikm), Buffer.from(salt), Buffer.from(info), length);
    return new Uint8Array(derived);
  }

  // pyatv transforms the SRP key to a hex string then back to bytes before HKDF.
  static derivePairSetupKeySync(sharedSecret: Uint8Array): Uint8Array {
    const transformed = Buffer.from(Buffer.from(sharedSecret).toString("hex"), "hex");
    return this.deriveSync(transformed, HAP_SALT.PAIR_SETUP_ENCRYPT, HAP_INFO.PAIR_SETUP_ENCRYPT_INFO, 32);
  }

  static deriveControllerKeySync(sharedSecret: Uint8Array): Uint8Array {
    const transformed = Buffer.from(Buffer.from(sharedSecret).toString("hex"), "hex");
    return this.deriveSync(transformed, HAP_SALT.PAIR_SETUP_CONTROLLER, HAP_INFO.PAIR_SETUP_CONTROLLER_SIGN_INFO, 32);
  }

  static deriveAccessoryKeySync(sharedSecret: Uint8Array): Uint8Array {
    return this.deriveSync(sharedSecret, HAP_SALT.PAIR_SETUP_ACCESSORY, Buffer.alloc(0), 32);
  }

  static deriveSessionKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    return {
      readKey: this.deriveSync(sharedSecret, HAP_SALT.PAIR_VERIFY_ENCRYPT, HAP_INFO.CONTROL_READ, 32),
      writeKey: this.deriveSync(sharedSecret, HAP_SALT.PAIR_VERIFY_ENCRYPT, HAP_INFO.CONTROL_WRITE, 32),
    };
  }

  static deriveAirPlaySessionKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    return {
      readKey: this.deriveSync(sharedSecret, AIRPLAY_CRYPTO.SESSION_SALT, AIRPLAY_CRYPTO.SERVER_ENCRYPT_INFO, 32),
      writeKey: this.deriveSync(sharedSecret, AIRPLAY_CRYPTO.SESSION_SALT, AIRPLAY_CRYPTO.CLIENT_ENCRYPT_INFO, 32),
    };
  }

  static deriveAirPlayEventKeysSync(sharedSecret: Uint8Array): DerivedKeys {
    return {
      readKey: this.deriveSync(
        sharedSecret,
        AIRPLAY_EVENT_CRYPTO.SESSION_SALT,
        AIRPLAY_EVENT_CRYPTO.SERVER_ENCRYPT_INFO,
        32,
      ),
      writeKey: this.deriveSync(
        sharedSecret,
        AIRPLAY_EVENT_CRYPTO.SESSION_SALT,
        AIRPLAY_EVENT_CRYPTO.CLIENT_ENCRYPT_INFO,
        32,
      ),
    };
  }

  // NOTE: bunatv's code uses the seed's DECIMAL-ASCII bytes here (not LE int64),
  // despite the upstream comment. If M1 frame decryption fails, this salt is the
  // #1 thing to flip. Ported as-is from the working implementation.
  static deriveAirPlayDataStreamKeysSync(sharedSecret: Uint8Array, seed: bigint): DerivedKeys {
    const salt = Buffer.concat([AIRPLAY_DATASTREAM_CRYPTO.SALT_PREFIX, Buffer.from(seed.toString(), "utf8")]);
    return {
      readKey: this.deriveSync(sharedSecret, salt, AIRPLAY_DATASTREAM_CRYPTO.INPUT_INFO, 32),
      writeKey: this.deriveSync(sharedSecret, salt, AIRPLAY_DATASTREAM_CRYPTO.OUTPUT_INFO, 32),
    };
  }
}
