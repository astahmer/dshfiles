/**
 * The native package this shell was ported from. `upstream-version.test.ts` fails when the repository's DSH packages
 * move past it, and the Host warns at boot when the running DSH ships a different version: either way, diff the new
 * `lib/client.js` against this version and refresh `src/native/` before trusting the port.
 */
export const PORTED_FROM = {
  packageName: '@deepseek-ai/dsh-client-ui-settings-general',
  version: '0.2.0-rc.2',
} as const
