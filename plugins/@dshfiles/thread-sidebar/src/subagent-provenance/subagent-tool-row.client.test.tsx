// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { SubagentProvenanceToolRow } from './subagent-tool-row.js'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  DisclosureRow: ({ title, collapsedContent }: { title: string; collapsedContent?: ReactNode }) => (
    <div>
      <div>{title}</div>
      {collapsedContent}
    </div>
  ),
  IconAgentPresetOutlineRegular: () => null,
  IconInspectOutlineRegular: () => null,
}))

type Props = Parameters<typeof SubagentProvenanceToolRow>[0]

const unused = (): never => {
  throw new Error('Unused in the tool row fixture')
}

const translate: Props['t'] = key => {
  if (key === 'tool.title.subagent') return 'Create subagent'
  if (key === 'row.inspect') return 'Inspect'
  return key
}

const props = (provider: string, model: string): Props => ({
  phase: 'start',
  // SAFETY: fixture id only needs SessionId's brand; no Host validates it.
  sessionId: 'session-1' as SessionId,
  block: {
    phase: 'start',
    callId: 'call-1',
    name: 'subagent',
    turn: 1,
    step: 1,
    time: 1,
    subCalls: [],
    argsRaw: JSON.stringify({ prompt: 'Review this change', provider, model }),
  },
  callId: 'call-1',
  toolName: 'subagent',
  cwd: '/workspace',
  home: '/home/test',
  openFile: unused,
  loadImage: unused,
  useDisclosure: () => ({ expanded: false, setExpanded: unused, toggle: unused }),
  useToolCallArgumentsPartial: () => '',
  useWorkspaces: unused,
  usePanelInfo: unused,
  useSessions: unused,
  useSessionStatus: unused,
  useSessionRetainInfo: unused,
  useChat: unused,
  useConversation: unused,
  useInput: unused,
  inputActions: {
    captureInsertion: unused,
    insertText: unused,
    setDraft: unused,
    addAttachments: unused,
    removeAttachment: unused,
    pruneAttachments: unused,
    submit: unused,
  },
  useSession: unused,
  useProjection: unused,
  t: translate,
})

afterEach(cleanup)

describe('SubagentProvenanceToolRow', () => {
  it('shows the requested provider/model next to Create subagent', () => {
    render(<SubagentProvenanceToolRow {...props('openai', 'gpt-6.1-luna')} />)
    expect(screen.getByText('Create subagent · openai/gpt-6.1-luna')).not.toBeNull()
  })

  it('omits email-like route values from the visible tool card', () => {
    render(<SubagentProvenanceToolRow {...props('alex@example.com', 'gpt-6.1-luna')} />)
    expect(screen.getByText('Create subagent')).not.toBeNull()
    expect(screen.queryByText(/alex@example\.com/)).toBeNull()
  })
})
