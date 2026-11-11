/**
 * Publish the Host runtime snapshot into `runtime-store/` as part of the dshx build.
 *
 * A plugin's Host bundle imports `@dshfiles/dshx/runtime-store/<hash>/…`. Plugin builds publish that snapshot as a side
 * effect, but a Turbo cache hit replays only the plugin's `dist`, so a fresh workspace got bundles importing a snapshot
 * that was never written. Publishing it here makes it an output of `@dshfiles/dshx#build`, which Turbo restores.
 */
import { HostRuntimeSnapshot } from '../dist/compiler/host/build.js'

const snapshot = await HostRuntimeSnapshot.publish()
console.log(`dshx host runtime snapshot ${snapshot.hash}`)
