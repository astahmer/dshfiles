import { defineLocale } from '@dshfiles/dshx/client'

/** Copy of the picker's fan-out ("Send to several models") controls (b:ysaj). */
const en = {
  selectSeveral: 'Select several',
  selectSeveralHint: 'Choose two to six models, then Fan out. Shift-click or long-press a model does the same.',
  selected: '{count} selected',
  clear: 'Clear',
  fanOut: 'Fan out…',
  fanOutNeedsTwo: 'Choose at least two models.',
}

const zh: Record<keyof typeof en, string> = {
  selectSeveral: '多选',
  selectSeveralHint: '选择 2 到 6 个模型，然后分发。按住 Shift 点击或长按模型效果相同。',
  selected: '已选 {count} 个',
  clear: '清除',
  fanOut: '分发…',
  fanOutNeedsTwo: '至少选择两个模型。',
}

export type ModelPickerKey = keyof typeof en
export type ModelPickerTranslate = (key: ModelPickerKey, params?: Readonly<Record<string, string | number>>) => string

export const MODEL_PICKER_LOCALE_NAMESPACE = 'dshfiles.modelPicker'
export const modelPickerLocale = defineLocale(MODEL_PICKER_LOCALE_NAMESPACE, { en, zh })

/** English with `{name}` holes filled: the picker's copy when no locale seat is bound (tests, an old Host). */
export const englishModelPicker: ModelPickerTranslate = (key, params) =>
  en[key].replace(/\{(\w+)\}/gu, (hole, name: string) => (params?.[name] === undefined ? hole : String(params[name])))
