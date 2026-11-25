import type { JsonSchemaNode } from '@deepseek-ai/dsh-tools'
import { ApiProtocolModel } from '../api/common.js'
import { publishedJsonSchema, toToolSchema } from '../api/json-schema.js'
import type { ApiSchema, ApiSchemaOutput } from '../api/types.js'
import type { JsonValue } from '../json.js'
import { BrowserBroker } from './broker.js'

/** What a client tool returns to the Agent: a JSON value, or nothing (sent as null). */
export type ClientToolResult = JsonValue | undefined

/** What a client tool gets for one call. */
export interface ClientToolContext {
  /** Aborted when the Host stopped waiting (timeout, cancelled turn) or the page leaves. */
  readonly signal: AbortSignal
}

/**
 * One action a browser page offers an Agent, in the WebMCP tool shape (name, description, input schema, execute).
 *
 * The plugin that owns the behavior adds it: Settings declares `settings_open`, the tab strip `tabs_open`. A bridge
 * plugin carries calls from Host-side Agents to the page; without one, the items wait here unused.
 */
export interface ClientToolItem {
  /** Unique tool name: lower-case letters, digits and `_`, starting with a letter (`settings_open`). */
  readonly name: string
  /** Short human label for the notice the page shows when an Agent runs it ("Open Settings"). */
  readonly title: string
  /** What it does, for the Agent. A write says it runs only when the user asked. */
  readonly description: string
  /** True when it only reads what the page shows. */
  readonly readOnly: boolean
  /** Its input; validated before `execute` runs. Effect Schema or Standard Schema. */
  readonly input: ApiSchema
  /** Runs the action with the validated input; its JSON-serializable result goes back to the Agent. */
  readonly execute: (input: never, context: ClientToolContext) => ClientToolResult | Promise<ClientToolResult>
}

/** A client tool as an Agent sees it: no code, a JSON Schema for its input. */
export interface ClientToolDescriptor {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly readOnly: boolean
  readonly inputSchema: JsonSchemaNode
}

const NAME = /^[a-z][a-z0-9_]{1,63}$/u

/** The page-wide list of client tools; owners `add` to it, a bridge `list`s it. */
export const ClientTools = BrowserBroker.defineRegistry<ClientToolItem>('dshx.client-tool')

/**
 * Declare one client tool with its input typed from its schema.
 * @param definition - name, title, description, read-only flag, input schema and the action.
 * @returns the item to `add` to {@link ClientTools}.
 */
const define = <const Input extends ApiSchema>(definition: {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly readOnly: boolean
  readonly input: Input
  readonly execute: (input: ApiSchemaOutput<Input>, context: ClientToolContext) => ClientToolResult | Promise<ClientToolResult>
}): ClientToolItem => {
  if (!NAME.test(definition.name)) throw new TypeError(`Client tool name ${JSON.stringify(definition.name)} must match ${String(NAME)}.`)
  if (definition.description.trim() === '') throw new TypeError(`Client tool ${definition.name} needs a description.`)
  return Object.freeze({ ...definition })
}

/**
 * What an Agent reads of one tool.
 * @param item - a registered tool.
 * @returns its name, labels and input JSON Schema.
 */
const describe = (item: ClientToolItem): ClientToolDescriptor => ({
  name: item.name,
  title: item.title,
  description: item.description,
  readOnly: item.readOnly,
  inputSchema: toToolSchema(publishedJsonSchema(item.input, 'input')),
})

/**
 * Validate an Agent's input against the tool's schema, then run it.
 * @param item - the tool.
 * @param input - the raw input the Agent sent.
 * @param context - the call's abort signal.
 * @returns the tool's result; rejects with the validation failure or what the tool threw.
 */
const run = async (item: ClientToolItem, input: unknown, context: ClientToolContext): Promise<ClientToolResult> => {
  const value = await ApiProtocolModel.validate(item.input, input ?? {})
  context.signal.throwIfAborted()
  // SAFETY: the tool's own schema produced this value, which is the input type `define` bound `execute` to.
  return item.execute(value as never, context)
}

export class ClientToolsModel {
  static readonly define = define
  static readonly describe = describe
  static readonly run = run
}
