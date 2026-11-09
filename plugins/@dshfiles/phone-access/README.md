# Phone access QR

Two clicks for anyone on Tailscale: run `pnpm dsh:phone`, scan the QR with the phone.
No certificate authority, no `trustedHosts` edit, no per-device setup.

## What it does

1. The Host starts a loopback rewrite proxy on `127.0.0.1:3443` (`proxyPort`).
2. `scripts/dsh-phone.ts` detects the tailnet DNS name, points
   `tailscale serve --https=443` at that proxy, and prints a QR for
   `https://<machine>.<tailnet>.ts.net/?token=…`.
3. The phone scans it once. Tailscale terminates TLS with a publicly trusted
   certificate, the proxy rewrites `Host`/`Origin` to the loopback authority, and the
   native listener mints its own authority-bound cookie. The cookie survives DSH
   restarts for `connection.cookieMaxAgeDays`.

The proxy exists because the native listener authenticates by authority: a tunnel
forwards the public `Host`, which the loopback listener rejects, and the cookie name
encodes that authority. Rewriting both keeps the browser on the public origin, so a
fresh profile needs no `connection.trustedHosts` entry at all.

## Why this shape

Installing a private CA on a phone is the wrong trade, and a LAN IP over plain HTTP is
neither a secure context nor installable as an app. A publicly trusted tunnel is the
only zero-install path, and Tailscale's is private to the tailnet by default.

Funnel (`tailscale funnel --bg --https=443 http://127.0.0.1:3443`) works the same way
for phones without Tailscale, but it publishes the sign-in URL to the internet; the
token then is the only gate, so treat that QR like a password.

## Configuration

```yaml
- id: dshfiles-phone-access
  config:
    origins:
      - https://m4-work.tail140263.ts.net
    proxyPort: 3443
```

`DSH_PHONE_ORIGINS` (comma separated) sets origins without editing the patch;
configured origins win. Only absolute `https:` origins without credentials, query or
fragment are printed. With no origin configured the proxy still runs, so
`pnpm dsh:phone` can print the QR on demand.

## Security model

1. The QR carries the process launch token; anyone who scans it while the process
   runs gets the same access as the desktop browser.
2. The cookie is signed with the persistent browser-session secret and outlives a DSH
   restart, but it is not per-device revocable. Revoking a phone means removing it from
   the tailnet and rotating that secret (or waiting for expiry).
3. Tailscale terminates TLS outside DSH, so the cookie is minted without `Secure`. Do
   not expose the same hostname over plain HTTP.
4. A paired browser has full DSH privileges, including a terminal running as your OS
   user. This plugin adds no weaker a boundary than the desktop browser, and it does
   not protect against an intentionally hostile paired client.
