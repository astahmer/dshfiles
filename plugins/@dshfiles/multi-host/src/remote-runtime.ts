import { GatewayUnavailableError } from './connectors/gateway.js'
import { SshConnector, shellQuote } from './connectors/ssh.js'

const statusTimeoutMs = 20_000

export interface RemoteRuntimeStatus {
  readonly running: boolean
  readonly port: number | undefined
  readonly pid: number | undefined
  readonly command: string | undefined
  readonly listening: boolean
  readonly launchFiles: string[]
  readonly logFile: string
  readonly logBytes: number | undefined
}

const runtimeLogPath = ({ remoteHome }: { readonly remoteHome: string }): string => `${remoteHome}/logs/multi-host-web.log`

const pathValue = ({ directories }: { readonly directories: readonly string[] }): string =>
  [...directories.map(directory => shellQuote(directory)), '"$PATH"'].join(':')

/**
 * The launcher a headless remote runtime needs: caffeinate keeps the machine awake, and PATH starts with an official
 * Node build so `dsh` never resolves the Nix one that cannot boot. The port is 0 so the OS picks one and the runtime's
 * own launch file reports it.
 */
const startRuntimeCommand = ({
  remoteHome,
  checkoutPath,
  profile,
  dshPath,
  platform,
  pathDirectories,
}: {
  readonly remoteHome: string
  readonly checkoutPath: string
  readonly profile: string
  readonly dshPath: string
  readonly platform: string | undefined
  readonly pathDirectories: readonly string[]
}): string => {
  const logPath = runtimeLogPath({ remoteHome })
  const keepAwake = platform === 'Darwin' ? 'caffeinate -i ' : ''
  return [
    `mkdir -p ${shellQuote(`${remoteHome}/logs`)}`,
    'umask 077',
    `nohup env PATH=${pathValue({ directories: pathDirectories })} DSHFILES_DIR=${shellQuote(checkoutPath)} ${keepAwake}${shellQuote(dshPath)} --profile ${shellQuote(profile)} --no-open --host 127.0.0.1 --port 0 >> ${shellQuote(logPath)} 2>&1 &`,
    'echo "started_pid=$!"',
  ].join('\n')
}

const statusScript = ({ remoteHome }: { readonly remoteHome: string }): string =>
  [
    `home=${shellQuote(remoteHome)}`,
    'v() { printf \'%s=%s\\n\' "$1" "$2"; }',
    'for file in "$home/plugins/multi-host/launch.json" "$home/runtime/web-url"; do',
    '  [ -f "$file" ] || continue',
    '  v launch_file "$file"',
    '  port=$(grep -oE \'127\\.0\\.0\\.1:[0-9]+\' "$file" 2>/dev/null | head -1 | cut -d: -f2)',
    '  if [ -n "$port" ]; then v launch_port "$port"; fi',
    '  pid=$(grep -oE \'"pid":[0-9]+\' "$file" 2>/dev/null | head -1 | cut -d: -f2)',
    '  if [ -n "$pid" ]; then',
    '    v launch_pid "$pid"',
    '    v launch_command "$(ps -o command= -p "$pid" 2>/dev/null | cut -c1-200)"',
    '  fi',
    '  if [ -n "$port" ]; then v port_listening "$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2 | wc -l | tr -d \' \')"; fi',
    'done',
    `v log_file ${shellQuote(runtimeLogPath({ remoteHome }))}`,
    `v log_bytes "$(wc -c < ${shellQuote(runtimeLogPath({ remoteHome }))} 2>/dev/null || echo 0)"`,
    'exit 0',
  ].join('\n')

const numberOrUndefined = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

const firstOf = (values: ReadonlyMap<string, readonly string[]>, key: string): string | undefined => values.get(key)?.[0]

const parseRuntimeStatus = ({ output, remoteHome }: { readonly output: string; readonly remoteHome: string }): RemoteRuntimeStatus => {
  const values = new Map<string, string[]>()
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    values.set(key, [...(values.get(key) ?? []), line.slice(separator + 1)])
  }
  const command = firstOf(values, 'launch_command')
  const pid = numberOrUndefined(firstOf(values, 'launch_pid'))
  const port = numberOrUndefined(firstOf(values, 'launch_port'))
  return {
    running: pid !== undefined && command !== undefined && command.length > 0,
    port,
    pid,
    command,
    listening: (numberOrUndefined(firstOf(values, 'port_listening')) ?? 0) > 0,
    launchFiles: values.get('launch_file') ?? [],
    logFile: firstOf(values, 'log_file') ?? runtimeLogPath({ remoteHome }),
    logBytes: numberOrUndefined(firstOf(values, 'log_bytes')),
  }
}

/** Refuses a process that is not this machine's DSH web, so a stale pid cannot kill an unrelated program. */
const stopRuntimeCommand = ({ pid }: { readonly pid: number }): string =>
  [
    `pid=${Math.trunc(pid)}`,
    'command=$(ps -o command= -p "$pid" 2>/dev/null)',
    'case "$command" in',
    '  *dsh*web*|*bin.js*web*) ;;',
    '  *) echo "stop=refused"; echo "command=$command"; exit 0 ;;',
    'esac',
    'kill -TERM "$pid" 2>/dev/null || { echo "stop=absent"; exit 0; }',
    'hops=0',
    'while [ "$hops" -lt 20 ]; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; hops=$((hops+1)); done',
    'if kill -0 "$pid" 2>/dev/null; then kill -KILL "$pid" 2>/dev/null; echo "stop=killed"; else echo "stop=terminated"; fi',
    'exit 0',
  ].join('\n')

const logsCommand = ({ logFile, lines }: { readonly logFile: string; readonly lines: number }): string =>
  `tail -n ${Math.min(Math.max(Math.trunc(lines), 1), 400)} -- ${shellQuote(logFile)} 2>/dev/null || true`

/** Bounded wait for the freshly started runtime to publish its launch file. */
const waitForLaunchCommand = ({ remoteHome }: { readonly remoteHome: string }): string => {
  const launchFile = `${remoteHome}/plugins/multi-host/launch.json`
  return [
    `launch=${shellQuote(launchFile)}`,
    'hops=0',
    'while [ "$hops" -lt 30 ]; do [ -f "$launch" ] && { echo "launch=ready"; exit 0; }; sleep 2; hops=$((hops+1)); done',
    'echo "launch=timeout"',
    'exit 0',
  ].join('\n')
}

const readRuntimeStatus = async ({
  sshTarget,
  remoteHome,
  signal,
}: {
  readonly sshTarget: string
  readonly remoteHome: string
  readonly signal?: AbortSignal | undefined
}): Promise<RemoteRuntimeStatus> => {
  const result = await SshConnector.run({ sshTarget, command: statusScript({ remoteHome }), timeoutMs: statusTimeoutMs, signal })
  if (result.timedOut) throw new GatewayUnavailableError('ssh-timeout', 'The runtime status probe exceeded its time limit.')
  if (result.code !== 0) throw new GatewayUnavailableError('ssh-command-failed', result.stderr.trim() || 'The runtime status probe failed.')
  return parseRuntimeStatus({ output: result.stdout, remoteHome })
}

export class RemoteRuntime {
  static readonly logPath = runtimeLogPath
  static readonly startCommand = startRuntimeCommand
  static readonly readStatus = readRuntimeStatus
  static readonly parseStatus = parseRuntimeStatus
  static readonly stopCommand = stopRuntimeCommand
  static readonly logsCommand = logsCommand
  static readonly waitForLaunchCommand = waitForLaunchCommand
}
