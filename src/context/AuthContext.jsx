/**
 * AuthContext.jsx
 */

import { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react'
import {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  wrapPrivateKey,
  unwrapPrivateKey,
} from '../utils/crypto'
import {
  register          as apiRegister,
  login             as apiLogin,
  logout            as apiLogout,
  refreshToken      as apiRefreshToken,  // renamed import to avoid shadowing
  WS_URL,
} from '../utils/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token,       setToken]       = useState(null)
  const [refreshTok,  setRefreshTok]  = useState(null)
  const [user,        setUser]        = useState(null)
  const [privateKey,  setPrivateKey]  = useState(null)
  const [publicKey,   setPublicKey]   = useState(null)
  const [keygenState, setKeygenState] = useState(null)

  const refreshTimerRef = useRef(null)
  const wsRef           = useRef(null)
  const tokenRef        = useRef(null)      // always reflects latest token for callbacks
  const refreshTokRef   = useRef(null)      // same for refresh token

  useEffect(() => { tokenRef.current    = token    }, [token])
  useEffect(() => { refreshTokRef.current = refreshTok }, [refreshTok])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  // WS errors/closes NEVER trigger logout — REST fallback is always available.
  // Messages are dispatched as a custom window event so any component can listen
  // without needing ws in context (avoids stale-closure issues).

  const openWebSocket = useCallback((accessToken) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    try {
      const socket = new WebSocket(`${WS_URL}?token=${accessToken}`)
      wsRef.current = socket
      window.__wbSocket = socket

      socket.onopen    = () => {
        console.log('[WS] connected')
        window.dispatchEvent(new CustomEvent('wb:ws:open'))
      }
      socket.onerror   = (e) => console.warn('[WS] error — REST fallback active', e)
      socket.onclose   = (e) => {
        wsRef.current = null
        if (window.__wbSocket === socket) window.__wbSocket = null
        window.dispatchEvent(new CustomEvent('wb:ws:close'))
        if (e.code !== 1000 && tokenRef.current) {
          setTimeout(() => openWebSocket(tokenRef.current), 4000)
        }
      }
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(event.data)
          window.dispatchEvent(new CustomEvent('wb:message', { detail: frame }))
        } catch {}
      }
    } catch (err) {
      console.warn('[WS] could not open — REST fallback active:', err.message)
    }
  }, [])

  // ── Token refresh ──────────────────────────────────────────────────────────
  // BUG FIX: renamed import to apiRefreshToken so the local `refreshToken`
  // parameter name doesn't shadow the imported function.

  const scheduleRefresh = useCallback((currentRefreshToken) => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = setTimeout(async () => {
      try {
        const data = await apiRefreshToken(currentRefreshToken)  // ← no longer shadowed
        setToken(data.access_token)
        tokenRef.current = data.access_token
        openWebSocket(data.access_token)
        scheduleRefresh(currentRefreshToken)   // keep refreshing with same refresh token
      } catch (err) {
        console.error('[Auth] token refresh failed:', err.message)
        doLogout()
      }
    }, 13 * 60 * 1000)
  }, [openWebSocket])

  // ── Session hydration (shared between register + login) ───────────────────
  // Refs are updated FIRST (synchronous) so any callbacks scheduled immediately
  // after (openWebSocket, scheduleRefresh) see the correct values.

  const hydrateSession = useCallback((data, privateKeyObj, publicKeyObj) => {
    const usr = data.user || {}
    // Update refs immediately — callbacks need these right away
    tokenRef.current      = data.access_token
    refreshTokRef.current = data.refresh_token
    // Then trigger React re-renders
    setUser(usr)
    setPrivateKey(privateKeyObj)
    setPublicKey(publicKeyObj)
    setRefreshTok(data.refresh_token)
    setToken(data.access_token)    // ← isAuthenticated becomes true on next render
  }, [])

  // ── Register ───────────────────────────────────────────────────────────────

 const registerUser = useCallback(async (username, displayName, password) => {
    setKeygenState('generating')
    try {
      await new Promise(r => setTimeout(r, 50))

      const kp     = await generateKeyPair()
      const pubB64 = await exportPublicKey(kp.publicKey)
      const { wrappedPrivateKey, pbkdf2Salt } = await wrapPrivateKey(kp.privateKey, password)

      // ✅ FIX: Pass a single object with the required fields (matches api.js signature)
      const data = await apiRegister({
        username,
        password,
        publicKey: pubB64,
        wrappedPrivateKey,
        pbkdf2Salt,
        displayName
      })

      // 4. Import public key — use server's copy if present, fall back to ours
      //    Guard against undefined to prevent a confusing importPublicKey error
      const serverPubKey = data.user?.public_key
      if (serverPubKey && typeof serverPubKey !== 'string') {
        throw new Error('Server returned an unexpected public_key format.')
      }
      const pubKeyObj = await importPublicKey(serverPubKey || pubB64)

      // 5. Hydrate session fully — this sets isAuthenticated = true
      hydrateSession(data, kp.privateKey, pubKeyObj)

      // 6. Open WS and schedule token refresh AFTER session is live
      openWebSocket(data.access_token)
      scheduleRefresh(data.refresh_token)

      return data
    } catch (err) {
      // Re-throw so AuthScreen.handleSubmit can display the error
      throw err
    } finally {
      // Always clears overlay — App.jsx transitions to main UI if token is set,
      // or back to AuthScreen if token was never set (error path)
      setKeygenState(null)
    }
  }, [openWebSocket, scheduleRefresh, hydrateSession])

  // ── Login ──────────────────────────────────────────────────────────────────

 const loginUser = useCallback(async (username, password) => {
  const data = await apiLogin(username, password)

  // ✅ Key fields are inside the nested `user` object
  const userData = data.user || {}
  const wrappedPrivateKey = userData.wrapped_private_key
  const pbkdf2Salt = userData.pbkdf2_salt
  const serverPublicKey = userData.public_key

  if (!wrappedPrivateKey || !pbkdf2Salt) {
    throw new Error('Server did not return key material. Try registering again.')
  }
  if (!serverPublicKey) {
    throw new Error('Server did not return a public key for this account.')
  }

  // Unwrap private key using password
  const privKey = await unwrapPrivateKey(wrappedPrivateKey, pbkdf2Salt, password)
    .catch(() => { throw new Error('Wrong password or corrupted key data.') })

  const pubKeyObj = await importPublicKey(serverPublicKey)

  // Hydrate session (tokens are at top‑level, user object is stored as is)
  hydrateSession(data, privKey, pubKeyObj)
  openWebSocket(data.access_token)
  scheduleRefresh(data.refresh_token)

  return data
}, [openWebSocket, scheduleRefresh, hydrateSession])

  const doLogout = useCallback(async () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close(1000, 'logout')
      wsRef.current = null
    }
    try {
      if (tokenRef.current && refreshTokRef.current) {
        await apiLogout(tokenRef.current, refreshTokRef.current)
      }
    } catch { /* ignore — clear state regardless */ }

    tokenRef.current      = null
    refreshTokRef.current = null
    setToken(null)
    setRefreshTok(null)
    setUser(null)
    setPrivateKey(null)
    setPublicKey(null)
  }, [])

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    if (wsRef.current) wsRef.current.close(1000)
  }, [])

  return (
    <AuthContext.Provider value={{
      token, user, privateKey, publicKey,
      keygenState,
      isAuthenticated: !!token,
      registerUser,
      loginUser,
      logout: doLogout,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
