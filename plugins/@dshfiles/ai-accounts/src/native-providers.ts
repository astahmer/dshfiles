import type { Context } from '@deepseek-ai/cordis'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import type { NativeProviders } from './api.js'
import { isPatchRowId, managedDisabledRows, withRowDisabled, withRowEnabled } from './native-provider-patch.js'

/**
 * Native provider rows on the Models page — DeepSeek, DeepSeek Account, a
 * community Command Code plugin — each come from their own Loader row. Turning
 * one off sets that row's `disabled` flag in the profile patch, so its config
 * and its credential reference survive and turning it back on restores it
 * exactly. With HMR watching the patch the change applies within seconds;
 * without it, on the next start.
 *
 * Rows that serve several unrelated routes (`llm-pi-ai` holds every custom
 * provider) and this plugin's own routes are not offered.
 */

const EXCLUDED_ROWS = new Set(['llm', 'llm-pi-ai'])

const readPatch = async (path: string): Promise<string> => {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return ''
    throw cause
  }
}

const writePatch = async (path: string, text: string): Promise<void> => {
  const mode = await stat(path).then(
    info => info.mode & 0o777,
    () => 0o600,
  )
  const temporary = `${path}.${String(process.pid)}.ai-accounts.tmp`
  await writeFile(temporary, text, { encoding: 'utf8', mode })
  await rename(temporary, path)
}

/** Rows switched back on in this process, listed until their providers re-register. */
const reenabling = new WeakMap<Context, Map<string, string>>()

const unavailable = (reason: string): NativeProviders => ({ available: false, liveReload: false, reason, providers: [] })

export const readNativeProviders = async (ctx: Context): Promise<NativeProviders> => {
  const patchPath = ctx.get('profileContext')?.patchPath
  const loader = ctx.get('loader')
  if (patchPath === undefined || loader === undefined)
    return unavailable('This Host runs without a profile patch, so native providers cannot be switched here.')
  const managed = managedDisabledRows(await readPatch(patchPath))
  const rows = new Map([...loader.entries()].map(entry => [entry.options.id, entry] as const))

  const routes = new Map<string, string[]>()
  const labels = new Map<string, string[]>()
  for (const provider of ctx.get('llm')?.listConfigurableProviders() ?? []) {
    const entryId = provider.settingsNs
    if (EXCLUDED_ROWS.has(entryId) || entryId.startsWith('ai-accounts') || !rows.has(entryId)) continue
    routes.set(entryId, [...(routes.get(entryId) ?? []), provider.provider])
    labels.set(entryId, [...(labels.get(entryId) ?? []), provider.displayName])
  }
  // A row this plugin disabled has left the provider directory; it is still listed so it can come back.
  const returning = reenabling.get(ctx.root) ?? new Map<string, string>()
  for (const entryId of routes.keys()) returning.delete(entryId)
  for (const entryId of [...managed.keys(), ...returning.keys()]) if (!routes.has(entryId) && rows.has(entryId)) routes.set(entryId, [])

  const providers = [...routes].map(([entryId, served]) => {
    const row = rows.get(entryId)
    const running = row !== undefined && !row.disabled && row.fiber !== undefined
    const ownSwitch = managed.has(entryId)
    const disabledElsewhere = row?.disabled === true && !ownSwitch && !returning.has(entryId)
    return {
      entryId,
      label: [...new Set(labels.get(entryId) ?? [])].join(' · ') || managed.get(entryId) || returning.get(entryId) || row?.options.name || entryId,
      routes: served,
      enabled: !ownSwitch && !disabledElsewhere,
      running,
      lockedReason: disabledElsewhere ? 'Disabled by another entry in the profile patch; re-enable it there.' : null,
    }
  })
  return { available: true, liveReload: ctx.get('hmr') !== undefined, reason: null, providers }
}

export const setNativeProviderEnabled = async (ctx: Context, input: { readonly entryId: string; readonly enabled: boolean }): Promise<NativeProviders> => {
  const current = await readNativeProviders(ctx)
  const patchPath = ctx.get('profileContext')?.patchPath
  if (!current.available || patchPath === undefined) return current
  const target = current.providers.find(provider => provider.entryId === input.entryId)
  // Only rows this page lists may be switched, so the method cannot disable an arbitrary plugin.
  if (target === undefined || !isPatchRowId(input.entryId)) throw new Error(`'${input.entryId}' is not a native provider row.`)
  if (target.lockedReason !== null) throw new Error(target.lockedReason)
  const apply = async (): Promise<void> => {
    const text = await readPatch(patchPath)
    const next = input.enabled ? withRowEnabled(text, input.entryId) : withRowDisabled(text, { id: input.entryId, label: target.label })
    if (next !== text) await writePatch(patchPath, next)
    if (input.enabled) {
      const returning = reenabling.get(ctx.root) ?? new Map<string, string>()
      returning.set(input.entryId, target.label)
      reenabling.set(ctx.root, returning)
    }
  }
  const hmr = ctx.get('hmr')
  await (hmr === undefined ? apply() : hmr.runExclusive(apply))
  return readNativeProviders(ctx)
}
