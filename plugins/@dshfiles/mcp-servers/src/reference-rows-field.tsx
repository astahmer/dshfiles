import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { fieldErrorMessages, useFieldContext } from '@dshfiles/plugin-ui/form'
import { PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { useId, useRef, useState } from 'react'
import type { McpServersTranslate } from './locales.js'
import { McpServerFormModel, type ReferenceRow } from './server-form.js'

type KeyedRow = ReferenceRow & { readonly key: number }

/**
 * A `{ "NAME": "REFERENCE" }` form field edited as rows. Each reference input carries `data-secret-input="reference"`,
 * so the Secret Catalog offers its vault picker there and writes a `secret:ALIAS` reference; the field never holds a
 * value. The form value stays the JSON text the server form model parses.
 */
export const ReferenceRowsField = (props: {
  readonly t: McpServersTranslate
  readonly label: string
  readonly namePlaceholder: string
  readonly referencePlaceholder: string
}): JSX.Element => {
  const field = useFieldContext<string>()
  const id = useId()
  const nextKey = useRef(0)
  const keyed = (row: ReferenceRow): KeyedRow => ({ ...row, key: nextKey.current++ })
  const [rows, setRows] = useState<readonly KeyedRow[]>(() => McpServerFormModel.referenceRows(field.state.value).map(keyed))
  const commit = (next: readonly KeyedRow[]): void => {
    setRows(next)
    field.handleChange(McpServerFormModel.serializeReferenceRows(next))
  }
  const change = (index: number, patch: Partial<ReferenceRow>): void => commit(rows.map((row, current) => (current === index ? { ...row, ...patch } : row)))
  const duplicates = McpServerFormModel.duplicateReferenceNames(rows)
  const meta = field.state.meta
  const errors = meta.isTouched || field.form.state.submissionAttempts > 0 ? fieldErrorMessages(meta.errors) : []
  const messages = [...errors, ...[...duplicates].map(name => props.t('duplicateReferenceName', { name }))]
  const t = props.t
  return (
    <Field data-invalid={messages.length > 0 || undefined}>
      <FieldLabel id={`${id}-label`}>{props.label}</FieldLabel>
      <div aria-labelledby={`${id}-label`} className="dshx:flex dshx:flex-col dshx:gap-2" role="group">
        {rows.map((row, index) => {
          const position = String(index + 1)
          return (
            <div className="dshx:grid dshx:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] dshx:items-center dshx:gap-2" key={row.key}>
              <Input
                aria-invalid={duplicates.has(row.name.trim()) || undefined}
                aria-label={t('referenceRowName', { field: props.label, index: position })}
                autoComplete="off"
                className="dshx:font-mono! dshx:text-xs"
                onBlur={field.handleBlur}
                onChange={event => change(index, { name: event.currentTarget.value })}
                placeholder={props.namePlaceholder}
                spellCheck={false}
                value={row.name}
              />
              <Input
                aria-label={t('referenceRowValue', { field: props.label, index: position })}
                autoComplete="off"
                className="dshx:font-mono! dshx:text-xs"
                data-secret-input="reference"
                onBlur={field.handleBlur}
                onChange={event => change(index, { reference: event.currentTarget.value })}
                placeholder={props.referencePlaceholder}
                spellCheck={false}
                value={row.reference}
              />
              <Button
                aria-label={t('removeReference', { name: row.name.trim() === '' ? position : row.name.trim() })}
                onClick={() => commit(rows.filter((_, current) => current !== index))}
                size="icon"
                type="button"
                variant="ghost"
              >
                <XIcon className="dshx:size-3.5" />
              </Button>
            </div>
          )
        })}
        <Button className="dshx:w-fit" onClick={() => setRows([...rows, keyed({ name: '', reference: '' })])} size="sm" type="button" variant="outline">
          <PlusIcon className="dshx:size-3.5" />
          {t('addReference')}
        </Button>
      </div>
      <FieldDescription>{t('referenceHint')}</FieldDescription>
      <FieldError errors={messages.map(message => ({ message }))} />
    </Field>
  )
}
