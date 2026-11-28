import { Option, Schema } from 'effect'

const text = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

/** What a browser tab waits on the user for, as the relay reports it. */
export const browseHandoffSchema = Schema.Struct({ message: text(2_000), startedAt: Schema.NullOr(text(64)) })
export type BrowseHandoff = typeof browseHandoffSchema.Type

export const browseTabSchema = Schema.Struct({
  tab: Schema.Number,
  id: Schema.NullOr(text(200)),
  url: text(4_000),
  title: text(1_000),
  browser: Schema.NullOr(text(200)),
  busy: Schema.Boolean,
  lent: Schema.Boolean,
  handoff: Schema.NullOr(browseHandoffSchema),
})
export type BrowseTab = typeof browseTabSchema.Type

export const browseBrowserSchema = Schema.Struct({
  id: text(200),
  name: text(200),
  connected: Schema.Boolean,
  isDefault: Schema.Boolean,
  version: Schema.NullOr(text(64)),
  tabs: count,
})
export type BrowseBrowser = typeof browseBrowserSchema.Type

export const PAIRING_STATES = ['idle', 'pending', 'paired', 'expired', 'failed', 'cancelled'] as const

/** The one pairing the Host runs at a time, from its code to how it ended. */
export const pairingSchema = Schema.Struct({
  state: Schema.Literals(PAIRING_STATES),
  code: Schema.NullOr(text(64)),
  instructions: Schema.NullOr(text(1_000)),
  startedAt: Schema.NullOr(count),
  expiresAt: Schema.NullOr(count),
  endedAt: Schema.NullOr(count),
  browser: Schema.NullOr(text(200)),
  message: Schema.NullOr(text(1_000)),
})
export type Pairing = typeof pairingSchema.Type

export const IDLE_PAIRING: Pairing = {
  state: 'idle',
  code: null,
  instructions: null,
  startedAt: null,
  expiresAt: null,
  endedAt: null,
  browser: null,
  message: null,
}

export const BROWSE_INSTALL_HELP =
  'Install browse with Nix (it is in the NixConfig home packages) or run `curl -fsSL https://opencode.ai/browse/install | bash`, then check `browse --version` in a terminal. If it is installed somewhere DSH does not look, set Settings › Plugins › browse › command to its absolute path.'

export const browseStatusSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('ready'),
    command: text(4_000),
    version: Schema.NullOr(text(64)),
    setupInstalled: Schema.Boolean,
    relay: Schema.Struct({ running: Schema.Boolean, endpoint: Schema.NullOr(text(200)), version: Schema.NullOr(text(64)), startedAt: Schema.NullOr(text(64)) }),
    extension: Schema.Struct({
      connected: Schema.Boolean,
      pairingState: Schema.NullOr(text(64)),
      version: Schema.NullOr(text(64)),
      nextStep: Schema.NullOr(text(2_000)),
    }),
    browsers: Schema.Array(browseBrowserSchema),
    tabs: Schema.Array(browseTabSchema),
    waiting: count,
    pairing: pairingSchema,
  }),
  Schema.Struct({ kind: Schema.Literal('not-installed'), command: text(4_000), recovery: text(2_000), pairing: pairingSchema }),
  Schema.Struct({ kind: Schema.Literal('failed'), command: text(4_000), message: text(1_000), recovery: text(2_000), pairing: pairingSchema }),
])
export type BrowseStatus = typeof browseStatusSchema.Type

export const pairedBrowserSchema = Schema.Struct({
  id: Schema.NullOr(text(200)),
  name: Schema.NullOr(text(200)),
  profile: text(200),
  paired: text(64),
  lastSeen: text(64),
})
export type PairedBrowser = typeof pairedBrowserSchema.Type

export const pairingsSchema = Schema.Struct({ browsers: Schema.Array(pairedBrowserSchema), legacyCode: Schema.Boolean })
export type Pairings = typeof pairingsSchema.Type

const optionalText = Schema.optionalKey(Schema.NullOr(Schema.String))

/** `browse status --json`: the relay's own `status` tool output plus `setup`; unknown fields are ignored. */
const statusJsonSchema = Schema.Struct({
  connected: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  pairingState: optionalText,
  nextStep: optionalText,
  relay: Schema.Struct({
    running: Schema.optionalKey(Schema.Boolean),
    endpoint: optionalText,
    version: optionalText,
    startedAt: optionalText,
  }),
  extension: Schema.optionalKey(
    Schema.Struct({
      version: optionalText,
      browsers: Schema.optionalKey(
        Schema.Array(
          Schema.Struct({
            id: Schema.String,
            name: optionalText,
            default: Schema.optionalKey(Schema.Boolean),
            connected: Schema.optionalKey(Schema.Boolean),
            version: optionalText,
            tabs: Schema.optionalKey(Schema.Number),
          }),
        ),
      ),
    }),
  ),
  tabs: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        tab: Schema.Number,
        id: optionalText,
        url: optionalText,
        title: optionalText,
        browser: optionalText,
        busy: Schema.optionalKey(Schema.Boolean),
        lent: Schema.optionalKey(Schema.Boolean),
        handoff: Schema.optionalKey(Schema.NullOr(Schema.Struct({ message: optionalText, startedAt: optionalText }))),
      }),
    ),
  ),
  setup: Schema.optionalKey(Schema.Struct({ installed: Schema.optionalKey(Schema.Boolean), version: optionalText })),
})
type StatusJson = typeof statusJsonSchema.Type

const decodeStatusJson = Schema.decodeUnknownOption(Schema.fromJsonString(statusJsonSchema))

const clamp = (value: string, maximum: number): string => (value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`)
const textOr = (value: string | null | undefined, maximum: number): string | null => (value === null || value === undefined ? null : clamp(value, maximum))

const tabsOf = (json: StatusJson): readonly BrowseTab[] =>
  (json.tabs ?? []).map(tab => ({
    tab: tab.tab,
    id: textOr(tab.id, 200),
    url: clamp(tab.url ?? '', 4_000),
    title: clamp(tab.title ?? '', 1_000),
    browser: textOr(tab.browser, 200),
    busy: tab.busy ?? false,
    lent: tab.lent ?? false,
    handoff:
      tab.handoff === null || tab.handoff === undefined
        ? null
        : { message: clamp(tab.handoff.message ?? 'An agent waits for you in this tab.', 2_000), startedAt: textOr(tab.handoff.startedAt, 64) },
  }))

const browsersOf = (json: StatusJson): readonly BrowseBrowser[] =>
  (json.extension?.browsers ?? []).map(browser => ({
    id: clamp(browser.id, 200),
    name: clamp(browser.name ?? browser.id, 200),
    connected: browser.connected ?? false,
    isDefault: browser.default ?? false,
    version: textOr(browser.version, 64),
    tabs: Math.max(0, Math.trunc(browser.tabs ?? 0)),
  }))

/**
 * Reads `browse status --json` stdout. A stopped relay answers `relay.running: false` with only `setup`; a running one
 * answers the relay's status tool output, which has no `running` field.
 */
const parseStatus = (input: { readonly stdout: string; readonly command: string; readonly pairing: Pairing }): Option.Option<BrowseStatus> =>
  Option.map(decodeStatusJson(input.stdout), json => {
    const running = json.relay.running ?? true
    const tabs = running ? tabsOf(json) : []
    return {
      kind: 'ready',
      command: input.command,
      version: textOr(json.setup?.version, 64),
      setupInstalled: json.setup?.installed ?? false,
      relay: {
        running,
        endpoint: textOr(json.relay.endpoint, 200),
        version: textOr(json.relay.version, 64),
        startedAt: textOr(json.relay.startedAt, 64),
      },
      extension: {
        connected: running && json.connected === true,
        pairingState: running ? textOr(json.pairingState, 64) : null,
        version: textOr(json.extension?.version, 64),
        nextStep: running ? textOr(json.nextStep, 2_000) : null,
      },
      browsers: running ? browsersOf(json) : [],
      tabs,
      waiting: tabs.filter(tab => tab.handoff !== null).length,
      pairing: input.pairing,
    }
  })

const CODE_LINE = /^Pairing code:\s*([A-Za-z0-9]{2,16}(?:-[A-Za-z0-9]{2,16}){0,7})\s*$/u
const PAIRED_LINE = /^✓ Paired (.+?)\.?\s*$/u

/** `browse pair` prints `Pairing code: XXXX-XXXX` first. */
const parsePairingCode = (line: string): Option.Option<string> => Option.fromNullishOr(CODE_LINE.exec(line.trim())?.[1])

/** `browse pair` prints `✓ Paired <name>.` once the browser redeemed the code. */
const parsePairedLine = (line: string): Option.Option<string> => Option.map(Option.fromNullishOr(PAIRED_LINE.exec(line.trim())?.[1]), name => clamp(name, 200))

const PAIR_INSTRUCTIONS = /^Open the Extensions menu/u

const parsePairingInstructions = (line: string): Option.Option<string> =>
  PAIR_INSTRUCTIONS.test(line.trim()) ? Option.some(clamp(line.trim(), 1_000)) : Option.none()

const DETAIL_LINE = /^ {2}(profile|paired|last seen)\s+(.+)$/u

/** `browse pair --list`: a header line `<id or (not connected yet)>[  <name>]`, then indented profile/paired/last seen lines. */
const parsePairList = (stdout: string): Pairings => {
  const browsers: PairedBrowser[] = []
  let current: { id: string | null; name: string | null; profile?: string; paired?: string; lastSeen?: string } | undefined
  const flush = () => {
    if (current?.profile !== undefined) {
      browsers.push({
        id: current.id,
        name: current.name,
        profile: current.profile,
        paired: current.paired ?? 'unknown',
        lastSeen: current.lastSeen ?? 'unknown',
      })
    }
    current = undefined
  }
  for (const line of stdout.split(/\r?\n/u)) {
    const detail = DETAIL_LINE.exec(line)
    if (detail !== null && current !== undefined) {
      const value = clamp(detail[2]?.trim() ?? '', 200)
      if (detail[1] === 'profile') current.profile = value
      if (detail[1] === 'paired') current.paired = clamp(value, 64)
      if (detail[1] === 'last seen') current.lastSeen = clamp(value, 64)
      continue
    }
    if (line.length === 0 || line.startsWith(' ') || line.startsWith('No paired browsers') || line.startsWith('The shared pairing code')) continue
    flush()
    const [head = '', ...rest] = line.split('  ')
    const name = rest.join('  ').trim()
    current = { id: head === '(not connected yet)' ? null : clamp(head.trim(), 200), name: name.length === 0 ? null : clamp(name, 200) }
  }
  flush()
  return { browsers, legacyCode: stdout.includes('The shared pairing code of an earlier version') }
}

export const BrowseOutput = {
  parseStatus,
  parsePairingCode,
  parsePairedLine,
  parsePairingInstructions,
  parsePairList,
  clamp,
} as const
