import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import type { ThreadRevisionView } from './api.js'
import type { JjIntegrationTranslate } from './locales.js'

/**
 * The confirmation every Land of the thread header goes through: the exact revisions that move, then one confirm.
 * The header verb and the workspace menu's button open this same dialog, so landing from the header is never one click.
 */
export const LandConfirmDialog = (props: {
  readonly t: JjIntegrationTranslate
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly bookmark: string
  readonly revisions: readonly ThreadRevisionView[]
  readonly onConfirm: () => void
}): JSX.Element => (
  <AlertDialog onOpenChange={props.onOpenChange} open={props.open}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {props.revisions.length === 1
            ? props.t('landConfirmTitleOne', { bookmark: props.bookmark })
            : props.t('landConfirmTitleMany', { count: props.revisions.length, bookmark: props.bookmark })}
        </AlertDialogTitle>
        <AlertDialogDescription>{props.t('landConfirmDescription', { bookmark: props.bookmark })}</AlertDialogDescription>
      </AlertDialogHeader>
      <ul className="dshx:flex dshx:max-h-48 dshx:flex-col dshx:gap-1 dshx:overflow-y-auto dshx:text-xs" data-testid="workspace-land-preview">
        {props.revisions.map(revision => (
          <li className="dshx:flex dshx:min-w-0 dshx:items-start dshx:gap-2" key={revision.commitId}>
            <span className="dshx:shrink-0 dshx:font-mono dshx:text-muted-foreground">{revision.changeId.slice(0, 8)}</span>
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{revision.description.split('\n')[0] || props.t('landConfirmNoDescription')}</span>
            {revision.conflict ? <Badge variant="destructive">{props.t('conflict')}</Badge> : null}
          </li>
        ))}
      </ul>
      <AlertDialogFooter>
        <AlertDialogCancel>{props.t('cancel')}</AlertDialogCancel>
        <AlertDialogAction onClick={props.onConfirm}>{props.t('rebaseOnto', { bookmark: props.bookmark })}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
)
