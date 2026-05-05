import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { searchUsers, getUserPublicKey } from '../utils/api'
import styles from './NewChatModal.module.css'

export default function NewChatModal({ onClose, onCreated }) {
  const { token } = useAuth()
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [searched, setSearched] = useState(false)

  async function handleSearch(e) {
    e?.preventDefault()
    if (!query.trim()) return
    setError('')
    setLoading(true)
    setResults([])
    setSearched(false)
    try {
      const data = await searchUsers(query.trim(), token)
      const list = Array.isArray(data) ? data : (data?.users ?? [])
      setResults(list)
      setSearched(true)
      if (list.length === 0) setError('No users found matching that name.')
    } catch (err) {
      setError(err.message || 'Search failed.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelect(selectedUser) {
    try {
      // Verify they have a public key (needed for E2EE)
      await getUserPublicKey(selectedUser.id, token)
      onCreated({
        user_id:  selectedUser.id,
        username: selectedUser.username,
      })
      onClose()
    } catch (err) {
      setError(`Cannot message ${selectedUser.username}: ${err.message}`)
    }
  }

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.dragHandle} />
        <div className={styles.modalHeader}>
          <h3>New Encrypted Conversation</h3>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <p className={styles.desc}>
          Search for a user. Their <strong>public key</strong> will be fetched
          to encrypt messages before they leave your device.
        </p>

        {error && <div className={styles.error}>⚠ {error}</div>}

        <form onSubmit={handleSearch}>
          <div className={styles.searchRow}>
            <input
              className={styles.input}
              placeholder="Search by username…"
              value={query}
              onChange={e => { setQuery(e.target.value); setError('') }}
              autoFocus
              disabled={loading}
            />
            <button
              type="submit"
              className={styles.searchBtn}
              disabled={loading || !query.trim()}
            >
              {loading ? <span className={styles.spinner} /> : '🔍'}
            </button>
          </div>
        </form>

        {searched && results.length > 0 && (
          <div className={styles.results}>
            {results.map(u => (
              <button
                key={u.id}
                className={styles.resultItem}
                onClick={() => handleSelect(u)}
              >
                <div className={styles.resultAvatar}>{u.username[0].toUpperCase()}</div>
                <span className={styles.resultName}>{u.username}</span>
                <span className={styles.resultAction}>Message →</span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
