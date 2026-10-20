import { z } from 'zod'
import { GatewayUnavailableError } from './connectors/gateway.js'
import { SshConnector, shellQuote } from './connectors/ssh.js'

const probeTimeoutMs = 25_000

const fnmNodeSchema = z.object({ version: z.string(), path: z.string() })

export interface RemoteDiagnostic {
  readonly code: string
  readonly severity: 'error' | 'warning' | 'info'
  readonly message: string
}

export interface RemoteFacts {
  readonly uname: string
  readonly osVersion: string | undefined
  readonly user: string | undefined
  readonly home: string | undefined
  readonly node: { readonly path: string | undefined; readonly version: string | undefined; readonly resolved: string | undefined; readonly nix: boolean }
  readonly fnm: { readonly path: string | undefined; readonly nodes: z.infer<typeof fnmNodeSchema>[] }
  readonly dsh: { readonly path: string | undefined; readonly version: string | undefined }
  readonly jj: { readonly path: string | undefined; readonly version: string | undefined }
  readonly pnpm: { readonly path: string | undefined; readonly version: string | undefined }
  readonly launch: { readonly files: string[]; readonly port: number | undefined; readonly pid: number | undefined }
  readonly profile: { readonly path: string; readonly exists: boolean; readonly pluginLinks: number; readonly coreVersion: string | undefined }
  readonly checkout: {
    readonly path: string
    readonly exists: boolean
    readonly installed: boolean
    readonly built: boolean
    readonly changeId: string | undefined
    readonly commitId: string | undefined
    readonly description: string | undefined
    readonly conflicts: number
    readonly mainOrigin: string | undefined
  }
}

const probeScript = ({ profile, checkoutPath }: { readonly profile: string; readonly checkoutPath: string | undefined }): string =>
  [
    `profile=${shellQuote(profile)}`,
    `checkout=${shellQuote(checkoutPath ?? '')}`,
    'if [ -z "$checkout" ]; then checkout="$HOME/dev/dshfiles"; fi',
    'v checkout_path "$checkout"',
    'profile_dir="$HOME/.dsh/profiles/$profile"',
    'v() { printf \'%s=%s\\n\' "$1" "$2"; }',
    'v uname "$(uname -srm 2>/dev/null)"',
    'v os "$(sw_vers -productVersion 2>/dev/null)"',
    'v user "$(id -un 2>/dev/null)"',
    'v home "$HOME"',
    'v node_path "$(command -v node 2>/dev/null)"',
    'v fnm_path "$(command -v fnm 2>/dev/null)"',
    'v fnm_brew "$(for candidate in /opt/homebrew/bin/fnm /usr/local/bin/fnm; do [ -x "$candidate" ] && { echo "$candidate"; break; }; done)"',
    'v dsh_path "$(command -v dsh 2>/dev/null)"',
    'v jj_path "$(command -v jj 2>/dev/null)"',
    'v pnpm_path "$(command -v pnpm 2>/dev/null)"',
    'p=$(command -v node 2>/dev/null)',
    'hops=0',
    'while [ -n "$p" ] && [ -L "$p" ] && [ "$hops" -lt 20 ]; do t=$(readlink "$p" 2>/dev/null); case "$t" in /*) p=$t ;; *) p="$(dirname "$p")/$t" ;; esac; hops=$((hops+1)); done',
    'v node_real "$p"',
    'v node_version "$(node -v 2>/dev/null)"',
    'v dsh_version "$(dsh --version 2>/dev/null | head -1)"',
    'v jj_version "$(jj --version 2>/dev/null)"',
    'v pnpm_version "$(pnpm -v 2>/dev/null)"',
    'for dir in "$HOME/Library/Application Support/fnm/node-versions" "$HOME/.local/share/fnm/node-versions"; do',
    '  [ -d "$dir" ] || continue',
    '  for version_dir in "$dir"/*; do',
    '    [ -x "$version_dir/installation/bin/node" ] && printf \'fnm_node=%s|%s\\n\' "$(basename "$version_dir")" "$version_dir/installation/bin/node"',
    '  done',
    'done',
    'for file in "$HOME/.dsh/plugins/multi-host/launch.json" "$HOME/.dsh/runtime/web-url"; do',
    '  [ -f "$file" ] || continue',
    '  v launch_file "$file"',
    '  v launch_port "$(grep -oE \'127\\.0\\.0\\.1:[0-9]+\' "$file" 2>/dev/null | head -1 | cut -d: -f2)"',
    '  v launch_pid "$(grep -oE \'"pid":[0-9]+\' "$file" 2>/dev/null | head -1 | cut -d: -f2)"',
    'done',
    '[ -d "$profile_dir" ] && v profile_exists 1',
    'v profile_plugin_links "$(ls "$profile_dir/node_modules/@dshfiles" 2>/dev/null | wc -l | tr -d \' \')"',
    'v profile_core_version "$(sed -n \'s/.*"version": "\\([^"]*\\)".*/\\1/p\' "$profile_dir/node_modules/@deepseek-ai/dsh-session/package.json" 2>/dev/null | head -1)"',
    'if [ -d "$checkout/.jj" ] || [ -d "$checkout/.git" ]; then',
    '  v checkout_exists 1',
    '  if [ -d "$checkout/node_modules/.pnpm" ]; then v checkout_installed 1; fi',
    '  if [ -f "$checkout/tooling/dshx/packages/dshx/dist/cli/bin.js" ]; then v checkout_built 1; fi',
    `  v checkout_head "$(jj -R "$checkout" --ignore-working-copy log -r @ --no-graph -T 'change_id.short() ++ "|" ++ commit_id.short() ++ "|" ++ description.first_line()' 2>/dev/null | head -1)"`,
    `  v checkout_conflicts "$(jj -R "$checkout" --ignore-working-copy log -r 'conflicts()' --no-graph -T 'commit_id ++ "\\n"' 2>/dev/null | wc -l | tr -d ' ')"`,
    `  v checkout_main_origin "$(jj -R "$checkout" --ignore-working-copy log -r 'main@origin' --no-graph -T 'commit_id.short()' 2>/dev/null | head -1)"`,
    'fi',
    'v disk_available "$(df -h "$HOME" 2>/dev/null | tail -1 | tr -s " " | cut -d " " -f4)"',
    'v disk_used "$(df -h "$HOME" 2>/dev/null | tail -1 | tr -s " " | cut -d " " -f5)"',
    'exit 0',
  ].join('\n')

const valueOf = (values: ReadonlyMap<string, readonly string[]>, key: string): string | undefined => {
  const found = values.get(key)
  return found?.[0]
}

const numberOrUndefined = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/** Remote facts, decoded from the probe's `key=value` lines; the shell never decides what a fact means. */
const parseRemoteFacts = ({
  output,
  profile,
  checkoutPath,
}: {
  readonly output: string
  readonly profile: string
  readonly checkoutPath: string | undefined
}): RemoteFacts => {
  const values = new Map<string, string[]>()
  const fnmNodes: z.infer<typeof fnmNodeSchema>[] = []
  for (const line of output.split('\n')) {
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator)
    const value = line.slice(separator + 1)
    if (key === 'fnm_node') {
      const [version, path] = value.split('|')
      if (version !== undefined && path !== undefined) fnmNodes.push(fnmNodeSchema.parse({ version, path }))
      continue
    }
    const current = values.get(key) ?? []
    values.set(key, [...current, value])
  }
  const head = valueOf(values, 'checkout_head')?.split('|')
  const resolvedPath = valueOf(values, 'checkout_path') ?? checkoutPath ?? ''
  const resolved = valueOf(values, 'node_real')
  return {
    uname: valueOf(values, 'uname') ?? '',
    osVersion: valueOf(values, 'os'),
    user: valueOf(values, 'user'),
    home: valueOf(values, 'home'),
    node: {
      path: valueOf(values, 'node_path') || undefined,
      version: valueOf(values, 'node_version') || undefined,
      resolved: resolved === undefined || resolved === '' ? undefined : resolved,
      nix: resolved !== undefined && resolved.startsWith('/nix/store/'),
    },
    fnm: { path: valueOf(values, 'fnm_path') || valueOf(values, 'fnm_brew') || undefined, nodes: fnmNodes },
    dsh: { path: valueOf(values, 'dsh_path') || undefined, version: valueOf(values, 'dsh_version') || undefined },
    jj: { path: valueOf(values, 'jj_path') || undefined, version: valueOf(values, 'jj_version') || undefined },
    pnpm: { path: valueOf(values, 'pnpm_path') || undefined, version: valueOf(values, 'pnpm_version') || undefined },
    launch: {
      files: values.get('launch_file') ?? [],
      port: numberOrUndefined(valueOf(values, 'launch_port')),
      pid: numberOrUndefined(valueOf(values, 'launch_pid')),
    },
    profile: {
      path: `~/.dsh/profiles/${profile}`,
      exists: valueOf(values, 'profile_exists') === '1',
      pluginLinks: numberOrUndefined(valueOf(values, 'profile_plugin_links')) ?? 0,
      coreVersion: valueOf(values, 'profile_core_version') || undefined,
    },
    checkout: {
      path: resolvedPath,
      exists: valueOf(values, 'checkout_exists') === '1',
      installed: valueOf(values, 'checkout_installed') === '1',
      built: valueOf(values, 'checkout_built') === '1',
      changeId: head?.[0],
      commitId: head?.[1],
      description: head?.[2],
      conflicts: numberOrUndefined(valueOf(values, 'checkout_conflicts')) ?? 0,
      mainOrigin: valueOf(values, 'checkout_main_origin') || undefined,
    },
  }
}

const versionParts = (value: string | undefined): readonly number[] =>
  (value ?? '')
    .replace(/^v/u, '')
    .split(/[.-]/u)
    .map(part => Number(part))
    .filter(part => Number.isFinite(part))

const isAtLeast = ({ version, minimum }: { readonly version: string | undefined; readonly minimum: string }): boolean => {
  const current = versionParts(version)
  const wanted = versionParts(minimum)
  const length = Math.max(current.length, wanted.length)
  for (let index = 0; index < length; index += 1) {
    const left = current[index] ?? 0
    const right = wanted[index] ?? 0
    if (left !== right) return left > right
  }
  return true
}

/** The highest fnm-managed official Node at or above `minimum`, or undefined when that machine has none. */
const officialNodePath = ({ nodes, minimum }: { readonly nodes: RemoteFacts['fnm']['nodes']; readonly minimum: string }): string | undefined =>
  [...nodes]
    .filter(node => isAtLeast({ version: node.version, minimum }))
    .sort((left, right) => (isAtLeast({ version: left.version, minimum: right.version }) ? -1 : 1))[0]?.path

/**
 * What a machine can and cannot do for DSH, as facts plus the diagnostics worth acting on. Order matters: the first
 * error is the one that stops everything else.
 */
const diagnoseRemote = ({
  facts,
  expected,
}: {
  readonly facts: RemoteFacts
  readonly expected: { readonly profile: string; readonly dshVersion?: string | undefined }
}): RemoteDiagnostic[] => {
  const diagnostics: RemoteDiagnostic[] = []
  if (facts.node.path === undefined) {
    diagnostics.push({ code: 'node-missing', severity: 'error', message: 'No node on the remote PATH; DSH cannot start.' })
  } else if (facts.node.nix) {
    diagnostics.push({
      code: 'node-is-nix',
      severity: 'error',
      message: `The remote node is a Nix build (${facts.node.resolved ?? 'unknown path'}), which DSH cannot boot; start it with an official Node build instead.`,
    })
  }
  const official = officialNodePath({ nodes: facts.fnm.nodes, minimum: '22.19.0' })
  if (official === undefined && facts.fnm.path === undefined) {
    diagnostics.push({
      code: 'fnm-missing',
      severity: 'warning',
      message: 'No fnm on the remote PATH, so no official Node can be installed or selected there; this machine needs a setup change.',
    })
  }
  if (official !== undefined && (facts.node.nix || facts.node.path === undefined)) {
    diagnostics.push({ code: 'official-node-available', severity: 'info', message: `An official Node build is available at ${official}.` })
  }
  if (facts.dsh.path === undefined) {
    diagnostics.push({ code: 'dsh-missing', severity: 'error', message: 'No dsh on the remote PATH; provision the CLI first.' })
  } else if (facts.dsh.version !== undefined && expected.dshVersion !== undefined && facts.dsh.version !== expected.dshVersion) {
    diagnostics.push({
      code: 'dsh-version-mismatch',
      severity: 'warning',
      message: `The remote DSH is ${facts.dsh.version}, this DSH is ${expected.dshVersion}; a remote thread then runs another version.`,
    })
  }
  if (facts.launch.files.length === 0) {
    diagnostics.push({ code: 'runtime-not-running', severity: 'warning', message: 'No launch file: no DSH runtime is running there, so no thread can start.' })
  }
  if (!facts.profile.exists) {
    diagnostics.push({
      code: 'profile-missing',
      severity: 'warning',
      message: `The remote profile ${expected.profile} does not exist; sync it before starting a runtime.`,
    })
  } else if (facts.dsh.version !== undefined && facts.profile.coreVersion !== undefined && facts.profile.coreVersion !== facts.dsh.version) {
    diagnostics.push({
      code: 'profile-core-stale',
      severity: 'error',
      message: `The remote profile pins core ${facts.profile.coreVersion} against dsh ${facts.dsh.version}; recreate the profile or its boot fails.`,
    })
  }
  if (!facts.checkout.exists) {
    diagnostics.push({
      code: 'checkout-missing',
      severity: 'warning',
      message: `No checkout at ${facts.checkout.path}; clone it before installing the profile.`,
    })
  } else {
    if (facts.checkout.conflicts > 0) {
      diagnostics.push({ code: 'checkout-conflicts', severity: 'warning', message: `The checkout has ${facts.checkout.conflicts} conflicted revision(s).` })
    }
    if (facts.checkout.mainOrigin !== undefined && facts.checkout.commitId !== undefined && facts.checkout.commitId !== facts.checkout.mainOrigin) {
      diagnostics.push({
        code: 'checkout-behind',
        severity: 'info',
        message: `The checkout is at ${facts.checkout.commitId}, main@origin is ${facts.checkout.mainOrigin}.`,
      })
    }
  }
  return diagnostics
}

const readRemoteFacts = async ({
  sshTarget,
  profile,
  checkoutPath,
  signal,
}: {
  readonly sshTarget: string
  readonly profile: string
  readonly checkoutPath?: string | undefined
  readonly signal?: AbortSignal | undefined
}): Promise<RemoteFacts> => {
  const result = await SshConnector.run({ sshTarget, command: probeScript({ profile, checkoutPath }), timeoutMs: probeTimeoutMs, signal })
  if (result.timedOut) throw new GatewayUnavailableError('ssh-timeout', 'The remote probe exceeded its time limit.')
  if (result.code !== 0) {
    throw new GatewayUnavailableError('ssh-command-failed', result.stderr.trim() || 'The remote probe failed.')
  }
  return parseRemoteFacts({ output: result.stdout, profile, checkoutPath })
}

export class RemoteDoctor {
  static readonly readFacts = readRemoteFacts
  static readonly parseFacts = parseRemoteFacts
  static readonly diagnose = diagnoseRemote
  static readonly officialNodePath = officialNodePath
}
