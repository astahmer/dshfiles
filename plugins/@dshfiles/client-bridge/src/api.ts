import { defineApi, event, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

const id = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const jsonObject = Schema.Record(Schema.String, Schema.Json)

/** Limits shared by the Host and the page. */
export const BridgeLimits = {
  /** Tools one window may announce. */
  maxTools: 200,
  defaultTimeoutMs: 10_000,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  /** A window that has not announced itself for this long is gone (a closed tab never says goodbye reliably). */
  windowTtlMs: 90_000,
  /** How often a page re-announces itself while nothing changes. */
  heartbeatMs: 30_000,
} as const

export const clientToolDescriptorSchema = Schema.Struct({
  name: id(64),
  title: Schema.String.check(Schema.isMaxLength(120)),
  description: Schema.String.check(Schema.isMaxLength(2_000)),
  readOnly: Schema.Boolean,
  inputSchema: jsonObject,
})

/** What a page says about itself. */
export const windowStateSchema = Schema.Struct({
  clientId: id(64),
  /** Short description of the browser, such as "Chrome on macOS", so an Agent can tell windows apart. */
  label: Schema.String.check(Schema.isMaxLength(120)),
  focused: Schema.Boolean,
  visible: Schema.Boolean,
  /** The thread the main view shows, or null while a panel takes it. */
  sessionId: Schema.NullOr(id(200)),
  tools: Schema.Array(clientToolDescriptorSchema).check(Schema.isMaxLength(BridgeLimits.maxTools)),
})

export type ClientToolDescriptorView = typeof clientToolDescriptorSchema.Type
export type WindowState = typeof windowStateSchema.Type

const windowViewSchema = Schema.Struct({
  clientId: Schema.String,
  label: Schema.String,
  focused: Schema.Boolean,
  visible: Schema.Boolean,
  sessionId: Schema.NullOr(Schema.String),
  showsYourThread: Schema.Boolean,
  lastActiveAt: Schema.Number,
  tools: Schema.Array(clientToolDescriptorSchema),
})

export type WindowView = typeof windowViewSchema.Type

export const completionSchema = Schema.Struct({
  requestId: id(64),
  clientId: id(64),
  outcome: Schema.Literals(['ok', 'error']),
  /** The tool's JSON result when `ok`. */
  result: Schema.optionalKey(Schema.Json),
  /** What went wrong when `error`; shown to the Agent. */
  error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000))),
})

export const clientBridgeApi = defineApi({
  id: 'client-bridge',
  version: 1,
  owner: '@dshfiles/client-bridge',
  methods: {
    announce: method({
      input: windowStateSchema,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      description: 'A browser window says it is open, whether it has focus, which thread it shows and which client tools it offers.',
    }),
    leave: method({
      input: Schema.Struct({ clientId: id(64) }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description: 'A browser window is closing; its pending calls fail at once instead of timing out.',
    }),
    complete: method({
      input: completionSchema,
      output: Schema.Struct({ accepted: Schema.Boolean }),
      description: 'A browser window reports the result of a client tool call it was asked to run.',
    }),
    list: method({
      input: Schema.Struct({}),
      output: Schema.Struct({ enabled: Schema.Boolean, windows: Schema.Array(windowViewSchema) }),
      description:
        'The DSH browser windows open now: each with its clientId, whether it has focus, the thread it shows (showsYourThread is true for yours) and the client tools it offers with their input schemas. Client tools act in the user’s browser page (open Settings at a section, open a tab), which Host tools cannot reach. Call client_tool_call to run one. Read-only.',
      tool: { name: 'client_tools_list', readOnly: true, render: compactJson },
    }),
    call: method({
      input: Schema.Struct({
        tool: id(64).annotate({ description: 'Client tool name from client_tools_list, e.g. "settings_open".' }),
        input: Schema.optionalKey(jsonObject).annotate({ description: 'The tool’s input, matching its inputSchema. Omit for none.' }),
        clientId: Schema.optionalKey(id(64)).annotate({
          description: 'Window to act in, from client_tools_list. Omit to use the focused window showing your thread, else the window used most recently.',
        }),
        timeoutMs: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(BridgeLimits.minTimeoutMs), Schema.isLessThanOrEqualTo(BridgeLimits.maxTimeoutMs)),
        ).annotate({ description: 'How long to wait for the window, 1000 to 60000 ms; defaults to 10000.' }),
      }),
      output: Schema.Struct({ clientId: Schema.String, tool: Schema.String, result: Schema.Json }),
      description:
        'Run one client tool in a DSH browser window and return its result: the action happens in the user’s page (Settings opens, a tab opens). Run a tool that changes the page only when the user asked for that action; read-only tools may be called freely. The window shows the user a notice naming the action.',
      tool: { name: 'client_tool_call', readOnly: false, render: compactJson },
    }),
  },
  events: {
    invoke: event({
      schema: Schema.Struct({
        requestId: Schema.String,
        clientId: Schema.String,
        tool: Schema.String,
        input: jsonObject,
        timeoutMs: Schema.Number,
        /** Show the user a notice naming the action (the `notify` setting); read-only tools never do. */
        notify: Schema.Boolean,
        /** The Host span the call runs under, so the page's span joins the same trace. */
        traceparent: Schema.NullOr(Schema.String),
      }),
      description: 'Run one client tool in the window named by clientId; every other window ignores it.',
    }),
  },
})
