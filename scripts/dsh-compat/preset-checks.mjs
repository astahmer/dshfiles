/**
 * Runtime proof that saved agent presets work on a booted Host. A build that
 * passes, a page that serves, or a visible New thread button proves none of
 * it: the preset registry marks a preset broken only when it mounts, and a new
 * thread on that preset fails only when it binds. These checks ask the
 * registry, create a real thread on each preset, and open that thread's
 * composer in a real browser.
 *
 * `rpc(namespace, method, args)` is the authenticated client RPC `cli.mjs`
 * builds: it resolves to `{ status, body }`.
 */
import { randomUUID } from 'node:crypto'
import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

const SYSTEM_BROWSERS = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser']

/** A Chrome on PATH, or `DSH_LKG_CHROMIUM` when set. */
const systemChromium = () => {
  const explicit = process.env.DSH_LKG_CHROMIUM?.trim()
  if (explicit) return explicit
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    for (const name of SYSTEM_BROWSERS) {
      try {
        accessSync(join(directory, name), constants.X_OK)
        return join(directory, name)
      } catch {}
    }
  }
  return undefined
}

/**
 * Launch headless Chromium. Playwright's own build needs FHS libraries that
 * NixOS does not provide; fall back to a system Chrome there.
 */
const launchChromium = async chromium => {
  const explicit = process.env.DSH_LKG_CHROMIUM?.trim()
  if (explicit) return chromium.launch({ headless: true, executablePath: explicit })
  try {
    return await chromium.launch({ headless: true })
  } catch (error) {
    const executablePath = systemChromium()
    if (executablePath === undefined) throw error
    return chromium.launch({ headless: true, executablePath })
  }
}

const valueOf = async response => {
  const { status, body } = await response
  const parsed = status === 200 ? JSON.parse(body) : undefined
  if (parsed === undefined) throw new Error(`HTTP ${String(status)}: ${body.slice(0, 300)}`)
  if (parsed.result?.ok === false) {
    const error = parsed.result.error ?? {}
    throw Object.assign(new Error(`${String(error.code ?? 'error')}: ${String(error.message ?? '').slice(0, 400)}`), { code: error.code })
  }
  if (parsed.error !== undefined) throw new Error(JSON.stringify(parsed.error).slice(0, 400))
  return parsed.result?.value ?? parsed.result
}

/** Every expected preset is registered and none is broken. */
const presetRosterCheck = async ({ rpc, presets }) => {
  try {
    const roster = (await valueOf(rpc('agentPresets', 'list', {}))).presets ?? []
    const problems = []
    for (const id of presets) {
      const row = roster.find(candidate => candidate.id === id)
      if (row === undefined) problems.push(`${id}: not registered (available: ${roster.map(candidate => candidate.id).join(', ')})`)
      else if (row.broken !== undefined) problems.push(`${id}: broken: ${row.broken}`)
    }
    const others = roster.filter(row => row.broken !== undefined && !presets.includes(row.id)).map(row => `${row.id}: broken: ${row.broken}`)
    const failing = [...problems, ...others]
    return {
      name: 'agent-presets',
      ok: failing.length === 0,
      detail:
        failing.length === 0
          ? `${String(roster.length)} preset(s) registered, none broken; checked ${presets.join(', ') || 'none saved'}`
          : failing.join(' | ').slice(0, 1200),
    }
  } catch (error) {
    return { name: 'agent-presets', ok: false, detail: String(error).slice(0, 400) }
  }
}

/**
 * Create a new thread on each preset and load it back. Returns the check and
 * the threads it created, so the composer check can open one.
 */
const presetThreadCheck = async ({ rpc, presets, cwd }) => {
  const threads = []
  const problems = []
  for (const preset of presets) {
    try {
      const request = { agentPreset: preset }
      if (cwd !== undefined) request.cwd = cwd
      const created = await valueOf(rpc('session', 'create', { request }))
      if (created.agentPreset !== preset) {
        problems.push(`${preset}: the new thread runs ${String(created.agentPreset)} instead`)
        continue
      }
      const projections = await valueOf(rpc('session', 'projections', { request: { sessionId: created.sessionId } }))
      const page = await valueOf(
        rpc('session', 'page', {
          request: { address: { kind: 'session', sessionId: created.sessionId }, throughSeq: projections?.asOfSeq ?? 0, maxMessages: 20 },
        }),
      )
      if (!Array.isArray(page?.records)) {
        problems.push(`${preset}: thread ${created.sessionId} did not load`)
        continue
      }
      threads.push({ preset, sessionId: created.sessionId })
    } catch (error) {
      problems.push(`${preset}: ${String(error.message ?? error).slice(0, 400)}`)
    }
  }
  return {
    check: {
      name: 'preset-threads',
      ok: problems.length === 0,
      detail: problems.length === 0 ? `created and loaded a thread on ${threads.map(thread => thread.preset).join(', ') || 'no preset'}` : problems.join(' | '),
    },
    threads,
  }
}

const COMPOSER = /\/ commands, @ files/u
const PRESET_FAILURE = /agent-preset\/(?:invalid|not-found)|Unknown agent preset|Failed to load plugins/u
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

const sessionEvents = async (rpc, sessionId) => {
  const projections = await valueOf(rpc('session', 'projections', { request: { sessionId } }))
  const page = await valueOf(
    rpc('session', 'page', { request: { address: { kind: 'session', sessionId }, throughSeq: projections?.asOfSeq ?? 0, maxMessages: 100 } }),
  )
  return page.records.map(record => record.event)
}

/** The Session whose log holds `text`, among `candidates` or every listed one. */
const sessionHolding = async (rpc, text, candidates) => {
  const ids = candidates ?? ((await valueOf(rpc('session', 'list', { _request: {} }))).items ?? []).map(item => item.id ?? item.sessionId)
  for (const id of ids) {
    const events = await sessionEvents(rpc, id)
    if (events.some(event => JSON.stringify(event).includes(text))) return { id, events }
  }
  return undefined
}

/**
 * Prove a thread's composer is usable in a real browser: editable, keeps typed
 * text, Send enabled, no preset or plugin failure on screen. With `submit` it
 * sends and requires the Host to record the message, and returns that thread.
 *
 * With `sessionId` it opens that thread (`?thread=`, the dshfiles route). Where
 * no route opens a thread (stock DSH), or without `sessionId`, it takes the
 * path a user takes: the new-thread composer, choosing `workspace` (an absolute
 * path, or a folder the picker lists at its root) when the composer asks for one.
 */
const probeComposer = async (page, { origin, sessionId, rpc, workspace, submit = false, timeoutMs = 45_000 }) => {
  const name = 'composer'
  try {
    await page.goto(sessionId === undefined ? origin : `${origin}/?thread=${encodeURIComponent(sessionId)}`, { waitUntil: 'load', timeout: 60_000 })
    // A fresh state shows stock DSH's one-time preview notice over the composer.
    const notice = page.getByRole('dialog').getByRole('button', { name: 'Continue', exact: true })
    await notice.waitFor({ state: 'visible', timeout: 8_000 }).then(
      () => notice.click(),
      () => undefined,
    )
    const composer = page.getByRole('textbox', { name: COMPOSER }).filter({ visible: true }).first()
    const needsWorkspace = page.getByRole('textbox', { name: 'Choose workspace', exact: true }).filter({ visible: true }).first()
    await composer.or(needsWorkspace).first().waitFor({ state: 'visible', timeout: timeoutMs })
    let target = sessionId
    if (sessionId !== undefined) {
      const shown = await page
        .locator('[data-conversation-session]:visible')
        .first()
        .getAttribute('data-conversation-session', { timeout: 2_000 })
        .catch(() => null)
      if (shown !== sessionId) target = undefined
    }
    if (target === undefined && (await needsWorkspace.isVisible())) {
      if (workspace === undefined) return { name, ok: false, detail: 'the new-thread composer asks for a workspace and none was given' }
      await page.getByRole('button', { name: 'Choose workspace' }).filter({ visible: true }).first().click()
      const picker = page.getByRole('dialog')
      if (workspace.startsWith('/')) {
        // An absolute path goes through the picker's own path field; Open then opens that folder.
        await picker.getByRole('button', { name: 'Edit path', exact: true }).click()
        const path = picker.getByRole('textbox', { name: 'Edit path', exact: true })
        await path.fill(workspace)
        await path.press('Enter')
        await picker
          .getByRole('button', { name: workspace.split('/').filter(Boolean).at(-1), exact: true })
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
      } else {
        await picker.getByRole('button', { name: workspace, exact: true }).click()
      }
      await picker.getByRole('button', { name: 'Open', exact: true }).click()
      await composer.waitFor({ state: 'visible', timeout: timeoutMs })
    }
    if (!(await composer.isEditable())) return { name, ok: false, detail: 'the composer is not editable' }
    const text = `dsh-lkg composer probe ${randomUUID().slice(0, 8)}`
    await composer.fill(text)
    const kept = (await composer.inputValue().catch(async () => composer.innerText())).trim()
    if (kept !== text) return { name, ok: false, detail: `the composer did not keep typed text (read ${JSON.stringify(kept.slice(0, 80))})` }
    const send = page.getByRole('button', { name: 'Send message', exact: true }).filter({ visible: true }).first()
    await send.waitFor({ state: 'visible', timeout: 10_000 })
    if (!(await send.isEnabled())) return { name, ok: false, detail: 'Send stays disabled with text in the composer' }
    const where = target === undefined ? 'a new thread' : `thread ${target}`
    const failure = PRESET_FAILURE.exec(await page.locator('body').innerText())?.[0]
    if (failure !== undefined) return { name, ok: false, detail: `${where}: the page shows ${failure}` }
    if (!submit) return { name, ok: true, detail: `${where}: composer editable, kept typed text, Send enabled`, sessionId: target }

    await send.click()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const found = await sessionHolding(rpc, text, target === undefined ? undefined : [target])
      if (found !== undefined) {
        const presetError = found.events.map(event => JSON.stringify(event)).find(event => PRESET_FAILURE.test(event))
        if (presetError !== undefined) return { name, ok: false, detail: `the turn failed on its preset: ${presetError.slice(0, 300)}`, sessionId: found.id }
        const onScreen = PRESET_FAILURE.exec(await page.locator('body').innerText())?.[0]
        if (onScreen !== undefined) return { name, ok: false, detail: `the page shows ${onScreen} after sending`, sessionId: found.id }
        return { name, ok: true, detail: `thread ${found.id}: the composer sent a message the Host recorded`, sessionId: found.id, text }
      }
      await pause(500)
    }
    return { name, ok: false, detail: `the Host never recorded the message sent from ${where}` }
  } catch (error) {
    return { name, ok: false, detail: String(error).replace(/\s+/g, ' ').slice(0, 400) }
  }
}

/** Runtime proof that saved agent presets work on a booted Host. */
export class PresetChecks {
  static roster = presetRosterCheck
  static threads = presetThreadCheck
  static composer = probeComposer
  static launchChromium = launchChromium
  static systemChromium = systemChromium
}
