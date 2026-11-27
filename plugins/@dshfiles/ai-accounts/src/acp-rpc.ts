import * as Schema from 'effect/Schema'
import { CliBridge } from './cli-bridge.js'

/**
 * JSON-RPC 2.0, one message per line: the transport of the Agent Client Protocol (ACP) that
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

type AcpRequestAnswer = { readonly result: AcpJson } | undefined

export class AcpRpc {
  private nextId = 1
  private readonly pending = new Map<
    string | number,
    { readonly method: string; readonly resolve: (value: AcpJson) => void; readonly reject: (error: Error) => void }
  >()
  private closedWith: Error | undefined

  constructor(
    private readonly input: {
      /** Write one line to the agent's stdin. */
      readonly send: (line: string) => void
      /** A notification from the agent, such as `session/update`. */
      readonly onNotification: (method: string, params: AcpJson) => void
      /** A request from the agent, such as `session/request_permission`: the result sent back, or none for an unsupported method. */
      readonly onRequest: (method: string, params: AcpJson) => AcpRequestAnswer | Promise<AcpRequestAnswer>
    },
  ) {}

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
    this.input.send(JSON.stringify(message))
  }

  /** One line the agent wrote to its stdout. */
  accept(line: string): void {
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
    void this.respond(message.id, message.method, message.params ?? null)
  }

  private async respond(id: string | number, method: string, params: AcpJson): Promise<void> {
    try {
      const answer = await this.input.onRequest(method, params)
      if (this.closedWith !== undefined) return
      if (answer === undefined) {
        this.write({ jsonrpc: '2.0', id, error: { code: -32601, message: `DSH does not serve ${method}` } })
        return
      }
      this.write({ jsonrpc: '2.0', id, result: answer.result })
    } catch {
      if (this.closedWith === undefined) this.write({ jsonrpc: '2.0', id, error: { code: -32603, message: 'DSH could not answer the ACP request.' } })
    }
  }
}
