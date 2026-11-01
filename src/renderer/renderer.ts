declare global {
  interface Window {
    folio: { platform: string }
  }
}

document.documentElement.dataset.platform = window.folio.platform

export {}
