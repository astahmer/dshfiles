import { defineClient } from '@dshfiles/dshx/client'

// The question card (@dshfiles/user-questions, a fork of dsh-client-ui-user-questions) hashes its CSS-module classes, so these rules key on its stable
// data attributes, element structure and class-name suffixes. A DSH update that reshapes the card drops them silently.
const questionCardSheet = `
[data-question-key]{container:dshfiles-question-card/inline-size}
[data-question-key]>section>header>div:last-child>span{font-variant-numeric:tabular-nums}
[data-question-key]>section>header>div:last-child>span:has(+[class*="_waitButton"]){min-width:20ch;text-align:end}
[data-question-key]>section>header h2[id^="question-"]{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;overflow-wrap:anywhere}
[data-question-key]>section>header:is(:hover,:focus-within) h2[id^="question-"]{-webkit-line-clamp:unset;line-clamp:none;overflow:visible}
@container dshfiles-question-card (width < 480px){
[data-question-key]>section>header{flex-direction:column;align-items:stretch;gap:8px}
[data-question-key]>section>header>div:last-child{flex-wrap:wrap;justify-content:flex-end}
[data-question-key]>section>header>div:last-child>span:has(+[class*="_waitButton"]){min-width:0;margin-right:auto;text-align:start}
}
`

export default defineClient({
  name: '@dshfiles/agent-questions',
  setup() {
    const sheet = document.createElement('style')
    sheet.dataset.dshfilesQuestionCard = ''
    sheet.textContent = questionCardSheet
    document.head.appendChild(sheet)
    return () => sheet.remove()
  },
})
