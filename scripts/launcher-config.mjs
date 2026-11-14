import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pathKeys = ['sourceRoot', 'dshHome', 'nodeBinary', 'coreEntry', 'homeVerificationFile', 'browserExecutable']
const environmentKeys = {
  sourceRoot: 'DSHFILES_DIR',
  dshHome: 'DSH_HOME',
  nodeBinary: 'DSHFILES_NODE_BINARY',
  coreEntry: 'DSH_CORE_ENTRY',
  profile: 'DSHFILES_PROFILE',
  legacyPort: 'DSHFILES_LEGACY_PORT',
  homeVerificationFile: 'DSHFILES_HOME_VERIFICATION_FILE',
  browserExecutable: 'DSHX_CHROMIUM_EXECUTABLE',
  path: 'DSHFILES_PATH',
  nodePath: 'DSHFILES_NODE_PATH',
}

export class LauncherConfig {
  // Bootstrap must work before pnpm installs any schema library. Validate the full
  // JSON contract here, not just its representation; no arbitrary shell/env maps.
  /** Where the machine-local launcher JSON lives for this environment. */
  static configPath(env = process.env) {
    return env.DSHFILES_LAUNCHER_CONFIG ?? join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'dshfiles/launcher.json')
  }

  static load(env = process.env) {
    const home = env.HOME || homedir()
    const configPath = LauncherConfig.configPath(env)
    if (!isAbsolute(configPath)) throw new Error('Launcher config path must be absolute')
    let local = {}
    try {
      const text = readFileSync(configPath, 'utf8')
      try {
        local = JSON.parse(text)
      } catch {
        throw new Error('Launcher config must be valid JSON')
      }
    } catch (error) {
      if (error.code !== 'ENOENT' || env.DSHFILES_LAUNCHER_CONFIG) throw error
    }
    // eslint-disable-next-line antislop/no-runtime-typeof -- Dependency-free JSON boundary, followed by full key/value validation.
    if (!local || typeof local !== 'object' || Array.isArray(local)) throw new Error('Launcher config must be an object')
    for (const key of Object.keys(local)) {
      if (!Object.hasOwn(environmentKeys, key)) throw new Error('Unknown launcher config key')
    }
    // Inside a DSH shell, DSH_HOME names the Host that runs the shell, not a choice made for this launch. Refuse rather than
    // let it silently replace the configured home (2026-11-12: a scratch launch from an agent shell prepared the live home).
    if (
      (env.DSH_SESSION_ID || env.DSH_SHELL) &&
      env.DSH_HOME &&
      local.dshHome !== undefined &&
      typeof local.dshHome === 'string' &&
      resolve(env.DSH_HOME) !== resolve(local.dshHome)
    )
      throw new Error(
        `DSH_HOME=${env.DSH_HOME} is inherited from a running DSH shell, but the launcher config selects dshHome ${local.dshHome}. Run from a plain terminal or unset DSH_HOME; nothing started`,
      )
    const config = {
      sourceRoot: resolve(fileURLToPath(new URL('..', import.meta.url))),
      dshHome: join(home, '.dsh'),
      nodeBinary: process.execPath,
      profile: 'web',
      ...local,
    }
    for (const [key, variable] of Object.entries(environmentKeys)) {
      if (env[variable] === undefined) continue
      if (key === 'legacyPort' && !/^\d+$/.test(env[variable])) throw new Error('legacyPort environment override must be an integer')
      config[key] = key === 'legacyPort' ? Number(env[variable]) : env[variable]
    }
    for (const [key, value] of Object.entries(config)) {
      if (key === 'legacyPort') {
        if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('legacyPort must be an integer from 0 through 65535')
        // eslint-disable-next-line antislop/no-runtime-typeof -- JSON string validation is the bootstrap schema, before paths/grammar are accepted.
      } else if (typeof value !== 'string' || !value.trim() || /[\0\r\n]/.test(value)) {
        throw new Error(`Launcher ${key} must be a nonempty single-line string`)
      }
    }
    for (const key of pathKeys) {
      if (config[key] !== undefined && !isAbsolute(config[key])) throw new Error(`Launcher ${key} must be an absolute path`)
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(config.profile)) throw new Error('Launcher profile must be a simple profile name')
    return config
  }

  static environment(config, env = process.env) {
    const result = { ...env }
    for (const key of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_WEB_URL', 'DSH_SHELL', 'DSH_RESTART_REQUEST_PATH', 'DSH_RESTART_RUN_ID'])
      delete result[key]
    // Pin resolved choices for preparation/restarts without changing HOME/XDG.
    for (const [key, variable] of Object.entries(environmentKeys)) {
      if (config[key] !== undefined) result[variable] = String(config[key])
    }
    if (config.path !== undefined) result.PATH = config.path
    if (config.nodePath !== undefined) result.NODE_PATH = config.nodePath
    // Reusing compiled modules across Host starts halves boot (5-6 s to about 2.5 s measured with the web profile).
    if (result.NODE_COMPILE_CACHE === undefined || result.NODE_COMPILE_CACHE === '')
      result.NODE_COMPILE_CACHE = join(result.XDG_CACHE_HOME || join(result.HOME ?? homedir(), '.cache'), 'dshfiles', 'node-compile-cache')
    return result
  }

  /**
   * The core to start: the configured one, else the core this checkout's lockfile installed. Defaulting to the
   * checkout's core keeps it in step with the plugins built from the same checkout; an explicit choice is kept and the
   * startup preflight validates it.
   */
  static requireCoreEntry(config) {
    if (config.coreEntry) return config.coreEntry
    const checkout = join(config.sourceRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(checkout)) return checkout
    throw new Error(
      `No DSH core: configure coreEntry or DSH_CORE_ENTRY, or run pnpm install in ${config.sourceRoot} to install its pinned core; nothing started`,
    )
  }
}
