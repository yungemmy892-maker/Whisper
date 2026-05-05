/**
 * helpers.js — Shared binary/base64 utilities
 *
 * These are the only conversion functions used across the entire
 * crypto layer. Centralised here to avoid duplication and subtle bugs.
 */

/**
 * ArrayBuffer → base64 string
 * @param {ArrayBuffer} buf
 * @returns {string}
 */
export function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

/**
 * base64 string → ArrayBuffer
 * @param {string} b64
 * @returns {ArrayBuffer}
 */
export function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer
}
