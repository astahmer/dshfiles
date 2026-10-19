import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { defineLocale } from '@dshfiles/dshx/client'

export const WORKTREE_MEMORY_LOCALE_NAMESPACE = 'dshfiles.worktreeMemory'

const en = {
  title: 'RAM',
  subtitle: 'What the threads started, by workspace: background jobs, dev servers, and trees that kept running after their parent exited.',
  loading: 'Reading the process table…',
  loadFailed: 'The process table could not be read.',
  unsupported: 'Process memory is only read on macOS and Linux.',
  refresh: 'Refresh',
  pressureNormal: 'Normal',
  pressureWarning: 'Pressure',
  pressureCritical: 'Critical',
  pressureUnknown: 'Unknown',
  ofRam: 'of RAM',
  thisHost: 'This DSH',
  categoryDevServer: 'Dev servers',
  categoryTests: 'Tests',
  categoryBuild: 'Build & check',
  categoryDsh: 'DSH',
  categoryServices: 'Services',
  categoryOther: 'Other',
  originJob: 'Job',
  originHost: 'Child',
  originDetached: 'Detached',
  originDetachedHint: 'Its parent exited and init adopted it. A daemon started on purpose looks the same, so check before stopping.',
  elsewhere: 'Outside any workspace',
  thread: 'thread',
  threads: 'threads',
  running: 'running',
  idle: 'idle',
  process: 'process',
  processes: 'processes',
  showSmaller: 'smaller workspaces',
  showLess: 'Show fewer',
  noProcesses: 'No thread started a process that is still running.',
  openThread: 'Open thread',
  stop: 'Stop',
  stopConfirm: 'Confirm stop',
  stopDetached: 'Stop detached',
  stopFailed: 'The process could not be stopped.',
  detachedTotal: 'detached',
  stopSummary: 'Stopped',
  stopRefused: 'refused',
  stopMissing: 'already gone',
  justNow: 'just now',
} as const

const zh = {
  title: '进程内存',
  subtitle: '各线程启动的进程，按工作区分组：后台任务、开发服务器，以及父进程退出后仍在运行的进程树。',
  loading: '正在读取进程表…',
  loadFailed: '无法读取进程表。',
  unsupported: '仅在 macOS 和 Linux 上读取进程内存。',
  refresh: '刷新',
  pressureNormal: '正常',
  pressureWarning: '有压力',
  pressureCritical: '严重',
  pressureUnknown: '未知',
  ofRam: '内存总量',
  thisHost: '当前 DSH',
  categoryDevServer: '开发服务器',
  categoryTests: '测试',
  categoryBuild: '构建与检查',
  categoryDsh: 'DSH',
  categoryServices: '服务',
  categoryOther: '其他',
  originJob: '任务',
  originHost: '子进程',
  originDetached: '已脱离',
  originDetachedHint: '其父进程已退出并由 init 接管。有意启动的守护进程看起来相同，停止前请确认。',
  elsewhere: '不在任何工作区内',
  thread: '个线程',
  threads: '个线程',
  running: '运行中',
  idle: '空闲',
  process: '个进程',
  processes: '个进程',
  showSmaller: '个较小的工作区',
  showLess: '收起',
  noProcesses: '没有线程启动的进程仍在运行。',
  openThread: '打开线程',
  stop: '停止',
  stopConfirm: '确认停止',
  stopDetached: '停止已脱离进程',
  stopFailed: '无法停止该进程。',
  detachedTotal: '已脱离',
  stopSummary: '已停止',
  stopRefused: '被拒绝',
  stopMissing: '已不存在',
  justNow: '刚刚',
} satisfies Record<keyof typeof en, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'dshfiles.worktreeMemory': keyof typeof en
  }
}

export type WorktreeMemoryKey = keyof typeof en

export type WorktreeMemoryTranslate = TranslateNS<typeof WORKTREE_MEMORY_LOCALE_NAMESPACE>

export const worktreeMemoryLocale = defineLocale(WORKTREE_MEMORY_LOCALE_NAMESPACE, { en, zh })
