/**
 * Curve utilities for HAP key exchange and device authentication.
 *
 * Combines:
 *  - X25519 utilities for HAP key exchange (elliptic curve Diffie-Hellman)
 *  - Ed25519 utilities for HAP device authentication (digital signatures)
 *
 * Ported to portable Node.js using @noble/curves.
 */

import { x25519, ed25519 } from "@noble/curves/ed25519";
import { createLogger } from "./logging";

/**
 * Error thrown when cryptographic operations fail
 */
export class CryptoError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "CryptoError";
    this.cause = cause;
  }
}

const x25519Logger = createLogger("bunatv:crypto:x25519");
const ed25519Logger = createLogger("bunatv:crypto:ed25519");

/**
 * X25519 utilities for HAP key exchange
 */
export class X25519Utils {
  private static algorithm = "X25519";

  /**
   * Generate X25519 key pair from deterministic seed (for testing)
   *
   * @param seed - 32-byte deterministic seed
   * @returns Key pair derived from seed
   */
  static generateKeyPairFromSeed(seed: Uint8Array): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    if (seed.length !== 32) {
      throw new CryptoError(`X25519 seed must be 32 bytes, got ${seed.length}`);
    }

    try {
      // Use @noble/curves/x25519 for deterministic key generation
      const publicKey = x25519.getPublicKey(seed);

      return {
        privateKey: new Uint8Array(seed),
        publicKey: new Uint8Array(publicKey),
      };
    } catch (error) {
      x25519Logger.error({ error }, "generateKeyPairFromSeed failed");
      throw new CryptoError("Failed to generate X25519 key pair from seed", error as Error);
    }
  }

  /**
   * Generate a new X25519 key pair
   *
   * @returns Object containing private and public keys
   */
  static async generateKeyPair(): Promise<{
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  }> {
    x25519Logger.debug("Starting key pair generation...");
    x25519Logger.debug("Using @noble/curves/x25519 (more reliable than WebCrypto for X25519)...");
    // @noble/curves is the real path (WebCrypto doesn't support raw X25519 export).
    try {
      return this.generateKeyPairSync();
    } catch (syncError) {
      throw new CryptoError("Failed to generate X25519 key pair", syncError as Error);
    }
  }

  /**
   * Perform X25519 key exchange
   *
   * @param privateKey - Our private key
   * @param publicKey - Peer's public key
   * @returns Shared secret
   */
  static async computeSharedSecret(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
    // Use sync implementation since WebCrypto X25519 raw key import is problematic
    return this.computeSharedSecretSync(privateKey, publicKey);
  }

  /**
   * Generate X25519 key pair synchronously
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static generateKeyPairSync(): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    x25519Logger.debug("generateKeyPairSync: Using @noble/curves/x25519...");
    try {
      x25519Logger.debug("generateKeyPairSync: Generating random private key...");

      // Generate random private key (32 bytes)
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);

      x25519Logger.debug(`generateKeyPairSync: Private key length: ${privateKey.length}`);
      x25519Logger.debug(`generateKeyPairSync: Public key length: ${publicKey.length}`);

      const result = {
        privateKey: new Uint8Array(privateKey),
        publicKey: new Uint8Array(publicKey),
      };

      x25519Logger.debug("generateKeyPairSync: Noble key generation successful");
      return result;
    } catch (error) {
      x25519Logger.error({ error }, "generateKeyPairSync failed");
      throw new CryptoError("Failed to generate X25519 key pair with Noble", error as Error);
    }
  }

  /**
   * Compute X25519 shared secret synchronously
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static computeSharedSecretSync(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
    x25519Logger.debug("computeSharedSecretSync: Using @noble/curves/x25519...");
    try {
      const secret = x25519.getSharedSecret(privateKey, publicKey);
      x25519Logger.debug(`computeSharedSecretSync: Shared secret length: ${secret.length}`);
      return new Uint8Array(secret);
    } catch (error) {
      x25519Logger.error({ error }, "computeSharedSecretSync failed");
      throw new CryptoError("Failed to compute X25519 shared secret with Noble", error as Error);
    }
  }
}

/**
 * Ed25519 utilities for HAP device authentication
 */
export class Ed25519Utils {
  private static algorithm = "Ed25519";

  /**
   * Generate a new Ed25519 key pair (WebCrypto primary, Noble fallback)
   *
   * We try WebCrypto first, then fall back to Noble for maximum compatibility.
   *
   * @returns Object containing private and public keys (32 bytes each)
   */
  static async generateKeyPair(): Promise<{
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  }> {
    ed25519Logger.debug("Starting key generation...");

    // Try WebCrypto first
    try {
      ed25519Logger.debug("Using WebCrypto Ed25519 (native)...");
      const keyPair = (await crypto.subtle.generateKey(
        {
          name: this.algorithm,
        },
        true,
        ["sign", "verify"],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )) as any;

      // Export in supported formats (not 'raw')
      const privateKeyPkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const publicKeySpki = await crypto.subtle.exportKey("spki", keyPair.publicKey);

      // Extract raw keys from structured formats
      const privateKey = this.extractRawPrivateKeyFromPkcs8(new Uint8Array(privateKeyPkcs8));
      const publicKey = this.extractRawPublicKeyFromSpki(new Uint8Array(publicKeySpki));

      ed25519Logger.debug("WebCrypto PKCS8/SPKI extraction successful");
      return { privateKey, publicKey };
    } catch (webCryptoError) {
      ed25519Logger.debug({ error: webCryptoError }, "WebCrypto failed, falling back to @noble/curves...");

      // Fall back to Noble
      try {
        ed25519Logger.debug("Using @noble/curves/ed25519 (fallback)...");
        return this.generateKeyPairSync();
      } catch (nobleError) {
        ed25519Logger.error(
          {
            webCryptoError,
            nobleError,
          },
          "All methods failed",
        );
        throw new CryptoError("Failed to generate Ed25519 key pair (all methods failed)", webCryptoError as Error);
      }
    }
  }

  /**
   * Extract raw 32-byte private key from PKCS8 DER format
   * PKCS8 Ed25519 structure: 48 bytes total, raw key is bytes 16-47
   */
  private static extractRawPrivateKeyFromPkcs8(pkcs8: Uint8Array): Uint8Array {
    if (pkcs8.length !== 48) {
      throw new Error(`Invalid PKCS8 Ed25519 length: expected 48, got ${pkcs8.length}`);
    }
    // The raw private key is in bytes 16-47 of the PKCS8 structure
    return pkcs8.slice(16, 48);
  }

  /**
   * Extract raw 32-byte public key from SPKI DER format
   * SPKI Ed25519 structure: 44 bytes total, raw key is bytes 12-43
   */
  private static extractRawPublicKeyFromSpki(spki: Uint8Array): Uint8Array {
    if (spki.length !== 44) {
      throw new Error(`Invalid SPKI Ed25519 length: expected 44, got ${spki.length}`);
    }
    // The raw public key is in bytes 12-43 of the SPKI structure
    return spki.slice(12, 44);
  }

  /**
   * Sign data with Ed25519 private key
   *
   * @param data - Data to sign
   * @param privateKey - Ed25519 private key (32 bytes)
   * @returns Signature (64 bytes)
   */
  static async sign(data: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    ed25519Logger.debug(`Sign: data=${data.length}B, key=${privateKey.length}B`);

    // Use @noble/curves/ed25519 for raw key operations
    try {
      return this.signSync(data, privateKey);
    } catch (error) {
      ed25519Logger.error(error, "Signing failed");
      throw new CryptoError("Failed to sign with Ed25519", error as Error);
    }
  }

  /**
   * Verify Ed25519 signature
   *
   * @param signature - Signature to verify (64 bytes)
   * @param data - Original data
   * @param publicKey - Ed25519 public key (32 bytes)
   * @returns True if signature is valid
   */
  static async verify(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    ed25519Logger.debug(`Verify: sig=${signature.length}B, data=${data.length}B, key=${publicKey.length}B`);

    // Use @noble/curves/ed25519 for raw key operations
    try {
      return this.verifySync(signature, data, publicKey);
    } catch (error) {
      ed25519Logger.error(error, "Verification failed");
      throw new CryptoError("Failed to verify Ed25519 signature", error as Error);
    }
  }

  /**
   * Generate Ed25519 key pair from deterministic seed (for testing)
   *
   * @param seed - 32-byte deterministic seed (like pyatv's PRIVATE_KEY)
   * @returns Key pair derived from seed
   */
  static generateKeyPairFromSeed(seed: Uint8Array): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    if (seed.length !== 32) {
      throw new CryptoError(`Ed25519 seed must be 32 bytes, got ${seed.length}`);
    }

    try {
      // Use @noble/curves/ed25519 for deterministic key generation
      const publicKey = ed25519.getPublicKey(seed);

      return {
        privateKey: new Uint8Array(seed),
        publicKey: new Uint8Array(publicKey),
      };
    } catch (error) {
      ed25519Logger.error(error, "generateKeyPairFromSeed failed");
      throw new CryptoError("Failed to generate Ed25519 key pair from seed", error as Error);
    }
  }

  /**
   * Generate Ed25519 key pair synchronously
   * Uses Noble for synchronous operations
   */
  static generateKeyPairSync(): {
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  } {
    ed25519Logger.debug("generateKeyPairSync: Using @noble/curves/ed25519...");
    try {
      // Generate random private key (32 bytes)
      const privateKey = ed25519.utils.randomPrivateKey();
      const publicKey = ed25519.getPublicKey(privateKey);

      ed25519Logger.debug(`generateKeyPairSync: Private key length: ${privateKey.length}`);
      ed25519Logger.debug(`generateKeyPairSync: Public key length: ${publicKey.length}`);

      const result = {
        privateKey: new Uint8Array(privateKey), // 32 bytes
        publicKey: new Uint8Array(publicKey), // 32 bytes
      };

      ed25519Logger.debug(`generateKeyPairSync: Final private key length: ${result.privateKey.length}`);
      ed25519Logger.debug(`generateKeyPairSync: Final public key length: ${result.publicKey.length}`);
      ed25519Logger.debug("generateKeyPairSync: Noble key generation successful");
      return result;
    } catch (error) {
      ed25519Logger.error(error, "generateKeyPairSync failed");
      throw new CryptoError("Failed to generate Ed25519 key pair with Noble", error as Error);
    }
  }

  /**
   * Sign data synchronously
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static signSync(data: Uint8Array, privateKey: Uint8Array): Uint8Array {
    try {
      // Noble expects a 32-byte private key
      if (privateKey.length !== 32) {
        throw new Error(`Invalid private key length: expected 32, got ${privateKey.length}`);
      }

      const signature = ed25519.sign(data, privateKey);
      ed25519Logger.debug(`Sign successful: signature=${signature.length}B`);
      return new Uint8Array(signature);
    } catch (error) {
      throw new CryptoError("Failed to sign with Ed25519", error as Error);
    }
  }

  /**
   * Verify Ed25519 signature synchronously
   * Uses Noble for sync operations since WebCrypto is async-only
   */
  static verifySync(signature: Uint8Array, data: Uint8Array, publicKey: Uint8Array): boolean {
    try {
      const isValid = ed25519.verify(signature, data, publicKey);
      ed25519Logger.debug(`Verify result: ${isValid}`);
      return isValid;
    } catch (error) {
      throw new CryptoError("Failed to verify Ed25519 signature", error as Error);
    }
  }
}
