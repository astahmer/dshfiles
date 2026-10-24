import type { BreakdownInput } from './boards-api.js'

export type BoardColumn = 'count' | 'errorRate' | 'p50' | 'p95' | 'p99' | 'measure'

export type BuiltinBoard = {
  readonly id: string
  readonly query: Omit<BreakdownInput, 'windowMinutes'>
  readonly columns: readonly BoardColumn[]
}

/**
 * A small fixed set of breakdowns over the attributes our own producers emit (agent-telemetry, dshx API dispatch, jj):
 * the questions asked of the traces most often, one click away. Not a dashboard builder: saved views cover the rest.
 */
export const SLOW_TOOLS_BOARD: BuiltinBoard = {
  id: 'slow-tools',
  query: {
    filter: { service: null, operation: 'execute_tool *', attribute: null },
    groupBy: { kind: 'attribute', key: 'gen_ai.tool.name' },
    sortBy: 'p95',
  },
  columns: ['count', 'errorRate', 'p50', 'p95', 'p99'],
}

export const BUILTIN_BOARDS: readonly BuiltinBoard[] = [
  SLOW_TOOLS_BOARD,
  {
    id: 'failing-plugins',
    query: {
      filter: { service: null, operation: null, attribute: { key: 'rpc.system', value: 'dshx' } },
      groupBy: { kind: 'attribute', key: 'dshx.plugin.package' },
      sortBy: 'errorRate',
    },
    columns: ['count', 'errorRate', 'p50', 'p95'],
  },
  {
    id: 'model-latency',
    query: {
      filter: { service: null, operation: 'chat *', attribute: null },
      groupBy: { kind: 'attribute', key: 'gen_ai.provider.name' },
      measure: { key: 'gen_ai.response.time_to_first_token', divisor: 1e6 },
      sortBy: 'p95',
    },
    columns: ['count', 'errorRate', 'measure', 'p50', 'p95'],
  },
  {
    id: 'jobs',
    query: {
      filter: { service: null, operation: 'job *', attribute: null },
      groupBy: { kind: 'attribute', key: 'dsh.job.kind' },
      sortBy: 'count',
    },
    columns: ['count', 'errorRate', 'p50', 'p95', 'p99'],
  },
  {
    id: 'jj-commands',
    query: {
      filter: { service: null, operation: 'jj *', attribute: null },
      groupBy: { kind: 'operation' },
      sortBy: 'p95',
    },
    columns: ['count', 'errorRate', 'p50', 'p95', 'p99'],
  },
]
