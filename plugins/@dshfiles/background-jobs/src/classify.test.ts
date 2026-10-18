import { describe, expect, it } from 'vitest'
import { classifyJob, jobCategoryValues } from './classify.js'

const categoryOf = (label: string): string => classifyJob({ kind: 'bash', label })

describe('job classification', () => {
  it('reads the package manager script that did the work, not the wrapper around it', () => {
    expect(categoryOf('cd /Users/astahmer/dev/dshfiles && pnpm check:e2e jj-integration 2>&1 | tail -60')).toBe('tests')
    expect(categoryOf('fnm exec --using=22.23.3 pnpm run lint > /tmp/dshx-lint.log 2>&1')).toBe('lint-format')
    expect(categoryOf('export PATH="$HOME/.nix-profile/bin:$PATH"; cd /x && pnpm --filter @dshfiles/dshx build')).toBe('build')
    expect(categoryOf('cd /x && fnm exec --using=22.23.3 pnpm --dir tooling/dshx typecheck')).toBe('typecheck')
    expect(categoryOf('cd /x && fnm exec --using=22.23.3 pnpm install --frozen-lockfile')).toBe('install-deps')
  })

  it('reads the command after cd, export and banner echo segments', () => {
    expect(categoryOf('cd /Users/astahmer/dev/dshfiles && jj workspace list; echo "---"; ls /x')).toBe('vcs')
    expect(categoryOf('cd /x && echo "=== plugin bundle ===" && grep -rn "import" src/ | head -20')).toBe('inspect')
    expect(categoryOf('cd /x && node scripts/jj-state.mjs --read-only 2>&1 | head -40')).toBe('scripts')
    expect(categoryOf('cd /tmp && rm -f cj.txt && curl -s -L "http://127.0.0.1:3080/?token=x"')).toBe('files')
  })

  it('classifies process, network and DSH work', () => {
    expect(categoryOf('ps -Ao pid,ppid,lstart,etime,command | grep -E "dsh web"')).toBe('process')
    expect(categoryOf('lsof -nP -iTCP:3080 -sTCP:LISTEN | tail -2')).toBe('process')
    expect(categoryOf('dshx status --json')).toBe('dsh')
    expect(categoryOf('cd /x && fnm exec --using=22.23.3 dsh --profile web --dump-config')).toBe('dsh')
  })

  it('names the producer kind for jobs that are not shell commands', () => {
    expect(classifyJob({ kind: 'workflow', label: 'audit every plugin' })).toBe('workflow')
    expect(classifyJob({ kind: 'pty-send', label: 'npm test' })).toBe('terminal')
    expect(classifyJob({ kind: 'pwsh', label: 'pnpm test' })).toBe('tests')
  })

  it('falls back to other instead of guessing', () => {
    expect(categoryOf('qzx --nowhere')).toBe('other')
    expect(categoryOf('')).toBe('other')
  })

  it('answers with a declared category for every label', () => {
    const cases = ['jj log', 'pnpm test', 'curl http://localhost:3080', 'node -e "1"', 'weird-thing']
    for (const label of cases) expect(jobCategoryValues).toContain(categoryOf(label))
  })
})
