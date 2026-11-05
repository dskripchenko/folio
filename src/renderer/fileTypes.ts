/**
 * A file's type at a glance: one or two letters (or a sign) in the colour of
 * its stack — JavaScript yellow, TypeScript blue, PHP violet and so on —
 * for the tree, the list of changes and the review's files.
 */

export interface FileType {
  /** What is drawn: one to three characters. */
  glyph: string
  /** The stack's colour; the CSS mixes it with the text colour per theme. */
  color: string
  /** The type's name, for the tooltip. */
  name: string
}

const T = (glyph: string, color: string, name: string): FileType => ({ glyph, color, name })

const JS = T('JS', '#e8c518', 'JavaScript')
const TS = T('TS', '#3178c6', 'TypeScript')
const PHP = T('<?', '#777bb4', 'PHP')
const JSON_ = T('{}', '#cba135', 'JSON')
const YAML = T('Y', '#cb171e', 'YAML')
const SHELL = T('$', '#4eaa25', 'Shell')
const C = T('C', '#5c7fa8', 'C')
const CPP = T('C+', '#f34b7d', 'C++')
const CONF = T('=', '#8b949e', 'Config')
const LOCK = T('LK', '#8b949e', 'Lock file')
const XML = T('<>', '#0060ac', 'XML')

/** By the whole name (checked first, case-insensitive). */
const BY_NAME: Record<string, FileType> = {
  'package.json': T('N', '#cb3837', 'npm'),
  'package-lock.json': LOCK,
  'pnpm-lock.yaml': LOCK,
  'yarn.lock': LOCK,
  'bun.lockb': LOCK,
  'composer.json': T('C', '#885630', 'Composer'),
  'composer.lock': LOCK,
  'cargo.lock': LOCK,
  'gemfile.lock': LOCK,
  'poetry.lock': LOCK,
  'go.sum': LOCK,
  'go.mod': T('Go', '#00add8', 'Go module'),
  'cargo.toml': T('Rs', '#dea584', 'Cargo'),
  gemfile: T('Rb', '#cc342d', 'Bundler'),
  rakefile: T('Rb', '#cc342d', 'Rake'),
  dockerfile: T('D', '#2496ed', 'Docker'),
  'docker-compose.yml': T('D', '#2496ed', 'Docker Compose'),
  'docker-compose.yaml': T('D', '#2496ed', 'Docker Compose'),
  'compose.yml': T('D', '#2496ed', 'Docker Compose'),
  'compose.yaml': T('D', '#2496ed', 'Docker Compose'),
  '.dockerignore': T('D', '#2496ed', 'Docker'),
  makefile: T('M', '#6d8e2f', 'Make'),
  '.gitignore': T('G', '#f05033', 'git'),
  '.gitattributes': T('G', '#f05033', 'git'),
  '.gitmodules': T('G', '#f05033', 'git'),
  '.gitlab-ci.yml': T('G', '#fc6d26', 'GitLab CI'),
  '.editorconfig': CONF,
  '.npmrc': CONF,
  '.nvmrc': CONF,
  '.prettierrc': T('P', '#c596c7', 'Prettier'),
  artisan: T('L', '#f05340', 'Laravel'),
  license: T('§', '#8b949e', 'Licence'),
  'license.md': T('§', '#8b949e', 'Licence'),
  'license.txt': T('§', '#8b949e', 'Licence'),
  'tsconfig.json': TS,
  'jsconfig.json': JS,
  'phpunit.xml': PHP,
  'phpstan.neon': PHP,
  'phpstan.neon.dist': PHP,
  'phpunit.xml.dist': PHP,
}

/** By the extension; the longer ones (`blade.php`, `d.ts`) are checked first. */
const BY_EXT: Record<string, FileType> = {
  'blade.php': T('B', '#f05340', 'Blade'),
  'd.ts': TS,
  js: JS, mjs: JS, cjs: JS, jsx: T('JS', '#61dafb', 'React'),
  ts: TS, mts: TS, cts: TS, tsx: T('TS', '#61dafb', 'React'),
  vue: T('V', '#41b883', 'Vue'),
  svelte: T('S', '#ff3e00', 'Svelte'),
  astro: T('A', '#ff5d01', 'Astro'),
  php: PHP, phtml: PHP,
  neon: T('N', '#4b8bbe', 'Neon'),
  twig: T('Tw', '#a2b24b', 'Twig'),
  py: T('Py', '#3572a5', 'Python'), pyi: T('Py', '#3572a5', 'Python'),
  ipynb: T('Nb', '#f37626', 'Jupyter'),
  rb: T('Rb', '#cc342d', 'Ruby'), erb: T('Rb', '#cc342d', 'Ruby'),
  go: T('Go', '#00add8', 'Go'),
  rs: T('Rs', '#dea584', 'Rust'),
  java: T('J', '#b07219', 'Java'), jar: T('J', '#b07219', 'Java'),
  kt: T('K', '#a97bff', 'Kotlin'), kts: T('K', '#a97bff', 'Kotlin'),
  scala: T('Sc', '#dc322f', 'Scala'),
  groovy: T('Gr', '#4298b8', 'Groovy'), gradle: T('Gr', '#02303a', 'Gradle'),
  swift: T('Sw', '#f05138', 'Swift'),
  m: T('M', '#438eff', 'Objective-C'),
  c: C, h: C,
  cpp: CPP, cc: CPP, cxx: CPP, hpp: CPP, hh: CPP, hxx: CPP,
  cs: T('C#', '#178600', 'C#'), csproj: T('C#', '#178600', 'C#'), sln: T('C#', '#178600', 'C#'),
  fs: T('F#', '#b845fc', 'F#'),
  dart: T('Dt', '#00b4ab', 'Dart'),
  lua: T('Lu', '#000080', 'Lua'),
  pl: T('Pl', '#0298c3', 'Perl'), pm: T('Pl', '#0298c3', 'Perl'),
  r: T('R', '#198ce7', 'R'),
  ex: T('Ex', '#6e4a7e', 'Elixir'), exs: T('Ex', '#6e4a7e', 'Elixir'), erl: T('Er', '#b83998', 'Erlang'),
  hs: T('λ', '#5e5086', 'Haskell'), clj: T('λ', '#db5855', 'Clojure'), cljs: T('λ', '#db5855', 'Clojure'),
  elm: T('El', '#60b5cc', 'Elm'),
  zig: T('Z', '#ec915c', 'Zig'),
  nim: T('Ni', '#ffc200', 'Nim'),
  sh: SHELL, bash: SHELL, zsh: SHELL, fish: SHELL, bat: SHELL, cmd: SHELL,
  ps1: T('PS', '#012456', 'PowerShell'), psm1: T('PS', '#012456', 'PowerShell'),
  html: T('<>', '#e34c26', 'HTML'), htm: T('<>', '#e34c26', 'HTML'),
  css: T('#', '#2965f1', 'CSS'),
  scss: T('S', '#c6538c', 'Sass'), sass: T('S', '#c6538c', 'Sass'),
  less: T('L', '#1d365d', 'Less'),
  styl: T('St', '#ff6347', 'Stylus'),
  json: JSON_, jsonc: JSON_, json5: JSON_, webmanifest: JSON_,
  yaml: YAML, yml: YAML,
  toml: T('T', '#9c4221', 'TOML'),
  xml: XML, xsd: XML, xsl: XML, plist: XML,
  ini: CONF, cfg: CONF, conf: CONF, properties: CONF,
  env: T('E', '#d4b106', 'Environment'),
  lock: LOCK,
  sql: T('DB', '#e38c00', 'SQL'), sqlite: T('DB', '#e38c00', 'SQLite'), db: T('DB', '#e38c00', 'Database'),
  prisma: T('Pr', '#5a67d8', 'Prisma'),
  graphql: T('GQ', '#e10098', 'GraphQL'), gql: T('GQ', '#e10098', 'GraphQL'),
  proto: T('Pb', '#4285f4', 'Protocol Buffers'),
  tf: T('TF', '#7b42bc', 'Terraform'), hcl: T('TF', '#7b42bc', 'HCL'),
  csv: T(',', '#237346', 'CSV'), tsv: T(',', '#237346', 'TSV'),
  xlsx: T('X', '#217346', 'Excel'), xls: T('X', '#217346', 'Excel'),
  docx: T('W', '#2b579a', 'Word'), doc: T('W', '#2b579a', 'Word'),
  pptx: T('P', '#d24726', 'PowerPoint'),
  txt: T('≡', '#8b949e', 'Text'), log: T('≡', '#8b949e', 'Log'),
  diff: T('±', '#2da44e', 'Diff'), patch: T('±', '#2da44e', 'Patch'),
  zip: T('Z', '#8b949e', 'Archive'), gz: T('Z', '#8b949e', 'Archive'), tar: T('Z', '#8b949e', 'Archive'), tgz: T('Z', '#8b949e', 'Archive'), '7z': T('Z', '#8b949e', 'Archive'), rar: T('Z', '#8b949e', 'Archive'),
  woff: T('F', '#8b949e', 'Font'), woff2: T('F', '#8b949e', 'Font'), ttf: T('F', '#8b949e', 'Font'), otf: T('F', '#8b949e', 'Font'),
  vim: T('V', '#019833', 'Vim'),
  tex: T('Tx', '#3d6117', 'TeX'),
  vtt: T('≡', '#8b949e', 'Subtitles'), srt: T('≡', '#8b949e', 'Subtitles'),
  wasm: T('W', '#654ff0', 'WebAssembly'),
  // The kinds the tree draws with icons of their own; the lists of changes draw these.
  md: T('M↓', '#519aba', 'Markdown'), markdown: T('M↓', '#519aba', 'Markdown'), mdx: T('M↓', '#519aba', 'MDX'),
  mmd: T('◇', '#ff3670', 'Mermaid'), mermaid: T('◇', '#ff3670', 'Mermaid'), puml: T('◇', '#4f8fb8', 'PlantUML'), plantuml: T('◇', '#4f8fb8', 'PlantUML'),
  dot: T('◇', '#4f8fb8', 'Graphviz'), drawio: T('◇', '#f08705', 'draw.io'), bpmn: T('◇', '#4f8fb8', 'BPMN'),
  png: T('▣', '#a074c4', 'Image'), jpg: T('▣', '#a074c4', 'Image'), jpeg: T('▣', '#a074c4', 'Image'), gif: T('▣', '#a074c4', 'Image'), webp: T('▣', '#a074c4', 'Image'), avif: T('▣', '#a074c4', 'Image'), bmp: T('▣', '#a074c4', 'Image'), ico: T('▣', '#a074c4', 'Icon'),
  svg: T('▣', '#ffb13b', 'SVG'),
  mp4: T('▶', '#a074c4', 'Video'), webm: T('▶', '#a074c4', 'Video'), mov: T('▶', '#a074c4', 'Video'), mkv: T('▶', '#a074c4', 'Video'), m4v: T('▶', '#a074c4', 'Video'),
  mp3: T('♪', '#a074c4', 'Audio'), wav: T('♪', '#a074c4', 'Audio'), ogg: T('♪', '#a074c4', 'Audio'), flac: T('♪', '#a074c4', 'Audio'), m4a: T('♪', '#a074c4', 'Audio'),
  pdf: T('Pd', '#e5252a', 'PDF'),
}

/** Any file's mark, a plain one for a type folio does not know. */
export const PLAIN: FileType = T('·', '#8b949e', 'File')

/** The type of a file by its name (a path's last part is enough), or null when folio has none for it. */
export function fileType(path: string): FileType | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const exact = BY_NAME[name]
  if (exact) return exact
  if (name.startsWith('.env')) return BY_EXT.env ?? null
  if (name.startsWith('dockerfile') || name.endsWith('.dockerfile')) return BY_NAME.dockerfile ?? null
  if (/^(vite|vitest|webpack|rollup|eslint|babel|jest|playwright|tailwind|postcss|nuxt|next|svelte|astro)\.config\./.test(name)) {
    const ext = name.slice(name.lastIndexOf('.') + 1)
    return BY_EXT[ext] ?? null
  }
  const dot = name.indexOf('.', 1)
  if (dot < 0) return null
  // The longest known extension: `a.blade.php` is Blade, `x.d.ts` TypeScript.
  const parts = name.slice(dot + 1).split('.')
  for (let i = 0; i < parts.length; i++) {
    const t = BY_EXT[parts.slice(i).join('.')]
    if (t) return t
  }
  return null
}

/** A file's type as a little mark in its colour, for a row beside its name. */
export function fileBadge(t: FileType): HTMLElement {
  const b = document.createElement('span')
  b.className = 'ft'
  b.dataset.glyphs = String([...t.glyph].length)
  b.style.setProperty('--ft', t.color)
  b.textContent = t.glyph
  b.title = t.name
  b.setAttribute('aria-hidden', 'true')
  return b
}
