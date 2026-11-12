/**
 * Whether the thread header names the session's agent preset (b:4qjm). The default preset goes unnamed, like the
 * composer's chip; a different one is always named. Until the roster says which is the default, nothing is drawn rather
 * than a label that would vanish a moment later; a roster that failed or has no presets still names what the session
 * recorded.
 */
export const headerNamesPreset = (preset: string | undefined, roster: string, defaultPreset: string): boolean => {
  if (preset === undefined) return false
  if (roster === 'idle' || roster === 'loading') return false
  return !(roster === 'ready' && preset === defaultPreset)
}
