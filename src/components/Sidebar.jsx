import { useAuth } from '../context/AuthContext'
import styles from './Sidebar.module.css'

export default function Sidebar({ conversations, activeConv, onSelect, onNewChat, mobileVisible }) {
  const { user, logout } = useAuth()

  return (
    <aside className={`${styles.sidebar} ${mobileVisible === false ? styles.hidden : ''}`}>

      <div className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>🔒</div>
          <span className={styles.logoText}>WhisperBox</span>
        </div>
        <div className={styles.userBadge}>
          <div className={styles.userAvatar}>{user?.username?.[0]?.toUpperCase()}</div>
          <span className={styles.username}>{user?.username}</span>
        </div>
      </div>

      <button className={styles.newChatBtn} onClick={onNewChat}>
        <span>✏</span>
        <span className={styles.newChatLabel}>New Conversation</span>
      </button>

      <div className={styles.convList}>
        {conversations.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>💬</div>
            <p className={styles.emptyText}>No conversations yet.<br />Start one above!</p>
          </div>
        ) : (
          conversations.map(conv => {
            const other    = conv.display_name || conv.username || '?'
            const convKey  = conv.user_id  || conv.id
            const isActive = activeConv?.user_id === convKey || activeConv?.id === convKey
            return (
              <button
                key={convKey}
                className={`${styles.convItem} ${isActive ? styles.convActive : ''}`}
                onClick={() => onSelect(conv)}
              >
                <div className={styles.convAvatar}>{other[0]?.toUpperCase()}</div>
                <div className={styles.convInfo}>
                  <span className={styles.convName}>{other}</span>
                  <span className={styles.convPreview}>🔒 encrypted</span>
                </div>
                <span className={styles.e2eeBadge}>E2EE</span>
              </button>
            )
          })
        )}
      </div>

      <div className={styles.footer}>
        <div className={styles.encStatus}>
          <div className={styles.encDot} />
          <span className={styles.encStatusText}>End-to-end encrypted</span>
        </div>
        <button className={styles.logoutBtn} onClick={logout}>
          <span>⎋</span>
          <span className={styles.logoutText}>Sign Out</span>
        </button>
      </div>

    </aside>
  )
}
