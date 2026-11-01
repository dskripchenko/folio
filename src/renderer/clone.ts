/**
 * Cloning a repository as a project (ADR-001, stage 4b): the address here,
 * the folder in the system's dialog, the project added once it is cloned.
 */
import { folio } from './bridge'

export interface CloneText {
  title: string
  url: string
  clone: string
  cancel: string
  cloning: string
}

export function openCloneDialog(text: CloneText, describe: (r: { error: string; detail: string[] }) => string): void {
  const dialog = document.createElement('dialog')
  dialog.className = 'clone'
  dialog.dataset.testid = 'clone'
  const form = document.createElement('form')
  const title = document.createElement('h2')
  title.textContent = text.title
  const input = document.createElement('input')
  input.type = 'text'
  input.required = true
  input.placeholder = 'https://github.com/owner/repo.git'
  input.setAttribute('aria-label', text.url)
  input.dataset.testid = 'clone-url'
  const error = document.createElement('p')
  error.className = 'git-note error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  const buttons = document.createElement('div')
  buttons.className = 'buttons'
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = text.cancel
  cancel.addEventListener('click', () => dialog.close())
  const go = document.createElement('button')
  go.type = 'submit'
  go.className = 'primary'
  go.textContent = text.clone
  buttons.append(cancel, go)
  form.append(title, input, error, buttons)
  dialog.append(form)
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    go.disabled = true
    go.textContent = text.cloning
    error.hidden = true
    const result = await folio().gitClone(input.value.trim())
    go.disabled = false
    go.textContent = text.clone
    if ('ok' in result) return dialog.close()
    // The folder dialog was closed: the address stays for another try.
    if (result.error === 'canceled') return
    error.textContent = describe(result)
    error.hidden = false
  })
  dialog.addEventListener('close', () => dialog.remove())
  document.body.append(dialog)
  dialog.showModal()
}
