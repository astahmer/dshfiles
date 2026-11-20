import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline'
import * as Schema from 'effect/Schema'
import { CliBridge } from './cli-bridge.js'

/**
 * JSON-RPC 2.0 over a child's stdio, one message per line: the transport of the Agent Client Protocol (ACP) that
 * `agy acp` serves. Responses settle the matching request; requests and notifications from the agent go to the owner.
 */

const rpcIdSchema = Schema.Union([Schema.String, Schema.Number])

const rpcLineSchema = Schema.Struct({
  id: Schema.optional(rpcIdSchema),
  method: Schema.optional(Schema.String),
  params: Schema.optional(Schema.Json),
  result: Schema.optional(Schema.Json),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
})

/** A JSON value as it crosses the wire; each caller decodes it with the schema of the method it called. */
export type AcpJson = typeof Schema.Json.Type

/** The agent answered a request with a JSON-RPC error. */
export class AcpRequestFailed extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'AcpRequestFailed'
  }
}

export class AcpRpc {
  private nextId = 1
  private readonly pending = new Map<
    string | number,
    { readonly method: string; readonly resolve: (value: AcpJson) => void; readonly reject: (error: Error) => void }
  >()
  private closedWith: Error | undefined

  constructor(
    private readonly input: {
      /** The agent's stdout, one JSON-RPC message per line. */
      readonly from: Readable
      /** The agent's stdin. */
      readonly to: Writable
      /** A notification from the agent, such as `session/update`. */
      readonly onNotification: (method: string, params: AcpJson) => void
      /** A request from the agent, such as `session/request_permission`: the result sent back, or none for an unsupported method. */
      readonly onRequest: (method: string, params: AcpJson) => { readonly result: AcpJson } | undefined
    },
  ) {
    createInterface({ input: input.from }).on('line', line => this.receive(line))
    // A write after the process exited fails with EPIPE; the exit handler already reports the failure.
    input.to.on('error', () => undefined)
  }

  request(method: string, params: AcpJson): Promise<AcpJson> {
    if (this.closedWith !== undefined) return Promise.reject(this.closedWith)
    const id = this.nextId
    this.nextId += 1
    return new Promise<AcpJson>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: AcpJson): void {
    if (this.closedWith === undefined) this.write({ jsonrpc: '2.0', method, params })
  }

  /** Fail every request still waiting, and any later one, with `reason`. */
  close(reason: Error): void {
    if (this.closedWith !== undefined) return
    this.closedWith = reason
    for (const request of this.pending.values()) request.reject(reason)
    this.pending.clear()
  }

  private write(message: AcpJson): void {
    this.input.to.write(`${JSON.stringify(message)}\n`)
  }

  private receive(line: string): void {
    if (line.trim() === '') return
    const decoded = CliBridge.decodeJsonLine(rpcLineSchema, line)
    if (decoded._tag !== 'Success') return
    const message = decoded.success
    if (message.method === undefined) {
      if (message.id === undefined) return
      const request = this.pending.get(message.id)
      if (request === undefined) return
      this.pending.delete(message.id)
      if (message.error !== undefined) request.reject(new AcpRequestFailed(request.method, message.error.code, message.error.message))
      else request.resolve(message.result ?? null)
      return
    }
    if (message.id === undefined) {
      this.input.onNotification(message.method, message.params ?? null)
      return
    }
    const answer = this.input.onRequest(message.method, message.params ?? null)
    if (answer === undefined) {
      this.write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `DSH does not serve ${message.method}` } })
      return
    }
    this.write({ jsonrpc: '2.0', id: message.id, result: answer.result })
  }
}
