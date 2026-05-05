/**
 * encryption.js — Message encryption
 *
 * Output format matches the WhisperBox API spec exactly:
 *   {
 *     ciphertext:          base64  — AES-GCM encrypted message body
 *     iv:                  base64  — 12-byte nonce
 *     encryptedKey:        base64  — AES key wrapped with RECIPIENT's RSA public key
 *     encryptedKeyForSelf: base64  — AES key wrapped with SENDER's RSA public key
 *   }
 *
 * These four values are sent as the WebSocket message.send payload,
 * or to POST /messages as the REST fallback.
 * The server stores all four opaque blobs — it never sees plaintext.
 */

import { bufToBase64 } from './helpers.js'

const subtle = window.crypto.subtle

/**
 * Encrypt a plaintext message.
 *
 * @param {string}    plaintext
 * @param {CryptoKey} recipientPublicKey — RSA-OAEP public key (encrypt)
 * @param {CryptoKey} senderPublicKey    — RSA-OAEP public key (encrypt)
 * @returns {Promise<{
 *   ciphertext:          string,
 *   iv:                  string,
 *   encryptedKey:        string,
 *   encryptedKeyForSelf: string,
 * }>}
 */
export async function encryptMessage(plaintext, recipientPublicKey, senderPublicKey) {
  // 1. Fresh ephemeral AES-256-GCM key per message
  const messageKey = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )

  // 2. Encrypt plaintext
  const iv         = window.crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    messageKey,
    new TextEncoder().encode(plaintext)
  )

  // 3. Export raw AES key for RSA wrapping
  const rawKey = await subtle.exportKey('raw', messageKey)

  // 4. Wrap AES key for recipient AND sender (parallel)
  const [encryptedKey, encryptedKeyForSelf] = await Promise.all([
    subtle.encrypt({ name: 'RSA-OAEP' }, recipientPublicKey, rawKey),
    subtle.encrypt({ name: 'RSA-OAEP' }, senderPublicKey,    rawKey),
  ])

  return {
    ciphertext:          bufToBase64(ciphertext),
    iv:                  bufToBase64(iv.buffer),
    encryptedKey:        bufToBase64(encryptedKey),
    encryptedKeyForSelf: bufToBase64(encryptedKeyForSelf),
  }
}
