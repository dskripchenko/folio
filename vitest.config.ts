import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

// The shell integration's scripts are text, as the build bundles them.
const scripts = {
  name: 'shell-scripts',
  load(id: string) {
    if (/\.(zsh|bash|ps1)$/.test(id)) return `export default ${JSON.stringify(readFileSync(id, 'utf8'))}`
    return null
  },
}

export default defineConfig({ plugins: [scripts], test: { include: ['tests/unit/**/*.spec.ts'], testTimeout: 20_000 } })
