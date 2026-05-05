/**
 * keyGeneration.js — RSA-OAEP key pair generation
 *
 * Responsible for one thing: creating a fresh 2048-bit RSA-OAEP key pair
 * in the browser using the Web Crypto API.
 *
 * Why RSA-OAEP?
 *   - Asymmetric: public key can be shared freely; only holder of
 *     the private key can decrypt.
 *   - OAEP padding is the secure modern standard (vs. PKCS1v1.5).
 *   - SHA-256 as the hash function provides 128-bit collision resistance.
 *
 * Why 2048-bit modulus?
 *   - Widely accepted as secure for the next decade.
 *   - Supported by all Web Crypto API implementations.
 *   - 4096-bit would be stronger but noticeably slower for key generation.
 */

const subtle = window.crypto.subtle

/**
 * Generate a new RSA-OAEP 2048-bit key pair.
 *
 * The returned keys are:
 *  - publicKey:  extractable (so we can export SPKI to send to the server)
 *  - privateKey: extractable (so we can wrap it with PBKDF2+AES before storing)
 *
 * @returns {Promise<CryptoKeyPair>} { publicKey, privateKey }
 */
export async function generateKeyPair() {
  return subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]), // 65537
      hash: 'SHA-256',
    },
    true,             // extractable — needed so we can export/wrap
    ['encrypt', 'decrypt']   // Web Crypto requires BOTH listed at generateKey time;
                             // the returned publicKey gets 'encrypt', privateKey gets 'decrypt'
  )
}
