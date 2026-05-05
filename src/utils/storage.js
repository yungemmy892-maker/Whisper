/**
 * storage.js — Secure client-side key storage via IndexedDB
 *
 * WHY IndexedDB and NOT localStorage:
 *  - localStorage is synchronous, string-only, and easily accessible via XSS
 *  - IndexedDB is async, origin-isolated, and inaccessible cross-origin
 *  - Private keys stored here are ALREADY wrapped with AES-256-GCM (passphrase-derived),
 *    so even if IndexedDB is somehow read, keys are useless without the password
 *
 * Schema:
 *  DB: "whisperbox_v1"
 *  Store: "keys"  { id: username, encryptedPrivateKey: string }
 *  Store: "session" { id: "current", username, tokenExpiry }
 */

const DB_NAME = 'whisperbox_v1'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      if (!db.objectStoreNames.contains('keys')) {
        db.createObjectStore('keys', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'id' })
      }
    }
    req.onsuccess = (e) => resolve(e.target.result)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Store encrypted private key for a user.
 * @param {string} username
 * @param {string} encryptedPrivateKey — base64, AES-GCM wrapped
 */
export async function storePrivateKey(username, encryptedPrivateKey) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    tx.objectStore('keys').put({ id: username, encryptedPrivateKey })
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Retrieve the encrypted private key for a user.
 * @param {string} username
 * @returns {Promise<string|null>}
 */
export async function loadEncryptedPrivateKey(username) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly')
    const req = tx.objectStore('keys').get(username)
    req.onsuccess = () => resolve(req.result?.encryptedPrivateKey ?? null)
    req.onerror = () => reject(req.error)
  })
}

/**
 * Delete a user's private key (e.g. on logout or account deletion).
 * @param {string} username
 */
export async function deletePrivateKey(username) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    tx.objectStore('keys').delete(username)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

/**
 * Check whether a private key exists for the given user on this device.
 * @param {string} username
 * @returns {Promise<boolean>}
 */
export async function hasPrivateKey(username) {
  const key = await loadEncryptedPrivateKey(username)
  return key !== null
}
