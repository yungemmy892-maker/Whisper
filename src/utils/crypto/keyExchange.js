/**
 * keyExchange.js — Public key serialisation & private key wrapping
 *
 * IMPORTANT — This module matches the WhisperBox API spec exactly:
 *
 *   The server stores:  wrapped_private_key  +  pbkdf2_salt
 *   Login returns both so the client can unwrap the private key on any device.
 *
 *   Wrapping scheme (per spec):
 *     1. Derive an AES-KW (Key Wrap) key from password via PBKDF2
 *        (random 16-byte salt, 200,000 iterations, SHA-256)
 *     2. Use AES-KW to wrap the PKCS8 private key bytes
 *        (AES-KW is the standard algorithm for key wrapping — no IV needed,
 *         built-in integrity check)
 *     3. Upload base64(wrappedKey) + base64(salt) to server at registration
 *     4. On login: server returns both → client re-derives wrapping key → unwraps
 *
 *   Why AES-KW instead of AES-GCM?
 *   AES-KW is purpose-built for wrapping cryptographic key material.
 *   The Web Crypto API supports wrapKey/unwrapKey natively with AES-KW,
 *   making it cleaner and less error-prone than manual AES-GCM wrapping.
 */

import { bufToBase64, base64ToBuf } from './helpers.js'

const subtle = window.crypto.subtle

// ─── Public Key ───────────────────────────────────────────────────────────────

/**
 * Export an RSA public key to base64-encoded SPKI.
 * Safe to send to the server — it is intentionally public.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKey(publicKey) {
  const buf = await subtle.exportKey('spki', publicKey)
  return bufToBase64(buf)
}

/**
 * Import a base64-encoded SPKI public key.
 * Used to encrypt messages for a recipient.
 * @param {string} spkiBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(spkiBase64) {
  return subtle.importKey(
    'spki',
    base64ToBuf(spkiBase64),
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  )
}

// ─── Private Key Wrapping ─────────────────────────────────────────────────────

/**
 * Wrap the private key using AES-KW derived from the user's password.
 *
 * Returns both the wrapped key AND the salt — both must be sent to the
 * server at registration so the user can recover their key on any device.
 *
 * @param {CryptoKey} privateKey — RSA-OAEP private key
 * @param {string}    password
 * @returns {Promise<{ wrappedPrivateKey: string, pbkdf2Salt: string }>}
 *          Both values are base64 strings ready to POST to the server.
 */
export async function wrapPrivateKey(privateKey, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const wrappingKey = await deriveWrappingKey(password, salt)

  const wrapped = await subtle.wrapKey('pkcs8', privateKey, wrappingKey, 'AES-KW')

  return {
    wrappedPrivateKey: bufToBase64(wrapped),
    pbkdf2Salt:        bufToBase64(salt.buffer),
  }
}

/**
 * Unwrap the private key.
 * Called at login using the wrapped_private_key and pbkdf2_salt the server
 * returned in the login response.
 *
 * Throws DOMException (OperationError) if the password is wrong.
 *
 * @param {string} wrappedPrivateKeyB64 — from login response
 * @param {string} pbkdf2SaltB64        — from login response
 * @param {string} password
 * @returns {Promise<CryptoKey>} RSA-OAEP private key (decrypt only)
 */
export async function unwrapPrivateKey(wrappedPrivateKeyB64, pbkdf2SaltB64, password) {
  const salt       = base64ToBuf(pbkdf2SaltB64)
  const wrappingKey = await deriveWrappingKey(password, new Uint8Array(salt))

  return subtle.unwrapKey(
    'pkcs8',
    base64ToBuf(wrappedPrivateKeyB64),
    wrappingKey,
    'AES-KW',
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,       // not re-extractable after unwrapping
    ['decrypt']
  )
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function deriveWrappingKey(password, salt) {
  const keyMaterial = await subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey']
  )
}
