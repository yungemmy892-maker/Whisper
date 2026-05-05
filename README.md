# 🔒 WhisperBox — End-to-End Encrypted Messaging

> The server **never** sees your messages. Every message is encrypted on your device before it leaves, and decrypted only on the recipient's device.

---

## Table of Contents

1. [How It Works (Plain English)](#how-it-works)
2. [Architecture Diagram](#architecture-diagram)
3. [How Keys Are Generated](#how-keys-are-generated)
4. [How Messages Are Encrypted](#how-messages-are-encrypted)
5. [Why the Server Cannot Read Messages](#why-the-server-cannot-read-messages)
6. [Key Storage](#key-storage)
7. [Security Trade-offs](#security-trade-offs)
8. [Known Limitations](#known-limitations)
9. [Running Locally](#running-locally)
10. [Project Structure](#project-structure)
11. [Verifying the Encryption Yourself](#verifying-the-encryption-yourself)

---

## How It Works (Plain English) <a name="how-it-works"></a>

Imagine you want to send a locked box to Alice.

1. **Alice gives you a padlock** (her public key) — she keeps the only key to open it (her private key)
2. **You put your message in the box and snap the padlock shut** (encrypt with her public key)
3. **You hand the locked box to the postman** (the server) — the postman can carry it but cannot open it
4. **Alice opens the box with her key** (decrypt with her private key) — only she can read the message

WhisperBox does exactly this, using real cryptography:
- The "padlock" is an **RSA-OAEP 2048-bit public key**
- The "key" is an **RSA-OAEP private key** that never leaves Alice's device
- The "locked box" is the **AES-256-GCM ciphertext** stored on the server

---

## Architecture Diagram <a name="architecture-diagram"></a>

```
╔══════════════════════════════════════════════════════════════════════════╗
║                        YOUR BROWSER (Client)                            ║
║                                                                          ║
║  ┌─────────────────┐   ┌──────────────────────────────────────────────┐ ║
║  │  src/context/   │   │  src/utils/crypto/                           │ ║
║  │  AuthContext    │   │                                               │ ║
║  │                 │   │  keyGeneration.js  → generateKeyPair()       │ ║
║  │  - Holds token  │   │  keyExchange.js    → exportPublicKey()       │ ║
║  │    in memory    │◄──┤                      importPublicKey()       │ ║
║  │    (never       │   │                      wrapPrivateKey()        │ ║
║  │    localStorage)│   │                      unwrapPrivateKey()      │ ║
║  │  - Holds        │   │  encryption.js     → encryptMessage()        │ ║
║  │    CryptoKey    │   │  decryption.js     → decryptMessage()        │ ║
║  │    objects      │   └──────────────────────────────────────────────┘ ║
║  └─────────────────┘                  │                                 ║
║                                       │ Only ciphertext blobs           ║
║  ┌─────────────────┐                  │ cross this boundary             ║
║  │  IndexedDB      │                  ▼                                 ║
║  │  (this device)  │   ┌──────────────────────────────────────────────┐ ║
║  │                 │   │  src/utils/api.js                            │ ║
║  │  Wrapped priv.  │   │                                               │ ║
║  │  key only       │   │  All API calls — server receives only:        │ ║
║  │  (AES-GCM +     │   │    • usernames (for identity)                │ ║
║  │   PBKDF2)       │   │    • public keys (intentionally public)       │ ║
║  └─────────────────┘   │    • ciphertext blobs (unreadable)           │ ║
║                         └──────────────────────┬─────────────────────┘ ║
╚═══════════════════════════════════════════════╪═════════════════════════╝
                                                 │ HTTPS
                                                 ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                   WhisperBox Backend (whisperbox.koyeb.app)             ║
║                                                                          ║
║  POST /auth/register  { username, password, public_key }                 ║
║  POST /auth/login     { username, password }  →  JWT                     ║
║  GET  /users/:name    →  { username, public_key }                        ║
║  GET  /conversations  →  [{ id, participants, ... }]                     ║
║  POST /conversations  { recipient_username }                             ║
║  GET  /conversations/:id/messages  →  [{ content: "<BLOB>" }]           ║
║  POST /conversations/:id/messages  { content: "<BLOB>" }                ║
║                                                                          ║
║  What the server stores:                                                 ║
║    ✅  Usernames                                                          ║
║    ✅  Hashed passwords  (bcrypt — server can't recover plaintext)       ║
║    ✅  Public keys       (intentionally public)                          ║
║    ✅  Ciphertext blobs  (encrypted — server can't read them)            ║
║    ❌  Plaintext messages                                                 ║
║    ❌  Private keys                                                       ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## How Keys Are Generated <a name="how-keys-are-generated"></a>

Key generation happens **once, at registration, entirely in your browser**.

```
REGISTRATION FLOW
─────────────────

1. Browser calls window.crypto.subtle.generateKey():
   Algorithm : RSA-OAEP
   Key size  : 2048 bits
   Exponent  : 65537  (standard)
   Hash      : SHA-256
   Result    : { publicKey, privateKey }

2. Public key → exported as SPKI base64 → sent to server
   The server stores this. It is meant to be public.

3. Private key → NEVER sent to server.
   Instead, it is wrapped (encrypted) before storing:

   a. Derive a wrapping key from the user's password:
      PBKDF2(password, randomSalt[16], 200_000 iterations, SHA-256)
      → AES-256-GCM wrapping key

   b. Encrypt the PKCS#8 private key bytes:
      AES-GCM.encrypt(pkcs8Bytes, wrappingKey, randomIV[12])
      → encryptedPrivateKey

   c. Store in IndexedDB (this device only):
      base64( salt[16] || iv[12] || encryptedPrivateKey )

4. The raw CryptoKey objects are held in React state (memory only)
   for the duration of the session.
```

**Why PBKDF2 with 200,000 iterations?**
Even if someone steals the IndexedDB entry, they face 200,000 hash iterations per password guess. That makes brute-forcing prohibitively expensive for anything but a trivially weak password.

---

## How Messages Are Encrypted <a name="how-messages-are-encrypted"></a>

WhisperBox uses **hybrid encryption** — a combination of RSA-OAEP and AES-256-GCM.

### Why hybrid?
RSA-OAEP with a 2048-bit key can only encrypt ~214 bytes. Messages can be much longer. The solution: use fast AES to encrypt the message, and RSA to encrypt the AES key.

```
SENDING A MESSAGE  (src/utils/crypto/encryption.js)
────────────────────────────────────────────────────

plaintext: "Hey Alice, let's meet at 3pm"

Step 1 — Generate a fresh ephemeral AES-256-GCM key (one per message)
         messageKey = AES-GCM.generateKey(256 bits)
         NOTE: This key is random and unique per message. Even if one
               message key is compromised, others remain safe.

Step 2 — Encrypt the message
         iv          = crypto.getRandomValues(12 bytes)  ← unique nonce
         ciphertext  = AES-GCM.encrypt(plaintext, messageKey, iv)
         The iv must be unique per (key, message) pair. AES-GCM is both
         confidential AND authenticated — tampering is detected.

Step 3 — Wrap the message key for both parties
         rawKey           = export(messageKey, 'raw')
         encKeyRecipient  = RSA-OAEP.encrypt(rawKey, alice.publicKey)
         encKeySender     = RSA-OAEP.encrypt(rawKey, bob.publicKey)
         ↑ Sender copy lets Bob re-read his own sent messages.

Step 4 — Bundle and send (only ciphertext reaches the server)
         payload = base64( JSON({
           v: 1,                   ← schema version
           iv,                     ← nonce for AES-GCM
           ciphertext,             ← encrypted message
           encKeyRecipient,        ← AES key wrapped for Alice
           encKeySender,           ← AES key wrapped for Bob
         }) )

         POST /conversations/:id/messages { content: payload }
         ↑ The server stores this blob. It cannot decode it.


RECEIVING A MESSAGE  (src/utils/crypto/decryption.js)
──────────────────────────────────────────────────────

Step 1 — Parse the base64 JSON payload

Step 2 — Pick the right key slot
         if (I am the recipient) use encKeyRecipient
         if (I am the sender)    use encKeySender

Step 3 — RSA-unwrap the AES message key
         rawKey     = RSA-OAEP.decrypt(encKeyRecipient, alice.privateKey)
         messageKey = import(rawKey, AES-GCM)

Step 4 — Decrypt and verify
         plaintext  = AES-GCM.decrypt(ciphertext, messageKey, iv)
         ↑ If ciphertext was tampered, this throws an error (auth tag mismatch)

Step 5 — Render plaintext in the UI
```

---

## Why the Server Cannot Read Messages <a name="why-the-server-cannot-read-messages"></a>

Three reasons make server-side access to plaintext impossible:

**1. Encryption happens before the network call**

In `ChatWindow.jsx`:
```js
// ✅ Plaintext encrypted BEFORE leaving the device
const blob = await encryptMessage(text.trim(), recipientPubKey, myPublicKey)

// ✅ Only the encrypted blob is sent to the server
await apiSendMessage(conversation.id, blob, token)
```

The server receives the blob. It has no knowledge of `text.trim()`.

**2. Private keys never leave the client**

```
Registration: privateKey → wrapPrivateKey(password) → IndexedDB
              ↳ Never POSTed to any server endpoint

Login:        encryptedPrivateKey ← IndexedDB
              privateKey = unwrapPrivateKey(encryptedKey, password)
              ↳ Unwrapping is done locally; password never used server-side for keys
```

**3. The AES message key is only decryptable by the RSA private key**

The server stores `encKeyRecipient` — a ciphertext that was produced by:
```
RSA-OAEP.encrypt(rawAesKey, alice.publicKey)
```

Only someone holding `alice.privateKey` can reverse this. The server holds `alice.publicKey` (which it served to senders), but not `alice.privateKey`. It cannot decrypt `encKeyRecipient`, and therefore cannot decrypt the message.

---

## Key Storage <a name="key-storage"></a>

| Location        | What's stored                              | Readable without password? |
|---|---|---|
| **Server**      | Public key (SPKI base64)                   | ✅ Yes — intentionally public |
| **Server**      | Ciphertext blobs                           | ❌ No — encrypted |
| **Server**      | Password hash (bcrypt)                     | ❌ No — one-way hash |
| **IndexedDB**   | Wrapped private key (AES-GCM + PBKDF2)    | ❌ No — requires user password |
| **Memory**      | Live CryptoKey objects (session duration)  | Cleared on logout/refresh |
| **localStorage**| Nothing                                    | N/A |

### Why IndexedDB instead of localStorage?

- `localStorage` is synchronous, origin-accessible, and easily read by any injected script
- `IndexedDB` is async, larger capacity, and treated as a separate, more isolated storage
- Critically, even if an attacker reads IndexedDB, they get only the PBKDF2-wrapped blob — useless without the user's password and 200,000 iterations of compute per guess

---

## Security Trade-offs <a name="security-trade-offs"></a>

| Decision | What we chose | What we gave up | Why |
|---|---|---|---|
| Key algorithm | RSA-OAEP 2048 | ECDH P-256 (faster, smaller keys) | RSA-OAEP is widely understood, well-supported, and easier to reason about for a teaching project |
| Forward secrecy | Per-message ephemeral AES keys | Full Double Ratchet (Signal Protocol) | Double Ratchet requires complex session state; per-message ephemerality gives partial protection |
| Session storage | JWT in React state (memory) | httpOnly cookies, refresh tokens | Simplest secure approach; token lost on refresh is a deliberate security property |
| Device portability | Keys are device-local | Encrypted cloud backup | Cloud key backup adds attack surface; device-local is the stronger default |
| Key trust model | Trust server-delivered public keys | Out-of-band key verification (QR codes) | Key verification UX is complex; noted as a known limitation |

---

## Known Limitations <a name="known-limitations"></a>

1. **Device-bound private keys** — Your private key is stored only in this browser's IndexedDB. Signing in from a new browser or device will fail unless you export your key first (not yet implemented). This is intentional for security but affects usability.

2. **No full forward secrecy** — The same RSA key pair is used for all sessions. If your private key is ever compromised in the future, an attacker could retroactively decrypt stored messages. Signal's Double Ratchet algorithm solves this but adds significant complexity.

3. **Public key trust requires server trust** — When you start a conversation, you fetch the recipient's public key from the server. A compromised server could serve a malicious public key (MITM). Production systems mitigate this with safety numbers or QR-code key verification (like Signal's "verify safety numbers" feature).

4. **No message deletion** — Messages persist on the server as ciphertext blobs. They cannot be read without the private key, but they exist. A future feature could implement client-side deletion requests.

5. **Page refresh logs you out** — JWT is in memory only. This is secure but inconvenient. A secure session persistence solution would use refresh tokens in httpOnly cookies.

6. **Browser extension risk** — The security model trusts the browser environment. A malicious browser extension with access to the page's JS context could read decrypted messages after they are rendered. This is a limitation of any browser-based E2EE.

---

## Running Locally <a name="running-locally"></a>

```bash
# 1. Install dependencies
npm install

# 2. Start development server (http://localhost:3000)
npm run dev

# 3. Build for production
npm run build

# 4. Preview production build
npm run preview
```

**Requirements:**
- Node.js 18+
- A modern browser (Chrome 37+, Firefox 34+, Safari 11+)
- HTTPS in production — Web Crypto API requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)

---

## Project Structure <a name="project-structure"></a>

```
whisperbox/
├── index.html
├── vite.config.js
├── package.json
├── README.md
└── src/
    ├── main.jsx                       Entry point — mounts React
    ├── App.jsx                        Root shell — routing between auth/app
    ├── index.css                      CSS variables + global reset
    │
    ├── context/
    │   └── AuthContext.jsx            Session state: token (memory), CryptoKeys,
    │                                  register/login/logout logic
    │
    ├── components/
    │   ├── AuthScreen.jsx             Login + Register UI with input validation
    │   ├── AuthScreen.module.css
    │   ├── KeygenOverlay.jsx          Full-screen overlay shown during key generation
    │   ├── KeygenOverlay.module.css
    │   ├── Sidebar.jsx                Conversation list + user badge + logout
    │   ├── Sidebar.module.css
    │   ├── ChatWindow.jsx             Message display, send flow, polling
    │   ├── ChatWindow.module.css
    │   ├── EncryptionBanner.jsx       Security indicators (E2EE active / error chips)
    │   ├── EncryptionBanner.module.css
    │   ├── NewChatModal.jsx           Start a new conversation by username
    │   └── NewChatModal.module.css
    │
    └── utils/
        ├── api.js                     API client — JWT auth, never handles plaintext
        ├── storage.js                 IndexedDB operations for wrapped private keys
        │
        └── crypto/                    ← Split into 4 focused modules
            ├── index.js               Barrel export (consumers import from here)
            ├── helpers.js             bufToBase64 / base64ToBuf utilities
            ├── keyGeneration.js       generateKeyPair() — RSA-OAEP 2048-bit
            ├── keyExchange.js         exportPublicKey(), importPublicKey(),
            │                          wrapPrivateKey(), unwrapPrivateKey()
            ├── encryption.js          encryptMessage() — hybrid RSA+AES
            └── decryption.js          decryptMessage() — hybrid RSA+AES
```

---

## Verifying the Encryption Yourself <a name="verifying-the-encryption-yourself"></a>

Open DevTools → Network tab, then send a message. Find the POST to `/conversations/:id/messages` and inspect the request body:

```json
{
  "content": "eyJ2IjoxLCJpdiI6IlhYWFhYWFhYWFhYWFhYWCIsImNpcGhlcnRleHQiOiJZWVlZWVlZWVlZWVlZWVkiLCJlbmNLZXlSZWNpcGllbnQiOiJaWlpaWlpaWlpaWlpaWloiLCJlbmNLZXlTZW5kZXIiOiJXV1dXV1dXV1dXV1dXVyJ9"
}
```

Decode it in the browser console:
```js
JSON.parse(atob("eyJ2IjoxLC..."))
// → { v: 1, iv: "...", ciphertext: "...", encKeyRecipient: "...", encKeySender: "..." }
```

Every field is opaque binary data. There is no plaintext, no username, no metadata that would reveal the message content. The server cannot decode this without the recipient's private key — which it does not have.

---

## References

- [Web Crypto API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [AES-GCM — NIST SP 800-38D](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf)
- [RSA-OAEP — RFC 3447](https://datatracker.ietf.org/doc/html/rfc3447)
- [PBKDF2 — RFC 2898](https://datatracker.ietf.org/doc/html/rfc2898)
- [Signal Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [IndexedDB API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
