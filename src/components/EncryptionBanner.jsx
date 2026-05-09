/**
 * EncryptionBanner.jsx
 *
 * A non-intrusive banner that clearly communicates the E2EE status of
 * a conversation to the user. Shown once at the top of a fresh conversation,
 * or as a persistent chip in the header.
 *
 * Variants:
 *   "active"   — encryption is working, messages are being decrypted
 *   "error"    — decryption failure detected in this conversation
 *   "info"     — neutral informational (e.g. first message in conv)
 */

import styles from './EncryptionBanner.module.css'

export default function EncryptionBanner({ variant = 'active', message }) {
  const config = {
    active: {
      icon: '🔒',
      label: 'End-to-End Encrypted',
      detail: message || 'Messages are encrypted on your device. The server cannot read them.',
      mod: styles.active,
    },
    error: {
      icon: '⚠️',
      label: 'Decryption Failed',
      detail: message || 'One or more messages could not be decrypted. They may have been sent from a different device or key.',
      mod: styles.error,
    },
    info: {
      icon: '🔐',
      label: 'Encrypted Conversation',
      detail: message || 'Only you and the recipient can read these messages.',
      mod: styles.info,
    },
  }[variant] ?? config.active

  return (
    <div className={`${styles.banner} ${config.mod}`}>
      <span className={styles.icon}>{config.icon}</span>
      <div className={styles.text}>
        <span className={styles.label}>{config.label}</span>
        <span className={styles.detail}>{config.detail}</span>
      </div>
    </div>
  )
}

/**
 * Small inline chip — used in message metadata row.
 * Shows a pulsing green dot + "decrypted locally" text.
 */
export function DecryptedChip() {
  return (
    <span className={styles.chip}>
      <span className={styles.chipDot} />
      decrypted locally
    </span>
  )
}

/**
 * Inline error chip
 */
export function DecryptErrorChip({ detail }) {
  return (
    <span className={styles.errorChip}>
      ⚠ Could not decrypt
      {detail && <span className={styles.errorDetail}> — {detail}</span>}
    </span>
  )
}