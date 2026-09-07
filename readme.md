That's the shape of it: one Node process on your Oracle VM holds the WhatsApp connection, a "bot core" handles sessions/routing/crypto, it persists only encrypted config to SQLite, and it calls out to Gemini per-user. Here's the full design, section by section.

## Why Baileys + open access needs a safety net

Since you're using an unofficial library on a personal number *and* opening it to anyone, the realistic risk is WhatsApp eventually flagging the number for bot-like behavior — more distinct senders and reply cadence looks more "automated" to their detection systems than a private bot would. You can't eliminate this risk, only reduce and plan around it:

- Keep the Gemini logic and session/storage layer completely decoupled from the WhatsApp transport (a thin adapter interface). If the number ever gets banned, you swap in the official Cloud API or a new number without rewriting the core.
- Add small random delays between outgoing messages, never message first, avoid burst-sending — these reduce (not eliminate) detection likelihood.
- Treat the `auth` folder Baileys creates as more sensitive than the API keys database — it's equivalent to full account takeover credentials if leaked.

## Security & data storage

- **No plaintext phone numbers stored.** Compute `lookupKey = HMAC-SHA256(jid, serverSecret)` and use that as the primary key everywhere in the database. The raw JID only exists transiently in memory during an active request (you get it fresh from each incoming Baileys event to send replies).
- **API keys encrypted at rest**: AES-256-GCM, random IV per record, store `iv + ciphertext + authTag`. Decrypt only in-memory at the moment of the Gemini call; never log a decrypted key.
- **Master key**: a 32-byte random secret (`openssl rand -hex 32`), loaded via a root-only-readable env file through systemd — never committed to any repo.
- **File permissions**: DB file and Baileys auth folder `chmod 600`, owned by a dedicated non-root service user. Bot process never runs as root.
- **No inbound ports needed at all** — Baileys makes an outbound WebSocket to WhatsApp, and your Gemini calls are outbound HTTPS. Firewall can deny all inbound except SSH, which shrinks your attack surface a lot for a free-tier box.
- **Right-to-be-forgotten**: support a `/delete_me` command that wipes a user's row entirely, since this is a public bot handling other people's API keys.

## First-time setup flow

1. New sender messages the bot → no record found for their `lookupKey` → onboarding starts.
2. Bot explains what it does and asks for a Gemini API key, with a clear note: "this is encrypted and used only to call Gemini on your behalf."
3. User sends the key → bot makes one lightweight validation call to Gemini before saving anything, so a typo doesn't get silently stored.
4. **Correction on message deletion**: WhatsApp only lets an account delete messages *it sent*, not messages the other person sent — so the bot can't remotely delete the user's message containing their key. Be upfront about that, and just prompt them: "you can delete that message yourself now if you'd like."
5. Model selection: query Gemini's `ListModels` endpoint live with the user's own key and show a plain numbered list ("reply with a number") rather than hardcoding model names — this keeps the bot correct as Google ships new models, and avoids WhatsApp's flaky interactive-list rendering on some clients.
6. Confirm setup, briefly explain how to chat, send files, and use commands.

## Session & context management

- Keep conversation history **in memory only** (a `Map<lookupKey, {history, lastActiveAt}>`), never persisted to disk — this satisfies "conversation isn't sitting around indefinitely" by construction.
- Reset the inactivity timer on every incoming message. On timeout (e.g. 30 min, tunable), drop that user's history entirely. Config (API key, model) is untouched — only the conversation clears.
- Don't message the user proactively when their session expires (fits the "don't message first" ban-mitigation above). Instead, when they send a new message after expiry, just start fresh silently or with a one-line "starting a new conversation" note.
- Also cap history by turn count/approximate tokens even *within* an active session, trimming oldest turns — otherwise a long chatty session still balloons cost and latency for the user.

## Multi-file messages

WhatsApp doesn't deliver "one message, several attachments" from a personal client — each file lands as its own message, even when the user picked several from their gallery at once. So:

- Buffer incoming media for a short window (~2 seconds) per sender.
- If a text message follows shortly after, treat it as the question for all buffered files; if a caption exists but no separate text, use that.
- Download each file, base64-encode small ones as `inlineData` parts; for anything large, use Gemini's Files API instead of inline.
- Enforce a max file size and max files per burst up front — this protects your free-tier disk/bandwidth, not Gemini's limits (the user's API cost is theirs, but a stranger dumping huge files still costs you server resources).

## Commands

`/help` · `/model` (re-show model list) · `/newkey` (replace stored key) · `/clear` (end session now) · `/status` (current model + time left in session) · `/delete_me` (wipe all stored data)

## Abuse protection (since it's open to anyone)

- Per-sender rate limit (messages/minute and /day) to protect your CPU and bandwidth, independent of their own Gemini quota.
- A small concurrency queue so the free-tier box never has too many simultaneous Gemini calls in flight.
- Delete downloaded media immediately after it's sent to Gemini — don't retain files on disk.

## Disappearing messages — feasibility

Baileys can toggle WhatsApp's native disappearing-messages timer per chat (24h/7d/90d) via a chat-modify action. It's worth turning on by default for a bit of chat-hygiene on the user's own device history — but it's a **separate, cosmetic layer**: it only affects what's visible in the WhatsApp UI, not what the bot holds in memory. Your in-memory timeout logic above is what actually controls what gets sent to Gemini as context; disappearing messages doesn't substitute for it.

## Tech stack

Node.js 20 · `@whiskeysockets/baileys` · `@google/generative-ai` · `better-sqlite3` · systemd (`Restart=always`) for process supervision · built-in `node:crypto` for AES-256-GCM/HMAC · `p-queue` for concurrency control.

## Suggested build order

1. Baileys connection + QR pairing + plain echo bot
2. SQLite schema + encrypted key storage + onboarding flow
3. Gemini text integration + session timeout logic
4. Multi-file buffering + multimodal Gemini calls
5. Commands, rate limiting, and Oracle deployment hardening

