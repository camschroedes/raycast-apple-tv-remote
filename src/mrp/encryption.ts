/**
 * ChaCha20 session-encryption layer + HAP 2-byte-length framing.
 * Ported verbatim from bunatv (MIT) shared/layers/ChaCha20EncryptionLayer.ts
 * and airplay/layers/HapFrameLayer.ts — logging swapped for the portable shim.
 *
 * Nonce: HAP format = 4 zero bytes + 8-byte LE counter (per-direction, from 0,
 * reset on enable()). Frame: [2-byte LE length][ciphertext][16-byte tag], with
 * the length bytes used verbatim as AEAD AAD. Max 1024 plaintext bytes/frame.
 */
import { BunOptimizedUtils, NonceFormat } from "./buffer-utils";
import { ChaCha20Utils, type DerivedKeys } from "./crypto";
import { createLogger } from "./logging";

export { NonceFormat };

const logger = createLogger("mrp:chacha20-encryption");

export enum EncryptionState {
  Disabled = "disabled",
  Enabled = "enabled",
  Error = "error",
}

export class ChaCha20EncryptionLayer {
  private _state: EncryptionState = EncryptionState.Disabled;
  private sessionKeys?: DerivedKeys;
  private sendNonce = 0;
  private receiveNonce = 0;
  private nonceFormat: NonceFormat;

  constructor(options?: { format?: NonceFormat }) {
    this.nonceFormat = options?.format ?? NonceFormat.Companion;
  }

  get state(): EncryptionState {
    return this._state;
  }
  get isEnabled(): boolean {
    return this._state === EncryptionState.Enabled;
  }

  enable(keys: DerivedKeys): void {
    this.sessionKeys = keys;
    this.sendNonce = 0;
    this.receiveNonce = 0;
    this._state = EncryptionState.Enabled;
    logger.info("ChaCha20 encryption enabled — nonces reset to 0");
  }

  disable(): void {
    this.sessionKeys = undefined;
    this.sendNonce = 0;
    this.receiveNonce = 0;
    this._state = EncryptionState.Disabled;
  }

  encrypt(data: Buffer, aad?: Buffer): Buffer {
    if (!this.isEnabled || !this.sessionKeys) return data;
    try {
      const nonce = BunOptimizedUtils.createNonce(this.sendNonce++, this.nonceFormat);
      const encrypted = ChaCha20Utils.encryptSync(
        this.sessionKeys.writeKey,
        nonce,
        new Uint8Array(data),
        aad ? new Uint8Array(aad) : undefined,
      );
      return Buffer.from(encrypted);
    } catch (error) {
      this._state = EncryptionState.Error;
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  decrypt(data: Buffer, aad?: Buffer): Buffer {
    if (!this.isEnabled || !this.sessionKeys) return data;
    try {
      const nonce = BunOptimizedUtils.createNonce(this.receiveNonce++, this.nonceFormat);
      const decrypted = ChaCha20Utils.decryptSync(
        this.sessionKeys.readKey,
        nonce,
        new Uint8Array(data),
        aad ? new Uint8Array(aad) : undefined,
      );
      return Buffer.from(decrypted);
    } catch (error) {
      this._state = EncryptionState.Error;
      throw new Error(`Decryption failed: ${error}`);
    }
  }

  resetNonces(): void {
    this.sendNonce = 0;
    this.receiveNonce = 0;
  }
}

/**
 * HAP frame layer — 2-byte LE length prefix + ChaCha20-Poly1305, length as AAD.
 */
export class HapFrameLayer {
  private static readonly MAX_FRAME_SIZE = 1024;
  private static readonly LENGTH_SIZE = 2;
  private static readonly AUTH_TAG_SIZE = 16;

  constructor(private readonly encryption: ChaCha20EncryptionLayer) {}

  get isEnabled(): boolean {
    return this.encryption.isEnabled;
  }

  encrypt(plaintext: Buffer): Buffer {
    const frames: Buffer[] = [];
    let offset = 0;
    while (offset < plaintext.length) {
      const chunk = plaintext.subarray(offset, offset + HapFrameLayer.MAX_FRAME_SIZE);
      const lengthBytes = Buffer.alloc(HapFrameLayer.LENGTH_SIZE);
      lengthBytes.writeUInt16LE(chunk.length, 0);
      const ciphertext = this.encryption.encrypt(chunk, lengthBytes);
      frames.push(Buffer.concat([lengthBytes, ciphertext]));
      offset += chunk.length;
    }
    return Buffer.concat(frames);
  }

  decrypt(encrypted: Buffer): { decrypted: Buffer; remaining: Buffer } {
    const chunks: Buffer[] = [];
    let offset = 0;
    while (offset < encrypted.length) {
      if (encrypted.length - offset < HapFrameLayer.LENGTH_SIZE) break;
      const length = encrypted.readUInt16LE(offset);
      const frameEnd = offset + HapFrameLayer.LENGTH_SIZE + length + HapFrameLayer.AUTH_TAG_SIZE;
      if (encrypted.length < frameEnd) break;
      const ciphertext = encrypted.subarray(offset + HapFrameLayer.LENGTH_SIZE, frameEnd);
      const aad = encrypted.subarray(offset, offset + HapFrameLayer.LENGTH_SIZE);
      chunks.push(this.encryption.decrypt(ciphertext, aad));
      offset = frameEnd;
    }
    return {
      decrypted: chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0),
      remaining: encrypted.subarray(offset),
    };
  }
}
