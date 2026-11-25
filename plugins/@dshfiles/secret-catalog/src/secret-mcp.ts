import { spawn, type ChildProcess } from 'node:child_process'

// A long-lived `secret mcp` child, spoken to over newline-delimited JSON-RPC.
// One server per Host keeps every tool call off the process-spawn path; the
// server itself injects values into children and never returns one.

const REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_RUN_TIMEOUT_SECONDS = 60

interface Pending {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: NodeJS.Timeout
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export class SecretMcpClient {
  private readonly child: ChildProcess
  private buffer = ''
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false
  private readonly ready: Promise<void>

  constructor(binary = process.env['SECRET_BIN'] ?? 'secret') {
    const child = spawn(binary, ['mcp'], { stdio: ['pipe', 'pipe', 'ignore'] })
    if (child.stdout === null || child.stdin === null) throw new Error('secret mcp did not open its stdio pipes')
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => this.onData(String(chunk)))
    this.child.on('exit', code => this.failAll(new Error(`secret mcp exited (${String(code)})`)))
    this.child.on('error', error => this.failAll(error))
    this.ready = this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: '@dshfiles/secret-catalog', version: '1' },
    }).then(() => {
      this.write({ jsonrpc: '2.0', method: 'notifications/initialized' })
    })
  }

  private write(payload: unknown) {
    if (this.closed || this.child.stdin === null) return
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private onData(chunk: string) {
    this.buffer += chunk
    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim()
      this.buffer = this.buffer.slice(index + 1)
      index = this.buffer.indexOf('\n')
      if (line.length === 0) continue
      let message: unknown
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(message)) continue
      const id = typeof message['id'] === 'number' ? message['id'] : null
      if (id === null) continue
      const waiter = this.pending.get(id)
      if (waiter === undefined) continue
      this.pending.delete(id)
      clearTimeout(waiter.timer)
      waiter.resolve(message)
    }
  }

  private failAll(error: Error) {
    this.closed = true
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.pending.clear()
  }

  request(method: string, params: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`secret mcp ${method} timed out after ${String(timeoutMs)}ms`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { resolve, reject, timer })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  async callTool(name: string, args: unknown, timeoutMs = REQUEST_TIMEOUT_MS): Promise<Record<string, unknown>> {
    await this.ready
    const response = await this.request('tools/call', { name, arguments: args }, timeoutMs)
    const result = isRecord(response) && isRecord(response['result']) ? response['result'] : null
    if (result === null) throw new Error(`secret mcp ${name} returned no result`)
    const content = Array.isArray(result['content']) ? result['content'] : []
    const text = content.map(part => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '')).join('')
    let parsed: unknown = text
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    if (result['isError'] === true) throw new Error(typeof parsed === 'string' ? parsed : `secret mcp ${name} failed`)
    return isRecord(parsed) ? parsed : { text: String(parsed) }
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.failAll(new Error('secret mcp closed'))
    this.child.kill()
  }
}

export interface SecretMcpRunInput {
  readonly command: readonly string[]
  readonly cwd: string
  readonly environment: string
  readonly timeoutSeconds?: number
}

export interface SecretMcpRunResult {
  readonly exitCode: number
  readonly timedOut: boolean
  readonly stdout: string
  readonly stderr: string
  readonly injectedAliases: readonly string[]
}

const stringField = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

export const toRunResult = (value: Record<string, unknown>): SecretMcpRunResult => ({
  exitCode: typeof value['exitCode'] === 'number' ? value['exitCode'] : 0,
  timedOut: value['timedOut'] === true,
  stdout: stringField(value['stdout']),
  stderr: stringField(value['stderr']),
  injectedAliases: Array.isArray(value['injectedAliases']) ? value['injectedAliases'].filter((alias): alias is string => typeof alias === 'string') : [],
})

export const DEFAULT_RUN_TIMEOUT = DEFAULT_RUN_TIMEOUT_SECONDS
