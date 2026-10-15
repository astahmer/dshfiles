import { defineLocale } from '@dshfiles/dshx/client'

export const ATTACHMENT_GALLERY_LOCALE_NAMESPACE = 'conversation.attachmentGallery'

const dictionaries = {
  en: {
    dialog: 'Image preview',
    close: 'Close image preview',
    previous: 'Previous image',
    next: 'Next image',
    thumbnail: 'Image {position} of {total}',
    loading: 'Loading image',
  },
  zh: {
    dialog: '图片预览',
    close: '关闭图片预览',
    previous: '上一张图片',
    next: '下一张图片',
    thumbnail: '第 {position} 张，共 {total} 张',
    loading: '正在加载图片',
  },
} as const

export type GalleryLocaleKey = keyof typeof dictionaries.en
export type GalleryTranslate = (key: GalleryLocaleKey, params?: Readonly<Record<string, string | number>>) => string

export const attachmentGalleryLocale = defineLocale(ATTACHMENT_GALLERY_LOCALE_NAMESPACE, dictionaries)
