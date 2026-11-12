/*
 * The JSON the dshx setup server sends (tooling/dshx/packages/dshx/src/setup). This package cannot import dshx: dshx
 * embeds its build output, so the shapes are restated here and checked by the server's tests.
 */

export interface SetupCheck {
  readonly id: string
  readonly label: string
  readonly state: 'ok' | 'warn' | 'fail'
  readonly detail: string
  readonly fix: string | null
}

export interface SetupPack {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly core: boolean
  readonly plugins: readonly string[]
}

export interface SetupPreset {
  readonly id: string
  readonly title: string
  readonly packs: readonly string[]
}

export interface ExistingProfile {
  readonly name: string
  readonly seeded: boolean
  readonly fromSetup: boolean
  readonly running: boolean
}

export interface SetupState {
  readonly checks: readonly SetupCheck[]
  readonly blocking: boolean
  readonly packs: readonly SetupPack[]
  readonly presets: readonly SetupPreset[]
  readonly profiles: readonly ExistingProfile[]
  readonly dshHome: string
  readonly defaults: { readonly profile: string; readonly preset: string; readonly packs?: readonly string[] }
}

export interface SetupRequest {
  readonly profile: string
  readonly packs: readonly string[]
  readonly extend: boolean
}

export interface SetupProblem {
  readonly message: string
  readonly hint: string
}

export interface InitPlan {
  readonly profile: string
  readonly profileRoot: string
  readonly packs: readonly { readonly id: string; readonly title: string }[]
  readonly plugins: readonly string[]
  readonly suppliers: readonly string[]
  readonly kept: readonly string[]
  readonly created: boolean
  readonly linked: readonly string[]
  readonly upToDate: boolean
  readonly commands: readonly string[]
  readonly files: readonly { readonly path: string; readonly change: string }[]
}

export interface SetupPlanResult {
  readonly plan: InitPlan | null
  readonly problem: SetupProblem | null
  readonly marker: { readonly path: string; readonly packs: readonly string[] } | null
  readonly unbuilt: readonly string[]
  readonly buildCommand: string | null
  readonly startCommand: string
  readonly hash: string
}

export interface SetupStep {
  readonly id: string
  readonly label: string
  readonly status: 'running' | 'done' | 'failed'
}

export type ApplyEvent =
  | { readonly type: 'step'; readonly step: SetupStep }
  | { readonly type: 'done'; readonly result: SetupPlanResult }
  | { readonly type: 'error'; readonly error: SetupProblem }

export class SetupRequestError extends Error {
  readonly hint: string
  readonly status: number
  constructor(input: { readonly message: string; readonly hint: string; readonly status: number }) {
    super(input.message)
    this.name = 'SetupRequestError'
    this.hint = input.hint
    this.status = input.status
  }
}

interface Envelope<T> {
  readonly ok: boolean
  readonly data?: T
  readonly error?: SetupProblem
}

type RequestBody = SetupRequest | { readonly token: string } | Readonly<Record<string, never>>

const call = async <T>(path: string, body?: RequestBody): Promise<T> => {
  const init: RequestInit = { method: 'GET', credentials: 'same-origin' }
  if (body !== undefined) {
    init.method = 'POST'
    init.headers = { 'content-type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const response = await fetch(path, init)
  const envelope: Envelope<T> = await response.json()
  if (!envelope.ok || envelope.data === undefined)
    throw new SetupRequestError({
      message: envelope.error?.message ?? `Request failed (${String(response.status)}).`,
      hint: envelope.error?.hint ?? 'Check the terminal running dshx setup.',
      status: response.status,
    })
  return envelope.data
}

/** Trade the one-time token from the link's fragment for the session cookie, then drop it from the address bar. */
const signIn = async (): Promise<void> => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t')
  if (token === null) return
  window.history.replaceState(null, '', window.location.pathname)
  await call('/api/session', { token })
}

const apply = async (input: { readonly request: SetupRequest; readonly hash: string; readonly onEvent: (event: ApplyEvent) => void }): Promise<void> => {
  const response = await fetch('/api/apply', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request: input.request, hash: input.hash }),
  })
  if (!response.ok || response.body === null) {
    const envelope: Envelope<unknown> = await response.json()
    throw new SetupRequestError({
      message: envelope.error?.message ?? 'Apply failed.',
      hint: envelope.error?.hint ?? 'Check the terminal running dshx setup.',
      status: response.status,
    })
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffered = ''
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffered += chunk.value
    const lines = buffered.split('\n')
    buffered = lines.pop() ?? ''
    for (const line of lines) if (line.trim() !== '') input.onEvent(JSON.parse(line))
  }
}

/** The calls the page makes, in screen order. */
export class SetupClient {
  static readonly signIn = signIn
  static readonly state = (): Promise<SetupState> => call<SetupState>('/api/state')
  static readonly plan = (request: SetupRequest): Promise<SetupPlanResult> => call<SetupPlanResult>('/api/plan', request)
  static readonly apply = apply
  static readonly shutdown = (): Promise<Readonly<Record<string, never>>> => call('/api/shutdown', {})
}
