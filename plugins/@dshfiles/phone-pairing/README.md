# Phone pairing

Public, password-less phone access to DSH: at startup the Host provisions an HTTPS
tunnel, prints one QR (or a 6-digit code), and the phone keeps a persistent cookie.
Devices live in `$DSH_HOME/plugins/phone-pairing/devices.json` as SHA-256 hashes.

## Flow

1. Phone access is **off by default**. Enable it by writing
   `{"enabled":true,"provider":"tailscale-funnel"}` to
   `$DSH_HOME/plugins/phone-pairing/settings.json` and restarting DSH. The choice
   persists, so nothing is published on a later start unless it stays enabled.
2. The plugin starts a loopback gateway on `gatewayPort` (default 3443).
3. It provisions a tunnel for that provider: a signed-in Tailscale gets `tailscale funnel --bg --https=443`
   (public `https://<machine>.<tailnet>.ts.net`); otherwise an installed `cloudflared`
   quick tunnel. With neither, it prints install hints and does nothing.
4. The terminal shows a QR (`https://<origin>/pair#id=…&secret=…`) and a 6-digit code.
5. The phone scans, or opens `/pair` and types the code. Redemption is single use,
   expires after `offerTtlSeconds`, and is rate limited per minute.
6. The response sets `__Host-dsh_phone` (HttpOnly, SameSite=Strict, Secure on HTTPS).
7. Every later request is proxied to the native listener, which needs its own
   authority-bound cookie: the plugin exchanges the process launch URL for it and
   rewrites `Host`/`Origin` to `127.0.0.1:<native port>`. The native listener stays
   loopback-only and is never exposed.

## Requirements and limitations

1. `tailscale funnel` publishes the sign-in page to the internet. Anyone with a valid
   one-time secret or code, guessed within the rate limit, gets a device. Treat the QR
   like a password and revoke devices you no longer hold.
2. The Funnel/quick-tunnel URL is stable for Tailscale, random for cloudflared; a new
   cloudflared URL means the old phone cookie must be re-paired at the new origin.
3. Device credentials are hashes on disk; cookies are bearer tokens, so a stolen cookie
   is a paired device until revoked.
4. No agent tools yet (list/revoke), and the pairing page has no per-device name.
5. Verified by unit tests plus one end-to-end run of the gateway against a scratch
   DSH (code pairing, cookie, authenticated page, unpaired 401). No live pairing run.
6. No agent tools yet, so enabling is a file edit and revocation is `devices.json`
   plus a restart; open sockets survive a revocation until closed.
7. One-click install of a missing provider is not wired: `detectProviders` reports the
   per-platform command, and nothing runs it.
