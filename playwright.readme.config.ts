import { defineConfig } from '@playwright/test'

// The README's screenshots (tests/readme), taken by `pnpm readme:shots`: not part of the test run.
process.env.FOLIO_E2E = '1'

export default defineConfig({
  testDir: 'tests/readme',
  timeout: 180_000,
  workers: 1,
  reporter: 'list',
})
