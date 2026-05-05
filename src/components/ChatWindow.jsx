import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { encryptMessage, decryptMessage, importPublicKey } from '../utils/crypto'
import { getMessages, getUserPublicKey, sendMessageREST } from '../utils/api'
import EncryptionBanner, { DecryptedChip, DecryptErrorChip } from './EncryptionBanner'
import styles from './ChatWindow.module.css'

export default function ChatWindow({ conversation, onConversationUpdate, onBack, mobileVisible }) {
  const { user, token, privateKey, publicKey } = useAuth()

  const [messages,        setMessages]        = useState([])
  const [loading,         setLoading]         = useState(false)
  const [text,            setText]            = useState('')
  const [sending,         setSending]         = useState(false)
  const [sendError,       setSendError]       = useState('')
  const [hasDecryptError, setHasDecryptError] = useState(false)
  const [wsConnected,     setWsConnected]     = useState(false)

  const bottomRef      = useRef(null)
  const textareaRef    = useRef(null)
  const pollRef        = useRef(null)
  // Cache recipient public key so we don't re-fetch every send
  const recipientPubKeyRef = useRef(null)
  const recipientIdRef     = useRef(null)

  // Track WS connection state
  useEffect(() => {
    const onOpen  = () => { setWsConnected(true);  clearPolling() }
    const onClose = () => { setWsConnected(false); startPolling() }
    window.addEventListener('wb:ws:open',  onOpen)
    window.addEventListener('wb:ws:close', onClose)
    // If WS is already open when we mount, reflect that
    const sock = window.__wbSocket
    if (sock && sock.readyState === WebSocket.OPEN) setWsConnected(true)
    return () => {
      window.removeEventListener('wb:ws:open',  onOpen)
      window.removeEventListener('wb:ws:close', onClose)
      clearPolling()
    }
  }, [])

  const recipientId   = conversation?.user_id  || null
  const recipientName = conversation?.display_name || conversation?.username || '?'

  // ── Decrypt one message ────────────────────────────────────────────────────
  // API payload shape (camelCase per spec):
  //   { ciphertext, iv, encryptedKey, encryptedKeyForSelf }
  const decryptOne = useCallback(async (m) => {
    if (m.decrypted) return m   // skip already-decrypted optimistic messages
    try {
      const isSender = m.from_user_id === user?.id
      const p = m.payload || {}
      const plain = await decryptMessage(
        {
          ciphertext:          p.ciphertext,
          iv:                  p.iv,
          encryptedKey:        p.encryptedKey,        // camelCase — spec is definitive
          encryptedKeyForSelf: p.encryptedKeyForSelf,
        },
        privateKey,
        isSender
      )
      return { ...m, plaintext: plain, decrypted: true }
    } catch (err) {
      return { ...m, plaintext: null, decrypted: false, decryptError: err.message }
    }
  }, [privateKey, user])

  // ── Load / refresh messages ────────────────────────────────────────────────
  const loadMessages = useCallback(async (showSpinner = true) => {
    if (!recipientId || !privateKey) return
    if (showSpinner) setLoading(true)
    try {
      const raw  = await getMessages(recipientId, token)
      const msgs = Array.isArray(raw) ? raw : (raw?.messages ?? [])
      const decrypted = await Promise.all(msgs.map(decryptOne))
      // API returns newest-first — reverse for chronological display
      setMessages(decrypted.reverse())
      setHasDecryptError(decrypted.some(m => !m.decrypted))
    } catch (err) {
      console.error('Failed to load messages:', err)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [recipientId, token, privateKey, decryptOne])

  // ── Polling (fallback when WS is offline) ─────────────────────────────────
  // Polls every 4 seconds so the recipient always gets messages even without WS.
  // Cleared as soon as WS connects.
  function startPolling() {
    if (pollRef.current) return  // already polling
    pollRef.current = setInterval(() => loadMessages(false), 4000)
  }

  function clearPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  // ── Reset + load on conversation change ───────────────────────────────────
  useEffect(() => {
    setMessages([])
    setText('')
    setSendError('')
    setHasDecryptError(false)
    recipientPubKeyRef.current = null
    recipientIdRef.current     = recipientId

    clearPolling()
    if (conversation) {
      loadMessages(true)
      // Start polling immediately — WS may not be connected yet
      // Polling stops automatically once WS opens (see onOpen above)
      const sock = window.__wbSocket
      if (!sock || sock.readyState !== WebSocket.OPEN) startPolling()
    }
    return () => clearPolling()
  }, [conversation?.user_id])

  // ── Incoming WebSocket messages ────────────────────────────────────────────
  useEffect(() => {
    const handler = async (event) => {
      const frame = event.detail
      // Spec uses `event` field, not `type`
      if (frame.event !== 'message.receive') return
      const raw = frame   // WS receive frame IS the message: { event, id, from_user_id, to_user_id, payload, created_at }

      // Only handle messages for the active conversation
      const activeId = recipientIdRef.current
      if (!activeId) return
      if (raw.from_user_id !== activeId && raw.to_user_id !== activeId) return

      const decrypted = await decryptOne(raw)
      setMessages(prev => {
        // Deduplicate against optimistic messages and previous WS deliveries
        if (prev.find(m => m.id === decrypted.id)) return prev
        return [...prev, decrypted]
      })
      if (!decrypted.decrypted) setHasDecryptError(true)
      onConversationUpdate?.()
    }

    window.addEventListener('wb:message', handler)
    return () => window.removeEventListener('wb:message', handler)
  }, [decryptOne, onConversationUpdate])

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ── Send ───────────────────────────────────────────────────────────────────
  async function handleSend() {
    if (!text.trim() || sending || !conversation || !recipientId) return
    setSendError('')
    setSending(true)

    const plaintext = text.trim()
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    try {
      // Cache recipient public key — fetch once per conversation, not per message
      if (!recipientPubKeyRef.current || recipientIdRef.current !== recipientId) {
        const pkData = await getUserPublicKey(recipientId, token)
        // API returns { public_key: "base64..." }
        const rawKey = pkData?.public_key ?? pkData?.publicKey
        if (!rawKey) throw new Error(`Could not retrieve public key for recipient.`)
        recipientPubKeyRef.current = await importPublicKey(rawKey)
        recipientIdRef.current     = recipientId
      }

      // Encrypt — plaintext never reaches the server
      const encrypted = await encryptMessage(plaintext, recipientPubKeyRef.current, publicKey)

      // Optimistic message — exact API schema shape with camelCase payload
      const optimistic = {
        id:           `optimistic-${Date.now()}`,
        from_user_id: user?.id,
        to_user_id:   recipientId,
        payload: {
          ciphertext:          encrypted.ciphertext,
          iv:                  encrypted.iv,
          encryptedKey:        encrypted.encryptedKey,        // camelCase
          encryptedKeyForSelf: encrypted.encryptedKeyForSelf, // camelCase
        },
        delivered:  false,
        created_at: new Date().toISOString(),
        plaintext,
        decrypted:  true,
      }
      setMessages(prev => [...prev, optimistic])

      // ── Deliver the message ──────────────────────────────────────────────
      const sock = window.__wbSocket
      if (sock && sock.readyState === WebSocket.OPEN) {
        // WS send — exact frame shape from spec:
        // { event: "message.send", to: "<uuid>", payload: { ciphertext, iv, encryptedKey, encryptedKeyForSelf } }
        sock.send(JSON.stringify({
          event: 'message.send',           // spec uses `event`, not `type`
          to:    recipientId,              // spec uses `to`, not `recipient_id`
          payload: {
            ciphertext:          encrypted.ciphertext,
            iv:                  encrypted.iv,
            encryptedKey:        encrypted.encryptedKey,        // camelCase
            encryptedKeyForSelf: encrypted.encryptedKeyForSelf, // camelCase
          },
        }))
      } else {
        // REST fallback — POST /messages
        // sendMessageREST handles `to` field and camelCase payload internally
        await sendMessageREST(recipientId, {
          ciphertext:          encrypted.ciphertext,
          iv:                  encrypted.iv,
          encryptedKey:        encrypted.encryptedKey,
          encryptedKeyForSelf: encrypted.encryptedKeyForSelf,
        }, token)
      }

      // Refresh conversation list AFTER successful delivery
      onConversationUpdate?.()
      textareaRef.current?.focus()

    } catch (err) {
      // Roll back optimistic message on failure
      setMessages(prev => prev.filter(m => !m.id.startsWith('optimistic-')))
      setSendError(err.message || 'Failed to send.')
      setText(plaintext)
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  function autoResize(e) {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
    setText(e.target.value)
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!conversation) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>🔐</div>
        <h2>End-to-End Encrypted</h2>
        <p>
          Select a conversation or start a new one.<br />
          Messages are encrypted <strong>before</strong> leaving your device —<br />
          the server stores only ciphertext.
        </p>
        <div className={styles.techBadges}>
          <span>RSA-OAEP 2048</span>
          <span>AES-256-GCM</span>
          <span>WebSocket</span>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.window} ${mobileVisible === false ? styles.hidden : ''}`}>

      {/* Header */}
      <div className={styles.header}>
        {/* Back button — only visible on mobile via CSS */}
        <button className={styles.backBtn} onClick={onBack} aria-label="Back">
          ‹
        </button>
        <div className={styles.headerAvatar}>{recipientName[0]?.toUpperCase()}</div>
        <div className={styles.headerInfo}>
          <h3 className={styles.headerName}>{recipientName}</h3>
          <p className={styles.headerSub}>RSA-OAEP key exchange · AES-256-GCM encrypted</p>
        </div>
        <div className={`${styles.e2eeBadge} ${wsConnected ? '' : styles.e2eeBadgeOffline}`}>
          <div className={styles.dot} />
          <span>{wsConnected ? 'E2EE · Live' : 'E2EE · Polling'}</span>
        </div>
      </div>

      {/* Security banner */}
      {hasDecryptError
        ? <EncryptionBanner variant="error" />
        : <EncryptionBanner variant="active" />
      }

      {/* Messages */}
      <div className={styles.messages}>
        {loading && (
          <div className={styles.loadingRow}>
            <span className={styles.spinner} />
            <span>Decrypting messages…</span>
          </div>
        )}

        {!loading && messages.length === 0 && (
          <div className={styles.noMessages}>
            🔒 End-to-end encrypted. Send a message to get started.
          </div>
        )}

        {messages.map((m) => {
          const isSent = m.from_user_id === user?.id
          const time   = new Date(m.created_at || Date.now()).toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit',
          })
          return (
            <div key={m.id} className={`${styles.msgRow} ${isSent ? styles.sent : ''}`}>
              <div className={`${styles.msgAvatar} ${isSent ? styles.msgAvatarSent : ''}`}>
                {(isSent ? user?.username : recipientName)?.[0]?.toUpperCase()}
              </div>
              <div className={styles.msgGroup}>
                <div className={`${styles.bubble} ${isSent ? styles.bubbleSent : ''}`}>
                  {m.decrypted ? m.plaintext : <DecryptErrorChip detail={m.decryptError} />}
                </div>
                <div className={`${styles.meta} ${isSent ? styles.metaSent : ''}`}>
                  <span className={styles.lockIcon}>🔒</span>
                  <span>{time}</span>
                  {m.decrypted && <DecryptedChip />}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className={styles.inputArea}>
        {sendError && <div className={styles.sendError}>⚠ {sendError}</div>}
        <div className={styles.inputRow}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder={`Message ${recipientName} — encrypted before sending…`}
            value={text}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={sending}
          />
          <button
            className={styles.sendBtn}
            onClick={handleSend}
            disabled={sending || !text.trim()}
            title="Send (Enter)"
          >
            {sending ? <span className={styles.spinner} /> : '↑'}
          </button>
        </div>
        <div className={styles.inputHint}>
          Enter to send · Shift+Enter for new line · AES-256-GCM encrypted
        </div>
      </div>

    </div>
  )
}
