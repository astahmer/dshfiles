# Local HTTPS certificate (abandoned)

A local certificate authority was generated under `~/.dsh/phone-pairing/tls` and a
temporary `node:https` listener on `192.168.1.44:3443` answered
`curl --cacert ca.crt https://192.168.1.44:3443/health` with a validated chain. That
proved the Wi-Fi TLS leg works.

The approach was then dropped: trusting a private CA means installing a root
certificate on every phone, which is awkward or unavailable on many devices. It also
would have left the native plaintext listener on `192.168.1.44:3080` as a bypass. The
CA files were deleted.

The path actually pursued is a publicly trusted certificate from Tailscale Serve, which
needs no certificate install on the phone. See
[`phone-access`](../../phone-access/README.md) and the transport proof below.

## Transport proof (Tailscale Serve, disposable host)

On a throwaway profile with `connection.trustedHosts: [m4-work.tail140263.ts.net]` and
`tailscale serve --bg --https=443 http://127.0.0.1:3198`:

- token exchange through `https://m4-work.tail140263.ts.net/?token=…` → `303`
- authenticated `GET /` → `200`
- `/api/…` with cookie → `404` (authorized, route absent) instead of `403`
- `/api/…` without cookie → `401`
- `/api/remote.mux` WebSocket upgrade → `101 Switching Protocols`

Serve was disabled and the host stopped afterwards. This proves the transport and the
origin fence, not a live deployment. The live host still serves plaintext HTTP on
`192.168.1.44:3080` until it is restarted with Tailscale enabled and LAN access off.
