import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@dshfiles/plugin-ui/components/ui/field'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { fieldErrorMessages, revalidateLogic, useAppForm } from '@dshfiles/plugin-ui/form'
import { useEffect, useId, useRef } from 'react'
import { z } from 'zod'
import { MAX_PROMPT_TEXT_LENGTH, MAX_PROMPT_TITLE_LENGTH } from './library.js'
import type { PromptEditorInitialValues } from './prompt-library-machine.js'

const promptEditorFormSchema = z
  .object({
    title: z.string().max(MAX_PROMPT_TITLE_LENGTH),
    text: z
      .string()
      .max(MAX_PROMPT_TEXT_LENGTH)
      .refine(value => value.trim().length > 0, 'Enter prompt text.'),
  })
  .strict()

export interface PromptEditorSubmission extends PromptEditorInitialValues {
  readonly copy: boolean
}

interface PromptEditorFormProps {
  readonly defaultValues: PromptEditorInitialValues
  readonly focusText: boolean
  readonly stale: boolean
  readonly isSaving: boolean
  readonly onSubmit: (submission: PromptEditorSubmission) => void
  readonly onCancel: () => void
}

export const PromptEditorForm = (props: PromptEditorFormProps): JSX.Element => {
  const titleId = useId()
  const textId = useId()
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const submitAsCopy = useRef(false)
  const form = useAppForm({
    defaultValues: props.defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: promptEditorFormSchema },
    onSubmit: ({ value }) => props.onSubmit({ ...value, copy: submitAsCopy.current }),
  })

  useEffect(() => {
    if (props.focusText) textAreaRef.current?.focus()
  }, [props.focusText])

  const submit = (copy: boolean): void => {
    submitAsCopy.current = copy
    void form.handleSubmit().finally(() => {
      submitAsCopy.current = false
    })
  }

  return (
    <form
      className="dshx-root dshx:flex dshx:flex-col dshx:gap-3 dshx:p-3"
      onSubmit={event => {
        event.preventDefault()
        if (props.stale || props.isSaving) return
        submit(false)
      }}
    >
      <form.AppField name="title">
        {field => {
          const errors = fieldErrorMessages(field.state.meta.errors)
          const errorId = `${titleId}-error`
          return (
            <Field data-invalid={errors.length > 0} orientation="vertical" className="dshx:flex dshx:w-full dshx:flex-col dshx:items-stretch dshx:gap-1.5">
              <FieldLabel htmlFor={titleId}>Label (optional)</FieldLabel>
              <Input
                id={titleId}
                aria-describedby={errors.length > 0 ? errorId : undefined}
                aria-invalid={errors.length > 0 || undefined}
                className="dshx:h-8 dshx:w-full dshx:text-sm"
                disabled={props.isSaving}
                maxLength={MAX_PROMPT_TITLE_LENGTH}
                placeholder="Defaults to the first line"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.currentTarget.value)}
              />
              {errors.length > 0 ? <FieldError id={errorId}>{errors.join(' ')}</FieldError> : null}
            </Field>
          )
        }}
      </form.AppField>
      <form.AppField name="text">
        {field => {
          const errors = fieldErrorMessages(field.state.meta.errors)
          const errorId = `${textId}-error`
          return (
            <Field data-invalid={errors.length > 0} orientation="vertical" className="dshx:flex dshx:w-full dshx:flex-col dshx:items-stretch dshx:gap-1.5">
              <FieldLabel htmlFor={textId}>Prompt text</FieldLabel>
              <Textarea
                id={textId}
                ref={textAreaRef}
                aria-describedby={errors.length > 0 ? errorId : undefined}
                aria-invalid={errors.length > 0 || undefined}
                className="dshx:min-h-36 dshx:w-full dshx:text-sm"
                disabled={props.isSaving}
                maxLength={MAX_PROMPT_TEXT_LENGTH}
                name={field.name}
                required
                rows={8}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={event => field.handleChange(event.currentTarget.value)}
              />
              <FieldDescription className="dshx:w-full dshx:text-right dshx:text-xs">
                {field.state.value.length} of {MAX_PROMPT_TEXT_LENGTH} characters
              </FieldDescription>
              {errors.length > 0 ? <FieldError id={errorId}>{errors.join(' ')}</FieldError> : null}
            </Field>
          )
        }}
      </form.AppField>
      {props.stale ? (
        <p className="dshx:rounded-md dshx:bg-warning/15 dshx:px-2 dshx:py-1.5 dshx:text-xs">The saved version changed elsewhere. Your edits remain here.</p>
      ) : null}
      <div className="dshx:flex dshx:items-center dshx:justify-end dshx:gap-1.5">
        <Button type="button" variant="ghost" size="sm" disabled={props.isSaving} onClick={props.onCancel}>
          Cancel
        </Button>
        {props.stale ? (
          <Button type="button" variant="outline" size="sm" disabled={props.isSaving} onClick={() => submit(true)}>
            Save as new copy
          </Button>
        ) : null}
        <Button type="submit" size="sm" disabled={props.isSaving || props.stale}>
          Save prompt
        </Button>
      </div>
    </form>
  )
}
