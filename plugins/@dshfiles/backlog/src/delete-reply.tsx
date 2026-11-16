import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Trash2Icon } from '@dshfiles/plugin-ui/icons'

const EXCERPT_LENGTH = 80

/** The reply's first words, so the confirmation names what goes. */
export const replyExcerpt = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH - 1).trimEnd()}…`
}

/** Deletes one of your replies after the kit confirmation, which names the reply and says what stays. */
export const DeleteReplyButton = (props: { readonly text: string; readonly onDelete: () => void }): JSX.Element => (
  <AlertDialog>
    <AlertDialogTrigger asChild>
      <Button variant="ghost" size="icon-sm" aria-label="Delete reply" className="dshx:text-muted-foreground dshx:hover:text-destructive">
        <Trash2Icon aria-hidden className="dshx:size-4" />
      </Button>
    </AlertDialogTrigger>
    <AlertDialogContent className="dshx-root">
      <AlertDialogHeader>
        <AlertDialogTitle>Delete this reply?</AlertDialogTitle>
        <AlertDialogDescription>
          “{replyExcerpt(props.text)}” is removed for good, with its attachments. The item and its other replies stay.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction variant="destructive" onClick={props.onDelete}>
          Delete reply
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
