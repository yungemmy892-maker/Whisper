/**
 * crypto/index.js — Public API for the crypto layer
 *
 * Re-exports everything from the four focused modules:
 *
 *   keyGeneration  — generateKeyPair()
 *   keyExchange    — exportPublicKey(), importPublicKey(),
 *                    wrapPrivateKey(), unwrapPrivateKey()
 *   encryption     — encryptMessage()
 *   decryption     — decryptMessage()
 *
 * Consumers import from this file only:
 *   import { encryptMessage, decryptMessage } from '../utils/crypto'
 *
 * The internal module split is an implementation detail — it keeps
 * each concern small, testable, and easy to reason about in isolation.
 */

export { generateKeyPair }                              from './keyGeneration.js'
export { exportPublicKey, importPublicKey,
         wrapPrivateKey, unwrapPrivateKey }             from './keyExchange.js'
export { encryptMessage }                               from './encryption.js'
export { decryptMessage }                               from './decryption.js'
