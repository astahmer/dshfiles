import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { TableCell, TableRow } from '@dshfiles/plugin-ui/components/ui/table'
import { CopyIcon, EllipsisIcon, KeyRoundIcon, PencilLineIcon, SparklesIcon, Trash2Icon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useMutation } from '@dshfiles/plugin-ui/query'
import { useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { SecretCatalogTranslate } from './locales.js'
import { secretColumnClassName } from './secret-catalog-table.js'
import type { SecretMetadata } from './secret-metadata.js'
import { quickAddIssue, toEnvVarName, type QuickAddIssue, type SecretCreateForm, type SecretMutationScope } from './secret-mutation-form.js'

interface SecretQuickAddRowProps {
  readonly scope: SecretMutationScope
  readonly environment: string
  readonly hasProjectFolder: boolean
  readonly rows: readonly SecretMetadata[]
  readonly create: (input: SecretCreateForm) => Promise<void>
  /** Resolves once the catalog shows the saved alias, so the draft never blinks out before its row appears. */
  readonly onSaved: (alias: string) => Promise<void>
  readonly onDiscard: () => void
  readonly t: SecretCatalogTranslate
}

const issueMessageKeys = {
  'name-required': 'quickAddNameRequired',
  'name-invalid': 'aliasHint',
  duplicate: 'aliasExists',
  'needs-folder': 'needsProjectFolder',
  'value-required': 'quickAddValueRequired',
} satisfies Record<QuickAddIssue, Parameters<SecretCatalogTranslate>[0]>

const cellClassName = 'dshx:px-4 dshx:py-2 dshx:align-top'

/**
 * One editable row appended under the catalog. It owns its draft and its create request; Enter, or focus leaving
 * the row, saves it. The value stays in this row's state until the Host accepts it, then the row unmounts.
 */
export const SecretQuickAddRow = (props: SecretQuickAddRowProps): JSX.Element => {
  const t = props.t
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [valueMode, setValueMode] = useState<'manual' | 'generate'>('manual')
  const [attempted, setAttempted] = useState(false)
  const menuOpen = useRef(false)
  const nameIssueId = useId()
  const issue = quickAddIssue({
    name,
    value,
    valueMode,
    environment: props.environment,
    scope: props.scope,
    hasProjectFolder: props.hasProjectFolder,
    rows: props.rows,
  })
  const saveMutation = useMutation({
    mutationFn: (input: SecretCreateForm) => props.create(input),
    onSuccess: (_result, input) => props.onSaved(input.alias),
  })
  const pending = saveMutation.isPending

  const save = (): void => {
    if (pending) return
    setAttempted(true)
    if (issue !== null) return
    saveMutation.mutate({
      alias: name,
      scope: props.scope,
      environment: props.environment,
      valueMode,
      value: valueMode === 'manual' ? value : null,
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
    if (event.key === 'Escape' && name.length === 0 && value.length === 0) props.onDiscard()
  }

  const onRowBlur = (event: FocusEvent<HTMLTableRowElement>): void => {
    const next = event.relatedTarget
    if (menuOpen.current || (next instanceof Node && event.currentTarget.contains(next))) return
    if (next instanceof Element && next.closest('[data-slot="dropdown-menu-content"]') !== null) return
    if (name.length === 0 && value.length === 0) return
    save()
  }

  const visibleIssue = attempted || name.length > 0 ? issue : null
  const nameIssue = visibleIssue === 'value-required' ? null : visibleIssue
  const message = (shown: QuickAddIssue): string => t(issueMessageKeys[shown], { alias: name, environment: props.environment })
  const scopeLabel = props.scope === 'project' ? t('targetProject') : props.scope === 'global' ? t('targetGlobal') : t('targetLocal')

  return (
    <TableRow aria-busy={pending} aria-label={t('quickAddRow')} className="dshx:bg-muted/30 dshx:hover:bg-muted/30" onBlur={onRowBlur}>
      <TableCell className={cn(cellClassName, secretColumnClassName('name'))}>
        <Input
          aria-describedby={nameIssue === null ? undefined : nameIssueId}
          aria-invalid={nameIssue !== null || undefined}
          aria-label={t('quickAddName')}
          autoComplete="off"
          autoFocus
          className="dshx:h-8 dshx:font-mono! dshx:text-[13px] dshx:font-semibold"
          disabled={pending}
          onChange={event => setName(toEnvVarName(event.currentTarget.value))}
          onKeyDown={onKeyDown}
          placeholder={t('quickAddNamePlaceholder')}
          spellCheck={false}
          value={name}
        />
        {nameIssue !== null && (
          <p className="dshx:mt-1 dshx:text-xs dshx:text-destructive" id={nameIssueId}>
            {message(nameIssue)}
          </p>
        )}
        {saveMutation.isError && (
          <p className="dshx:mt-1 dshx:text-xs dshx:text-destructive" role="alert">
            {t('quickAddFailed', { alias: name })}
          </p>
        )}
      </TableCell>
      <TableCell className={cn(cellClassName, 'dshx:pt-3.5 dshx:text-xs dshx:text-muted-foreground', secretColumnClassName('description'))}>
        <span className="dshx:truncate">{t('quickAddTarget', { scope: scopeLabel, environment: props.environment })}</span>
      </TableCell>
      <TableCell className={cn(cellClassName, secretColumnClassName('value'))}>
        {valueMode === 'generate' ? (
          <span className="dshx:inline-flex dshx:h-8 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
            <KeyRoundIcon aria-hidden className="dshx:size-3.5" />
            {t('quickAddGenerated')}
          </span>
        ) : (
          <Input
            aria-invalid={(attempted && issue === 'value-required') || undefined}
            aria-label={t('quickAddValue')}
            autoComplete="new-password"
            className="dshx:h-8 dshx:font-mono! dshx:text-xs"
            disabled={pending}
            onChange={event => setValue(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            placeholder={t('quickAddValuePlaceholder')}
            spellCheck={false}
            type="password"
            value={value}
          />
        )}
        {attempted && issue === 'value-required' && <p className="dshx:mt-1 dshx:text-xs dshx:text-destructive">{message(issue)}</p>}
      </TableCell>
      <TableCell className={cn(cellClassName, secretColumnClassName('actions'))}>
        <div className="dshx:flex dshx:h-8 dshx:items-center dshx:justify-end">
          {pending ? (
            <Spinner aria-label={t('adding')} />
          ) : (
            <DropdownMenu
              onOpenChange={open => {
                menuOpen.current = open
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t('quickAddActions', { alias: name || t('quickAddUnnamed') })}
                  className="dshx:text-muted-foreground"
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <EllipsisIcon aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="dshx-root">
                {valueMode === 'manual' ? (
                  <DropdownMenuItem
                    onSelect={() => {
                      setValue('')
                      setValueMode('generate')
                    }}
                  >
                    <SparklesIcon aria-hidden />
                    {t('quickAddGenerate')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => setValueMode('manual')}>
                    <PencilLineIcon aria-hidden />
                    {t('quickAddEnterValue')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={valueMode === 'generate' || value.length === 0} onSelect={() => void writeClipboard(value)}>
                  <CopyIcon aria-hidden />
                  {t('quickAddCopy')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={props.onDiscard} variant="destructive">
                  <Trash2Icon aria-hidden />
                  {t('quickAddDelete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
