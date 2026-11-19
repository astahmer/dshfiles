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
  /** Steps one `client_tool_call` may chain. */
  maxSteps: 20,
  /** A window that has not announced itself for this long is gone (a closed tab never says goodbye reliably). */
  windowTtlMs: 90_000,
  /** How often a page re-announces itself while nothing changes. */
  heartbeatMs: 30_000,
} as const

/**
 * What the user's window can do, named in the two Host tools' descriptions: the only text a model sees before it calls
 * client_tools_list, so without it a request like "open the README at line 10" reads as "read the file". Each
 * example is a client tool another plugin declares; `api.test.ts` fails when one no longer exists.
 */
export const WINDOW_ACTION_EXAMPLES = [
  { tool: 'editor_open_file', does: 'open a file at a line in their editor' },
  { tool: 'editor_files', does: 'read which file they have open (what “this file” means)' },
  { tool: 'workbench_open_panel', does: 'open a panel (Files, Traces…)' },
  { tool: 'browser_open', does: 'open a page beside the thread' },
  { tool: 'settings_open', does: 'open Settings at a section' },
  { tool: 'tabs_open', does: 'open a thread or panel in a tab' },
  { tool: 'palette_run', does: 'run any command palette command' },
] as const

const windowActions = WINDOW_ACTION_EXAMPLES.map(example => `${example.does} (${example.tool})`).join(', ')

/** When to reach for the window instead of a Host tool such as read. */
const WHEN_TO_USE =
  'When the user asks to open, show or display something in their window, editor or DSH (not to read it for you), act there instead of only reading it.'

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
  /** Each step's JSON result, in order: all of them when `ok`, the ones that ran before the failure when `error`. */
  results: Schema.Array(Schema.Json).check(Schema.isMaxLength(BridgeLimits.maxSteps)),
  /** The index of the step that failed when `error`. */
  failedStep: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  /** What went wrong when `error`; shown to the Agent. */
  error: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(2_000))),
})

const toolName = id(64).annotate({ description: 'Client tool name from client_tools_list, e.g. "settings_open".' })
const toolInput = Schema.optionalKey(jsonObject).annotate({ description: 'The tool’s input, matching its inputSchema. Omit for none.' })

export const stepSchema = Schema.Struct({ tool: toolName, input: toolInput })
export type ClientToolStep = typeof stepSchema.Type

const onlyOneForm = Schema.makeFilter<{ readonly tool?: string | undefined; readonly steps?: readonly unknown[] | undefined }>(input =>
  (input.tool === undefined) !== (input.steps === undefined) ? true : 'Pass exactly one of tool (one call) or steps (a chain).',
)

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
      description: `The DSH browser windows open now: each with its clientId, whether it has focus, the thread it shows (showsYourThread is true for yours) and the client tools it offers with their input schemas. Client tools act in the user’s own DSH window, which Host tools cannot reach: ${windowActions}. ${WHEN_TO_USE} Call client_tool_call to run one. Read-only.`,
      tool: { name: 'client_tools_list', readOnly: true, render: compactJson },
    }),
    call: method({
      input: Schema.Struct({
        tool: Schema.optionalKey(toolName),
        input: toolInput,
        steps: Schema.optionalKey(Schema.Array(stepSchema).check(Schema.isMinLength(1), Schema.isMaxLength(BridgeLimits.maxSteps))).annotate({
          description:
            'Instead of tool and input: up to 20 client tool calls run in order in one window, in one round trip, stopping at the first failure. Use it to chain page actions, e.g. open a panel, then open a file at a line.',
        }),
        clientId: Schema.optionalKey(id(64)).annotate({
          description: 'Window to act in, from client_tools_list. Omit to use the focused window showing your thread, else the window used most recently.',
        }),
        timeoutMs: Schema.optionalKey(
          Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(BridgeLimits.minTimeoutMs), Schema.isLessThanOrEqualTo(BridgeLimits.maxTimeoutMs)),
        ).annotate({ description: 'How long to wait for the window (the whole chain), 1000 to 60000 ms; defaults to 10000.' }),
      }).check(onlyOneForm),
      output: Schema.Struct({
        clientId: Schema.String,
        /** One call: its tool and result. */
        tool: Schema.optionalKey(Schema.String),
        result: Schema.optionalKey(Schema.Json),
        /** A chain: each step's tool and result, in order. */
        steps: Schema.optionalKey(Schema.Array(Schema.Struct({ tool: Schema.String, result: Schema.Json }))),
      }),
      description: `Run one client tool, or a chain of them with steps, in the user’s DSH browser window and return the results: ${windowActions}. ${WHEN_TO_USE} Exact names and input schemas come from client_tools_list. A chain runs in order in one round trip and stops at the first failure, naming the failed step and what ran before it. Run a tool that changes the page only when the user asked for that action; read-only tools may be called freely. The window shows the user one notice naming the actions.`,
      tool: { name: 'client_tool_call', readOnly: false, render: compactJson },
    }),
  },
  events: {
    invoke: event({
      schema: Schema.Struct({
        requestId: Schema.String,
        clientId: Schema.String,
        steps: Schema.Array(Schema.Struct({ tool: Schema.String, input: jsonObject })),
        timeoutMs: Schema.Number,
        /** Show the user a notice naming the action (the `notify` setting); read-only tools never do. */
        notify: Schema.Boolean,
        /** The Host span the call runs under, so the page's span joins the same trace. */
        traceparent: Schema.NullOr(Schema.String),
      }),
      description: 'Run client tools in order in the window named by clientId; every other window ignores it.',
    }),
  },
})
