/**
 * api.js — WhisperBox API client
 *
 * Base URL : https://whisperbox.koyeb.app
 * WebSocket: wss://whisperbox.koyeb.app/ws?token=<access_token>
 *
 * All field names in this file match the official API spec exactly.
 * Payload fields are camelCase: encryptedKey, encryptedKeyForSelf
 * REST body top-level field for recipient is `to` (not recipient_id)
 */

export const BASE_URL = 'https://whisperbox.koyeb.app'
export const WS_URL   = 'wss://whisperbox.koyeb.app/ws'

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function apiFetch(path, options = {}, token = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })

  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') {
        message = body.detail
      } else if (Array.isArray(body.detail)) {
        message = body.detail.map(e => e.msg || JSON.stringify(e)).join(', ')
      } else {
        message = body.message || JSON.stringify(body)
      }
    } catch {
      message = res.statusText || message
    }
    throw new Error(message)
  }

  if (res.status === 204) return null
  return res.json()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/**
 * POST /auth/register
 *
 * Request body:
 *   username        — 3–32 chars, letters/digits/_/- only
 *   display_name    — human-readable name shown in UI
 *   password        — 8–128 chars
 *   public_key      — base64 RSA-OAEP SPKI
 *   wrapped_private_key — base64 AES-KW encrypted PKCS8
 *   pbkdf2_salt     — base64 128-bit salt
 *
 * Response 201:
 *   { access_token, refresh_token, token_type, expires_in, user: { id, username, display_name, public_key, ... } }
 */
/**
 * Register a new user.
 *
 * @param {string} username
 * @param {string} password
 * @param {string} publicKey         — base64 SPKI
 * @param {string} wrappedPrivateKey — AES-KW wrapped PKCS8, base64
 * @param {string} pbkdf2Salt        — base64, 16 bytes
 * @param {string} displayName       — display name (required by backend)
 * @returns {Promise<{ access_token, refresh_token, user: { id, username, public_key } }>}
 */
export async function register({
  username,
  password,
  publicKey,
  wrappedPrivateKey,
  pbkdf2Salt,
  displayName   // ← ADD THIS PARAMETER
}) 
 {
  return apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password,
      public_key:          publicKey,
      wrapped_private_key: wrappedPrivateKey,
      pbkdf2_salt:         pbkdf2Salt,
      display_name:        displayName,   // ← ADD THIS FIELD
    }),
  })
}

/**
 * POST /auth/login
 *
 * Response 200 — same shape as /auth/register response.
 * Includes wrapped_private_key + pbkdf2_salt so client can restore the session.
 */
export async function login(username, password) {
  return apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

/**
 * POST /auth/refresh
 * Response: { access_token, token_type, expires_in }
 */
export async function refreshToken(refreshTok) {
  return apiFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshTok }),
  })
}

/**
 * POST /auth/logout  — revokes the refresh token
 */
export async function logout(token, refreshTok) {
  return apiFetch('/auth/logout', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshTok }),
  }, token)
}

// ─── Users ────────────────────────────────────────────────────────────────────

/**
 * GET /users/search?q=<query>
 * Response: Array<{ id, username, display_name }>
 */
export async function searchUsers(query, token) {
  return apiFetch(`/users/search?q=${encodeURIComponent(query)}`, {}, token)
}

/**
 * GET /users/{userId}/public-key
 * Response: { public_key: "<base64 RSA-OAEP SPKI>" }
 */
export async function getUserPublicKey(userId, token) {
  return apiFetch(`/users/${userId}/public-key`, {}, token)
}

// ─── Conversations ────────────────────────────────────────────────────────────

/**
 * GET /conversations
 * Response: Array<{ user_id, display_name, username, last_message_at }>
 */
export async function getConversations(token) {
  return apiFetch('/conversations', {}, token)
}

/**
 * GET /conversations/{userId}/messages
 *
 * Messages are returned newest-first — reverse before display.
 * Response: Array<{ id, from_user_id, to_user_id, payload, delivered, created_at }>
 *
 * payload shape: { ciphertext, iv, encryptedKey, encryptedKeyForSelf }
 *   — all camelCase, all base64
 *
 * @param {string}      userId
 * @param {string}      token
 * @param {string|null} before — ISO-8601 timestamp cursor for pagination
 * @param {number}      limit  — 1–100, default 50
 */
export async function getMessages(userId, token, before = null, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)
  return apiFetch(`/conversations/${userId}/messages?${params}`, {}, token)
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/**
 * POST /messages  — REST fallback when WebSocket is unavailable
 *
 * Request body (exact field names from API spec):
 *   {
 *     "to": "<recipient UUID>",           ← field is `to`, NOT `recipient_id`
 *     "payload": {
 *       "ciphertext":          "<base64>",
 *       "iv":                  "<base64>",
 *       "encryptedKey":        "<base64>", ← camelCase
 *       "encryptedKeyForSelf": "<base64>"  ← camelCase
 *     }
 *   }
 *
 * Response 201: MessageResponse
 *   { id, from_user_id, to_user_id, payload, delivered, created_at }
 *
 * @param {string} recipientId
 * @param {{ ciphertext, iv, encryptedKey, encryptedKeyForSelf }} payload
 * @param {string} token
 */
export async function sendMessageREST(recipientId, { ciphertext, iv, encryptedKey, encryptedKeyForSelf }, token) {
  return apiFetch('/messages', {
    method: 'POST',
    body: JSON.stringify({
      to: recipientId,          // spec field name is `to`
      payload: {
        ciphertext,
        iv,
        encryptedKey,           // camelCase — matches spec exactly
        encryptedKeyForSelf,    // camelCase — matches spec exactly
      },
    }),
  }, token)
}
