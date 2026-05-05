/**
 * decryption.js — Message decryption
 *
 * Accepts the flat field format from the WhisperBox API:
 *   {
 *     ciphertext,          iv,
 *     encryptedKey,        encryptedKeyForSelf
 *   }
 *
 * Steps:
 *   1. Pick the right RSA-wrapped AES key slot (recipient or sender copy)
 *   2. RSA-OAEP decrypt → recover raw AES-GCM key
 *   3. AES-GCM decrypt + authenticate → plaintext
 *
 * Any failure (wrong key, tampered ciphertext) throws.
 * Callers must catch and show a graceful "could not decrypt" fallback.
 */

import { base64ToBuf } from './helpers.js'

const subtle = window.crypto.subtle

/**
 * Decrypt a message received from the server or WebSocket.
 *
 * @param {{ ciphertext: string, iv: string, encryptedKey: string, encryptedKeyForSelf: string }} payload
 * @param {CryptoKey} privateKey — caller's RSA-OAEP private key
 * @param {boolean}   isSender   — true = use encryptedKeyForSelf slot
 * @returns {Promise<string>} plaintext
 */
export async function decryptMessage(payload, privateKey, isSender) {
  const { ciphertext, iv, encryptedKey, encryptedKeyForSelf } = payload

  if (!ciphertext || !iv || !encryptedKey || !encryptedKeyForSelf) {
    throw new Error('Incomplete message payload.')
  }

  // 1. Pick the correct wrapped AES key
  const wrappedAesKey = base64ToBuf(isSender ? encryptedKeyForSelf : encryptedKey)

  // 2. RSA-unwrap the AES key (throws if wrong private key)
  const rawAesKey = await subtle.decrypt(
    { name: 'RSA-OAEP' },
    privateKey,
    wrappedAesKey
  )

  // 3. Import the raw bytes as an AES-GCM key
  const messageKey = await subtle.importKey(
    'raw', rawAesKey,
    { name: 'AES-GCM', length: 256 },
    false, ['decrypt']
  )

  // 4. AES-GCM decrypt + verify auth tag (throws if tampered)
  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64ToBuf(iv)) },
    messageKey,
    base64ToBuf(ciphertext)
  )

  return new TextDecoder().decode(plainBuf)
}
