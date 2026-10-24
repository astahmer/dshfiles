# Loopback access

Keep the same authenticated DSH available on **localhost and its selected LAN
address**, without changing the native Web server, its routes, or its security
policy. This Host-only plugin uses Node's cross-platform TCP implementation;
it needs no systemd, launchd, shell utility, fixed LAN IP, or fixed port.

## Behavior

- A native loopback bind is left completely unchanged. Installing this plugin
  does **not** enable LAN access.
- With a concrete non-loopback bind, the plugin forwards `127.0.0.1` and `::1`
  on the native port to that same native listener. IPv6 is optional only when
  the OS genuinely does not support it; occupied ports are reported, not hidden.
- HTTP bytes, cookies, Origin, WebSocket upgrades, streaming and TLS pass
  unchanged. Native launch-token authentication and same-origin fencing remain
  authoritative. No trusted hosts are added and no local login is bypassed.
- Native `webServer.host` and the actual initialized `webServer.port` are the
  only target configuration. Outgoing connections pin their source to that
  native interface. No arbitrary target or listening-address configuration is
  exposed.
- Connections use stream backpressure, a five-second connect deadline and a
  256-pair limit. Unloading the plugin closes both listeners and every accepted
  and upstream socket, including idle streams. Startup failure rolls back.

On the serving computer, open the native tokenized launch URL with only its
hostname changed to `localhost`; the normal login redirects to a clean URL.
The LAN login cookie does not transfer to localhost because native DSH binds
cookies to their authority. Use the original LAN URL on your phone.

For HTTPS, keep the `https` scheme: the configured certificate must also cover
localhost. A TCP forwarder does not terminate TLS or bypass certificate checks.

## Install

This bundle is **optional**: no checked-in profile enables it. Build the
package, then explicitly select it in a profile you own: add a local `link:`
dependency pointing to this package and include `@dshfiles/loopback-access` in
that profile's `dsh.profile.bundles` list. Install that profile's dependencies
and restart it normally. Its bundle patch inserts only the owned
`dshfiles-loopback-access` Loader row; it never edits native Web server rows.
Disabling that row removes the adjunct; the native LAN listener is not modified.
Installing or building the repository alone does not activate this plugin.
The seeded `web` synchronizer follows its explicit seed bundle list, which
omits this package. The existing **all-owned** development flows (scratch
compositions and syncing an unseeded profile without `--bundle`) deliberately
select every owned bundle, including this one. For a custom profile, select
bundles explicitly rather than using that bulk opt-in.

The read-only `loopback_access_status` agent tool reports actual listeners and
non-secret origins. It never returns launch tokens or cookies.

## Why an owned plugin

This is a new owned package, contributed from Neolectron's forwarding-only
implementation at `ab67ee7797a3119b42724e59d44a25c654b0446d`. It is not a fork of
a native DSH package or a port of another network proxy. It adds only inward
loopback access and deliberately preserves the stock authentication and
routing model. No third-party implementation was copied; dependencies are the
repository's existing dshx SDK, native DSH libraries, Zod and standard Node APIs.

Verified public contract: `@deepseek-ai/dsh-host-webserver@0.2.1-rc.2` exposes
`host`, initialized `port`, `protocol` and `getOrigin`. No native private field
or core patch is used. The startup lifecycle uses the official Cordis promised
disposer contract through upstream dshx's public `defineHost({ setup })` API.
There is no startup provider, settings UI, launcher integration, trusted-host
exception or replacement authentication layer. Changes require a Host restart.

## Permission and license status

The author explicitly authorized publishing this optional contribution as a
draft for review. The source manifest said MIT but shipped no package license
text, and this repository has no root license grant. This draft does not invent
one: the package remains private and marked `UNLICENSED` pending the author's
formal license choice before adoption or redistribution under an open-source
license. The existing SDK/libraries retain their own licenses; no third-party
provenance or license is claimed for the new code.

## Verification

```sh
pnpm --dir plugins/@dshfiles/loopback-access typecheck
pnpm --dir plugins/@dshfiles/loopback-access test
pnpm --dir plugins/@dshfiles/loopback-access build
pnpm check:e2e loopback-access
```

The package pins the native component test dependencies to `0.2.1-rc.2` via
the repository catalog. It does not import or install the monolithic Core
package. Consequently dshx emits `DSHX5104` / `DSHX5109` support-range and local
Core-pin warnings: compatibility is proven against the component contracts
and a stock `0.2.1-rc.2` scratch runtime, not asserted for other Core releases.
These warnings are not suppressed.

The socket tests use real IPv4/IPv6 connections, exact HTTP headers, duplex
streams, half-close behavior, occupied-port rollback and disposal/rebind checks.
The isolated stock-DSH journey checks native authentication and real RPC on
both origins, rejected hostile Host/Origin/cross-site requests, authority-bound
cookies, and a browser WebSocket through the loopback listener.

The implementation uses portable Node sockets. Linux is checked locally;
macOS and Windows execution is unverified. `loopback listen` and
`loopback connect` spans record bounded socket setup only, not headers, bytes,
cookies, launch tokens or addresses; real-socket tests assert their metadata.
