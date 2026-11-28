import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

describe('MCP server status mark', () => {
  it('draws one health dot, or the ink working ring while a server starts, in the same 16 px box', () => {
    const mark = source('server-status-mark.tsx')
    expect(mark).toContain('<HealthDot health={props.mark} />')
    expect(mark).toContain('<StatusGlyph decorative status="working" />')
    expect(mark).toContain('dshx:size-4')
  })
  it('is the mark on the quick panel and the manager page', () => {
    expect(source('mcp-quick-panel.tsx')).toContain('<ServerStatusMark mark={McpServerStatusModel.lifecycleMark(server)}')
    expect(source('manager-view.tsx')).toContain('<ServerStatusMark mark={McpServerStatusModel.lifecycleMark(server)}')
    expect(source('manager-view.tsx')).not.toContain('status={serverStatus(server)}')
  })
})
