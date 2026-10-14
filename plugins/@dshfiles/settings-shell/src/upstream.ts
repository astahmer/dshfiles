/**
 * The native packages this shell was ported from. `upstream-version.test.ts` fails when the repository's DSH packages
 * move past them, and the Host warns at boot when the running DSH ships different versions: either way, diff the new
 * `lib/client.js` against these versions and refresh `src/native/` before trusting the port.
 */
export const PORTED_FROM = {
  packageName: '@deepseek-ai/dsh-client-ui-settings-general',
  version: '0.2.0-rc.2',
} as const

/** The welcome notice step, ported because it stores its acknowledgement in the switched-off row's namespace. */
export const WELCOME_PORTED_FROM = {
  packageName: '@deepseek-ai/dsh-client-ui-settings-models',
  version: '0.2.0-rc.2',
} as const
