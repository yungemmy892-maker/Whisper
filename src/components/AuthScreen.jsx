import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import styles from './AuthScreen.module.css'

export default function AuthScreen() {
  const { registerUser, loginUser, keygenState } = useAuth()
  const [tab,  setTab]  = useState('login')
  const [form, setForm] = useState({ username: '', displayName: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  function handleChange(e) {
    setForm(p => ({ ...p, [e.target.name]: e.target.value }))
    setError('')
  }

  function switchTab(t) {
    setTab(t)
    setError('')
    setForm({ username: '', displayName: '', password: '' })
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!form.username.trim() || !form.password) return

    // Validation — match server rules exactly
    const trimmedUsername = form.username.trim()
    if (trimmedUsername.length < 3)  return setError('Username must be at least 3 characters.')
    if (trimmedUsername.length > 32) return setError('Username must be 32 characters or fewer.')
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmedUsername))
      return setError('Username: letters, numbers, _ and - only.')
    if (form.password.length < 8)  return setError('Password must be at least 8 characters.')
    if (form.password.length > 128) return setError('Password must be 128 characters or fewer.')
    if (tab === 'register' && !form.displayName.trim())
      return setError('Display name is required.')

    setLoading(true)
    setError('')
    try {
    if (tab === 'register') {
      await registerUser(form.username.trim(), form.displayName.trim(), form.password);
    } else {
      await loginUser(form.username.trim(), form.password);
    }
  } catch (err) {
    setError(err.message || 'Something went wrong.');
  } finally {
    setLoading(false);
  }
}

  const isWorking = loading || !!keygenState

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>🔒</div>
          <h1 className={styles.logoText}>Whisper<span>App</span></h1>
        </div>

        <p className={styles.tagline}>
          End-to-end encrypted messaging.<br />
          The server never sees your messages.
        </p>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'login' ? styles.tabActive : ''}`}
            onClick={() => switchTab('login')}
            type="button"
          >Sign In</button>
          <button
            className={`${styles.tab} ${tab === 'register' ? styles.tabActive : ''}`}
            onClick={() => switchTab('register')}
            type="button"
          >Register</button>
        </div>

        {error && <div className={styles.error}>⚠ {error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>

          {tab === 'register' && (
            <div className={styles.field}>
              <label className={styles.label}>Display Name</label>
              <input
                className={styles.input}
                name="displayName"
                placeholder="Alice"
                value={form.displayName}
                onChange={handleChange}
                autoComplete="name"
                disabled={isWorking}
                maxLength={64}
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Username</label>
            <input
              className={styles.input}
              name="username"
              placeholder="your_handle"
              value={form.username}
              onChange={handleChange}
              autoComplete="username"
              disabled={isWorking}
              maxLength={32}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>
              Password
              {tab === 'register' && (
                <span className={styles.labelNote}> — min 8 chars, encrypts your key</span>
              )}
            </label>
            <input
              className={styles.input}
              name="password"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={handleChange}
              autoComplete={tab === 'register' ? 'new-password' : 'current-password'}
              disabled={isWorking}
            />
          </div>

          <button
            className={styles.submitBtn}
            type="submit"
            disabled={isWorking || !form.username || !form.password}
          >
            {isWorking
              ? <span className={styles.spinner} />
              : tab === 'login' ? 'Sign In' : 'Create Account & Generate Keys'
            }
          </button>
        </form>

        <div className={styles.securityNote}>
          {tab === 'register' ? (
            <>🔑 Keys generated <strong>locally</strong> · Wrapped key stored on server · Sign in from any device</>
          ) : (
            <> Zero-knowledge · Private key unwrapped locally from your password</>
          )}
        </div>
      </div>
    </div>
  )
}
