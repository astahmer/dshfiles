import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@dshfiles/plugin-ui/components/ui/command'
import { MessagesSquareIcon } from '@dshfiles/plugin-ui/icons'
import type { TransferTarget } from './queue-transfer.js'

/** Thread picker for "Move to thread…"; the target's state decides whether the message lands in its queue or composer. */
export const QueueTransferDialog = (props: {
  readonly open: boolean
  readonly targets: readonly TransferTarget[]
  readonly onChoose: (target: TransferTarget) => void
  readonly onCancel: () => void
}): JSX.Element => (
  <CommandDialog
    open={props.open}
    onOpenChange={open => {
      if (!open) props.onCancel()
    }}
    heading="Move to thread"
    description="Pick the thread this queued message moves to. A busy thread queues it; an idle one gets it in its composer."
    className="dshx-root"
  >
    <CommandInput placeholder="Search threads" aria-label="Search threads" />
    <CommandList>
      <CommandEmpty>No other thread to move it to.</CommandEmpty>
      <CommandGroup heading="Threads">
        {props.targets.map(target => (
          <CommandItem key={target.id} value={`${target.title} ${target.id}`} onSelect={() => props.onChoose(target)}>
            <MessagesSquareIcon aria-hidden />
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{target.title}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </CommandList>
  </CommandDialog>
)
