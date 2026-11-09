# Phone access QR

Prints a scannable sign-in QR for each configured HTTPS origin at DSH startup, so a
phone signs in once and keeps its cookie across DSH restarts. It renders no panel and
exposes no model tool: the code appears in the terminal that started DSH, and the
token stays out of agent output.

## Why

Phone access without installing a certificate authority needs a publicly trusted
certificate. Tailscale Serve provides one for a tailnet-only hostname
(`https://<machine>.<tailnet>.ts.net`) and works over Wi-Fi and cellular, so this
plugin prints the origin you already reach instead of inventing a private CA.

Two Host settings make that origin usable, in the profile patch:

```yaml
- id: connection
  config:
    trustedHosts:
      - m4-work.tail140263.ts.net
- id: dshfiles-phone-access
  config:
    origins:
      - https://m4-work.tail140263.ts.net
```

`DSH_PHONE_ORIGINS` (comma separated) configures origins without editing the patch;
configured origins win. Only absolute `https:` origins without credentials, query or
fragment are printed.

## Security model

- The QR carries the process launch token. Anyone who scans it before the process
  exits gets the same access as the desktop browser.
- The resulting cookie is signed with the persistent browser-session secret: it
  survives DSH restarts for `connection.cookieMaxAgeDays` (default 30) but not a
  token rotation, and it is not per-device revocable.
- Revoking a phone means removing it from the tailnet, and rotating the browser
  session secret (or waiting for cookie expiry).
- Tailscale terminates TLS outside DSH, so the cookie is minted without `Secure`.
  Do not also expose the same hostname over plain HTTP.
- A paired browser has full DSH privileges, including a terminal running as your OS
  user. This plugin does not add a weaker boundary than the desktop browser, and it
  does not protect against an intentionally hostile paired client.
