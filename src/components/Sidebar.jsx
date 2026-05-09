import { useAuth } from '../context/AuthContext'
import styles from './Sidebar.module.css'

function timeAgo(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 172800) return 'yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function presenceLabel(conv) {
  if (conv.online === true) return { text: 'online', online: true }
  if (conv.online === false) return { text: 'offline', online: false }
  return { text: '', online: false }
}

export default function Sidebar({ conversations, activeConv, onSelect, onNewChat, mobileVisible }) {
  const { user, logout } = useAuth()

  return (
    <aside className={`${styles.sidebar} ${mobileVisible === false ? styles.hidden : ''}`}>

      {/* Header */}
      <div className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}><span className={styles.icon} aria-hidden="true">💬</span></div>
          <span className={styles.logoText}>WhisperBox</span>
        </div>
        <div className={styles.userBadge}>
          <div className={styles.userAvatar}>
            {(user?.display_name || user?.username || '?')[0].toUpperCase()}
          </div>
          <span className={styles.username}>{user?.display_name || user?.username}</span>
        </div>
      </div>

      {/* Search / New Chat */}
      <div className={styles.searchBar}>
        <button className={styles.newChatBtn} onClick={onNewChat}>
          <span className={`${styles.icon} ${styles.newChatIcon}`} aria-hidden="true">🔍</span>
          <span className={styles.newChatLabel}>Search or start new chat</span>
        </button>
      </div>

      {/* Conversations */}
      <div className={styles.convList}>
        {conversations.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>💬</div>
            <p>No conversations yet.<br />Tap the search bar to start one.</p>
          </div>
        ) : (
          conversations.map(conv => {
            const name     = conv.display_name || conv.username || '?'
            const convKey  = conv.user_id || conv.id
            const isActive = activeConv?.user_id === convKey || activeConv?.id === convKey
            const presence = presenceLabel(conv)
            return (
              <button
                key={convKey}
                className={`${styles.convItem} ${isActive ? styles.convActive : ''}`}
                onClick={() => onSelect(conv)}
              >
                <div className={styles.convAvatar}>{name[0].toUpperCase()}</div>
                <div className={styles.convInfo}>
                  <div className={styles.convMeta}>
                    <span className={styles.convName}>{name}</span>
                    <span className={styles.convTime}>{timeAgo(conv.last_message_at)}</span>
                  </div>
                  <div className={styles.convBottom}>
                    <span className={styles.convPreview}>
                      <span className={styles.icon} aria-hidden="true">🔒</span>
                      encrypted
                    </span>
                    {presence.text && (
                      <span className={styles.presenceTag}>
                        <span className={`${styles.statusDot} ${presence.online ? styles.statusOnline : ''}`} />
                        {presence.text}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className={styles.footer}>
        <div className={styles.encStatus}>
          <div className={styles.encDot} />
          <span className={styles.encStatusText}>End-to-end encrypted</span>
        </div>
        <button className={styles.logoutBtn} onClick={logout}>
          <span className={styles.icon} aria-hidden="true">⎋</span>
          <span className={styles.logoutText}>Sign Out</span>
        </button>
      </div>

    </aside>
  )
}