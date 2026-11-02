import { defineConfig } from '@playwright/test'

// The packaged program, run as a person would (FOLIO_APP: its executable): see tests/package.
export default defineConfig({
  testDir: 'tests/package',
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
})
