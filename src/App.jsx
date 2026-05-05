import { useState, useEffect, useCallback } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import AuthScreen from './components/AuthScreen'
import KeygenOverlay from './components/KeygenOverlay'
import Sidebar from './components/Sidebar'
import ChatWindow from './components/ChatWindow'
import NewChatModal from './components/NewChatModal'
import { getConversations } from './utils/api'
import styles from './App.module.css'

function AppShell() {
  const { isAuthenticated, keygenState, token } = useAuth()
  const [conversations, setConversations] = useState([])
  const [activeConv,    setActiveConv]    = useState(null)
  const [showNewChat,   setShowNewChat]   = useState(false)
  // Mobile: 'sidebar' | 'chat'
  const [mobileView,    setMobileView]    = useState('sidebar')

  const fetchConversations = useCallback(async () => {
    if (!token) return
    try {
      const data = await getConversations(token)
      setConversations(Array.isArray(data) ? data : (data?.conversations ?? []))
    } catch (err) {
      console.error('Failed to load conversations:', err)
    }
  }, [token])

  useEffect(() => {
    if (!isAuthenticated || !token) {
      setConversations([])
      setActiveConv(null)
      setMobileView('sidebar')
      return
    }
    fetchConversations()
  }, [isAuthenticated, token])

  // Refresh sidebar on any incoming WS message
  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.type === 'message.receive') fetchConversations()
    }
    window.addEventListener('wb:message', handler)
    return () => window.removeEventListener('wb:message', handler)
  }, [fetchConversations])

  function handleSelectConv(conv) {
    setActiveConv(conv)
    setMobileView('chat')   // slide to chat panel on mobile
  }

  function handleBack() {
    setMobileView('sidebar')
  }

  function handleConvCreated(conv) {
    setConversations(prev => {
      if (prev.find(c => c.user_id === conv.user_id)) return prev
      return [conv, ...prev]
    })
    setActiveConv(conv)
    setMobileView('chat')
  }

  if (isAuthenticated) {
    return (
      <div className={styles.app}>
        <Sidebar
          conversations={conversations}
          activeConv={activeConv}
          onSelect={handleSelectConv}
          onNewChat={() => setShowNewChat(true)}
          mobileVisible={mobileView === 'sidebar'}
        />
        <ChatWindow
          conversation={activeConv}
          onConversationUpdate={fetchConversations}
          onBack={handleBack}
          mobileVisible={mobileView === 'chat'}
        />
        {showNewChat && (
          <NewChatModal
            onClose={() => setShowNewChat(false)}
            onCreated={handleConvCreated}
          />
        )}
      </div>
    )
  }

  if (keygenState) return <KeygenOverlay state={keygenState} />
  return <AuthScreen />
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
