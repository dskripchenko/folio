import { defineConfig } from '@playwright/test'

// The app knows it is under test (every launch passes process.env on): no Dock icon, windows that do not take
// the focus, no "reopen the windows?" from macOS after a test closes it.
process.env.FOLIO_E2E = '1'

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  // Two apps at a time on a working machine (each is a real window); CI's runners decide for themselves.
  workers: process.env.CI ? undefined : 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
})
