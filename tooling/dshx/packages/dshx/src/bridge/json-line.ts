import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import { decodeJson, jsonValueSchema } from '../json.js'
import type { JsonValue } from '../json.js'

export type JsonLineTransportCode = 'request-too-large' | 'response-too-large' | 'invalid-json' | 'connection' | 'timeout'

export class JsonLineTransportError extends Error {
  constructor(
    readonly code: JsonLineTransportCode,
    message: string,
  ) {
    super(message)
    this.name = 'JsonLineTransportError'
  }
}

interface JsonLineReaderCallbacks {
  readonly onLine: (line: string) => void
  readonly onTooLarge: () => void
}

class JsonLineReader {
  private buffer = Buffer.alloc(0)
  private complete = false

  constructor(
    private readonly maxBytes: number,
    private readonly callbacks: JsonLineReaderCallbacks,
  ) {}

  push(chunk: Buffer): void {
    if (this.complete) return
    const newlineIndex = chunk.indexOf(0x0a)
    const segment = newlineIndex < 0 ? chunk : chunk.subarray(0, newlineIndex + 1)
    if (this.buffer.byteLength + segment.byteLength > this.maxBytes) {
      this.complete = true
      this.callbacks.onTooLarge()
      return
    }
    this.buffer = Buffer.concat([this.buffer, segment])
    if (newlineIndex < 0) return
    this.complete = true
    this.callbacks.onLine(this.buffer.subarray(0, this.buffer.byteLength - 1).toString('utf8'))
  }
}

const acceptJsonLine = (socket: Socket, maxBytes: number, callbacks: JsonLineReaderCallbacks): void => {
  const reader = new JsonLineReader(maxBytes, callbacks)
  socket.on('data', chunk => reader.push(chunk))
}

export interface JsonLineRequestOptions {
  readonly maxRequestBytes: number
  readonly maxResponseBytes: number
  readonly timeoutMs: number
}

const requestJsonLine = async (socketPath: string, payload: string, options: JsonLineRequestOptions): Promise<JsonValue> => {
  if (Buffer.byteLength(payload) > options.maxRequestBytes) {
    throw new JsonLineTransportError('request-too-large', 'JSON-line request exceeds the size limit.')
  }

  return await new Promise<JsonValue>((resolve, reject) => {
    const socket = createConnection(socketPath)
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const settle = (): boolean => {
      if (settled) return false
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      socket.destroy()
      return true
    }
    const fail = (error: JsonLineTransportError): void => {
      if (settle()) reject(error)
    }
    const succeed = (value: JsonValue): void => {
      if (settle()) resolve(value)
    }

    timer = setTimeout(() => fail(new JsonLineTransportError('timeout', 'JSON-line request timed out.')), options.timeoutMs)
    socket.once('error', error => fail(new JsonLineTransportError('connection', error.message)))
    acceptJsonLine(socket, options.maxResponseBytes, {
      onLine: line => {
        try {
          succeed(decodeJson(jsonValueSchema, line))
        } catch (error) {
          fail(new JsonLineTransportError('invalid-json', String(error)))
        }
      },
      onTooLarge: () => fail(new JsonLineTransportError('response-too-large', 'JSON-line response exceeds the size limit.')),
    })
    socket.once('connect', () => socket.write(payload))
  })
}

export interface JsonLineWriteOptions<Fallback = never> {
  readonly maxBytes?: number
  readonly onTooLarge?: () => Fallback
}

const writeJsonLine = <Value, Fallback>(socket: Socket, value: Value, options: JsonLineWriteOptions<Fallback> = {}): void => {
  const text = JSON.stringify(value)
  if (text === undefined) throw new Error('JSON-line response could not be serialized.')
  if (options.maxBytes !== undefined && Buffer.byteLength(text) > options.maxBytes) {
    const fallback = options.onTooLarge?.()
    if (fallback === undefined) {
      socket.destroy()
      return
    }
    socket.end(`${JSON.stringify(fallback)}\n`)
    return
  }
  socket.end(`${text}\n`)
}

export class JsonLineTransport {
  static readonly accept = acceptJsonLine
  static readonly request = requestJsonLine
  static readonly write = writeJsonLine
}
