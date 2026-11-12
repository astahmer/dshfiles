import { memo, useCallback, useMemo } from 'react'
import type { InjectFace, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNodeViewProps, PresentationInjected, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'
import { MarkdownProse } from '../../markdown-prose.tsx'
import { isToolAcknowledgement } from './filler-reply.ts'

type AssistantNodeViewProps = ChatNodeViewProps<'assistant-step'> & InjectFace<PresentationInjected>
  & PropsRenderSlots<'conversation.chat.reasoning.body' | 'conversation.chat.message.images'>

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, groupPart, useDisclosure, useGroupAction, useTurnData, turnProcess, openFile, loadImage, fileMentions,
  usePresentation, renderSlot, t,
}: AssistantNodeViewProps) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  // dshfiles (productivity pass T1.3): a mention written with a line (`name.ts:24`, `name.ts#L24`) resolves through
  // its path and opens at that line, so it becomes a file chip like the bare path does.
  const mentions = useMemo(() => {
    const native = owner === undefined ? undefined : fileMentions(owner)
    if (native === undefined) return undefined
    return {
      resolve: (value: string) => {
        const direct = native.resolve(value)
        if (direct !== undefined) return direct
        const { path, line } = MarkdownProse.parseFileReference(value)
        if (line === undefined || path === value) return undefined
        const target = native.resolve(path)
        return target === undefined ? undefined : { ...target, open: () => { openFile(path, { line: Number(line) }) } }
      },
    }
  }, [fileMentions, openFile, owner])
  const reasoningHidden = turnProcess !== undefined
    && turnProcess.foldable
    && turnProcess.spec.answerStep === data.step
    && turnProcess.spec.inlineReasoning
    && !turnProcess.open
  const revealProcess = useCallback(() => { turnProcess?.setOpen(true) }, [turnProcess])
  // dshfiles (productivity pass T1.5): a settled reply that only acknowledges its tools ("Tool finished.") adds nothing
  // under the turn's "Worked for" row, so it reads as a muted meta line instead of an answer. It stays in the DOM:
  // the scratch seeds and journeys wait for that text to know a tool turn ended.
  const filler = turnProcess !== undefined && data.status === 'settled' && isToolAcknowledgement(data.blocks)
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      reasoningTimings={data.reasoningTimings ?? []}
      groupPart={groupPart}
      useDisclosure={useDisclosure}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      loadImage={loadImage}
      reasoningHidden={reasoningHidden}
      useGroupAction={useGroupAction}
      usePresentation={usePresentation}
      renderSlot={renderSlot}
      revealProcess={revealProcess}
      mentions={mentions}
      filler={filler}
      t={t}
    />
  )
})
