import styles from './KeygenOverlay.module.css'

type KeygenOverlayProps = {
  state: boolean
}

export default function KeygenOverlay({ state }: KeygenOverlayProps) {
  if (!state) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.lockIcon}>🔑</div>
      <h2 className={styles.title}>Generating Your Keys</h2>
      <p className={styles.sub}>
        Creating a 2048-bit RSA-OAEP key pair locally.<br />
        Your private key will never leave this device.
      </p>
      <div className={styles.progressTrack}>
        <div className={styles.progressBar} />
      </div>
      <div className={styles.tags}>
        <span className={styles.tag}>RSA-OAEP 2048</span>
        <span className={styles.tag}>AES-256-GCM</span>
        <span className={styles.tag}>PBKDF2 × 200k</span>
      </div>
    </div>
  )
}