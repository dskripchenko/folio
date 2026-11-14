# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Consoles use `@dskripchenko/terminal` 0.4.0: long output no longer slows
  down as the scrollback fills (up to five times faster with a full one), and
  a program that draws its frames as synchronized output (mode 2026), such as
  Claude Code, is shown a whole frame at a time, never half of one.

## [1.13.2] - 2026-11-11

### Fixed

- Buttons say what they do on hover: folio draws its own tooltips, since the
  system's often did not show (on macOS not at all) — the rail's icons, the
  close ×'s, the calendar's arrows and the other icons of embedded blocks.

## [1.13.1] - 2026-11-11

### Fixed

- macOS: folio started from a read-only copy (App Translocation — a downloaded
  `folio.app` opened where it was unpacked) no longer fails with “ENOENT …
  folio-data/update”; it offers to move itself to Applications and starts
  again from there.

## [1.13.0] - 2026-11-10

### Added

- **Settings → View**: the text's size (headings and code in proportion, when
  read and in the editor) and the page's width — the whole window, or a column
  to read in.
- **Zoom when reading**: a pinch on the trackpad or ⌘/Ctrl + the mouse wheel
  zooms the document at the place under the pointer — a part of a diagram can
  be looked at closely; the view scrolls both ways, and the percentage in the
  corner brings 100% back. Each tab has its own.

### Changed

- The page takes the window's whole width; a narrow column in the middle of a
  wide screen is now a choice in Settings → View.
- Notices are in the colour of what they say — news neutral, a thing done
  green (and gone by itself after a few seconds), a failure red — and each has
  a × to close it.

### Fixed

- Links with the destination in angle brackets, `[text](<path/file.md>)`,
  open the file — spaces in the path too (embed 1.21.0, ui 1.47.2).
- On Windows, what folio takes is counted right: processes that only reuse a
  dead parent's id are no longer counted as folio's (the gauge could show
  gigabytes over), and the processes are read without the slow performance
  counters, which could run past the time allowed and leave the consoles out.

## [1.12.3] - 2026-11-10

### Fixed

- **HTML source** in the visual editor: in full screen it no longer shrinks to
  a line or two — the source fills the page under the toolbar, in the pane and
  in full screen alike, and scrolls inside. Clicks and scrolling now work on
  every line, not only the first ones. The source also looks tidier: a frame,
  padding, and the font of the Markdown source.

## [1.12.2] - 2026-11-10

### Fixed

- **Full screen** in the visual editor no longer breaks the window: the text
  no longer runs, see-through, over the consoles and the panels. The document
  now takes the whole window — the sidebar, the rails, the tabs, the status
  line and the consoles step aside, the toolbar stays — and Esc brings them
  back.

## [1.12.1] - 2026-11-05

### Fixed

- **Keep awake** keeps the display on too, as Amphetamine does: the screen no
  longer dims and the screen saver no longer starts after a few minutes while
  folio keeps the computer awake. **Let the display sleep** in its menu keeps
  only the system awake, and is remembered.

## [1.12.0] - 2026-11-05

### Added

- **Notifications from the consoles** while folio is not in front: a command
  that ran longer than a minute has ended (its text, time, whether it failed),
  or a program asks for attention — OSC 9 / OSC 777 or a bell, as Claude Code
  sends when it is done or waits for an answer. A click brings folio forward at
  that console.
- A console's programs on its tab: memory and processor in the tooltip, a mark
  past a gigabyte; a note when they pass 8 GB or keep the processor busy for
  five minutes (folio never touches them).
- **After a crash** — the last run never quit — folio says so once at start,
  with the log and a report at hand.
- **Little room on the disk** (under 5 GB) is said, with **Clear caches**;
  **App** in the settings tells what `folio-data` holds and clears Chromium's
  cache, downloaded updates and crash dumps (never the unsaved or settings).
- The log tells what was slow: the window's requests over 2 s, the main
  process standing still, the event loop's delay and queued work each minute;
  **Processes** shows the delay too. On battery folio samples once a minute.

### Changed

- Changes inside build output and tools' caches (`dist`, `build`, `vendor`,
  `coverage`, `.next`, `target`…) are not followed: an agent building or
  testing no longer floods folio. A project sets its own list with
  `watchExclude` in `.folio/settings.json`.
- What every change on disk recomputes — the files behind links, tags, the
  graph and tasks — runs once at a time per folder and is kept until something
  there changes, instead of walking the folder on every change.

### Fixed

- A new note's editor takes the keys at once: typed right after **New quick
  note** they could be lost while the window was not in front.

## [1.11.0] - 2026-11-05

### Added

- **What folio takes.** A gauge at the bottom of the right rail: folio's memory,
  a bar up to the limit (amber near it, red past it), the processor in its
  tooltip. A click opens **Processes**: the main process, the window, graphics,
  Chromium's helpers, each language server and each console with what runs in
  it — memory, processor, a chart of the last half hour with the limit; a
  language server started again, a console closed from there. What runs in the
  consoles (an agent, a build) is shown apart and is not counted as folio's.
- **Memory limits** in the settings window, **App**: a soft limit for folio
  (4 GB by default) — past it folio lets go of its indexes and caches and starts
  the heaviest language server again, and says so if that does not help, with
  **Restart folio** at hand; a limit for a language server (2 GB), started
  again past it; a hard heap limit per process as a last resort (off), taken at
  the next start.
- **A log** in `folio-data/logs`, a file a day, kept 5 days (1–30 in the
  settings): starts, errors of the app and its window, fallen processes, limits
  reached, a memory sample of each process a minute. Crash dumps stay local and
  go with the log's days. **Help → Open the Log Folder**, **Save a Report…** (a
  ZIP to send), and `get_app_log` in folio's MCP server for an agent.
- **Keep awake** (the cup in the rail): the computer does not sleep until
  turned off, for 1, 2 or 4 hours, or while a command runs in one of folio's
  consoles and a minute after; the display kept on too if asked. macOS, Windows
  and Linux; a Mac with its lid closed still sleeps without an external display.

## [1.10.1] - 2026-11-05

### Fixed

- folio no longer slows the computer down to a halt while an agent writes
  files: every change on disk had each folder open in the tree read the whole
  repository's status at once, the reads queued faster than they finished and
  memory grew past 13 GB. Now one read per repository runs at a time and
  everyone who asks meanwhile shares the next one; the tree's marks are drawn
  again at most every 300 ms.

## [1.10.0] - 2026-11-05

### Added

- Files show their type: a letter or two in the colour of their stack beside
  the name — `JS` yellow, `TS` blue, `<?` violet for PHP, `B` for Blade, `V`
  for Vue, `Py`, `Go`, `Rs`, `{}` for JSON, `Y` for YAML, `$` for shell and
  many more; `package.json`, `composer.json`, lock files, `Dockerfile`, `.env`
  and `.gitignore` known by name. In the tree, in **Changes** and in the
  review's list of files and file headings, readable in both themes.
- The review's list of files as a tree: a button above the list switches
  between one line per file and folders (remembered); folders come first, a
  folder holding only one folder is shown with it as one row
  (`src/http/controllers`), a folder folds with a click and hides with
  **Not viewed only** once all its files are viewed.

## [1.9.0] - 2026-11-05

### Added

- **Show in the Sidebar** in a tab's menu (and the command palette): the file's
  project found, its folders opened, its row brought into view and focused —
  in the flyout when the sidebar is folded, a hidden project shown — so a tab
  tells where its file is and which project it belongs to.
- Console tabs have colours and groups as the documents' tabs do: a colour
  from the tab's menu, a group named in place, folded by a click on its chip,
  recoloured, ungrouped or closed from the chip's menu; the others, those to
  the right or all consoles closed from a tab's menu.

### Fixed

- The consoles' wheel: a turn of a mouse's wheel sped up by the system, or a
  flick of a trackpad, moved the output by a screen, so long output was hard
  to read a few lines at a time. The wheel now moves at most three rows an
  event, small moves as they are; in a full-screen program (`less`, `vim`)
  short moves add up to whole rows before an arrow is sent
  (`@dskripchenko/terminal` 0.3.0).
- The tree could spin forever when a new note or folder was asked for in a
  folded project; folders are now opened one above the other, waiting for
  each list from the disk.

## [1.8.2] - 2026-11-05

### Fixed

- **Connect Claude Code to folio** adds folio's MCP server again: the command
  put the server's name after `--env`, which takes any number of values, so
  Claude Code read the name as a variable and refused ("Invalid environment
  variable format"). The name now comes first.

## [1.8.1] - 2026-11-04

### Fixed

- An update shows how far its download is (a percent and megabytes), and one
  that hangs is given up: GitHub not answering in 30 s, or the download getting
  no bytes for 60 s, is said as an error, and **Check for Updates** tries again.
  Before, a request the network swallowed left "Downloading folio…" on screen
  for good.

## [1.8.0] - 2026-11-04

### Added

- folio's MCP server (ADR-006, R7): an agent shows you its changes and waits
  for your answer. **Connect Claude Code to folio** also adds the server to
  Claude Code for the project (`claude mcp add --scope local`). Its tools:
  `show_changes` opens the review with the agent's message — **Approve**, or
  **Request changes** with your comments on lines; `get_review_comments`;
  `open_file` at a line; `list_worktrees`. The server listens on 127.0.0.1
  with a token; the agent reaches it through a small bridge run by folio's own
  executable, which tells it to start folio while folio is closed.

### Changed

- The README's screenshots are taken by a script (`pnpm readme:shots`).
- Steadier tests: under test a window lets the system's pointer pass through;
  the Windows shell and sync tests wait for slow processes.

## [1.7.1] - 2026-11-04

### Fixed
- Task lists (`- [ ]` / `- [x]`) are edited visually as lists with boxes to
  tick — a click ticks a box, `[ ] ` or `[x] ` typed at the start of an item
  makes a task, Enter after a task starts an unticked one — instead of showing
  as a block of Markdown (embed 1.20.0: markdown-editor 0.9.0, wysiwyg 0.13.0).

### Changed
- The welcome document tells of tabs (colours, groups, closing many).
- The README shows the interface: screenshots in English.
- Docs: what `folio-data/` holds and the two files folio writes into your
  folders when asked; what needs the system's git; reviewing an agent's work in
  the README; the source layout, the icon and the quiet end-to-end mode in the
  development guide.

## [1.7.0] - 2026-11-04

### Added
- Reviewing an AI agent's work (ADR-006). **Review** shows a set of changes as
  a pull request's files, in a tab: files marked as viewed, one column or two,
  words changed within a line marked, unchanged stretches folded; the working
  copy, a commit, the changes after one, or a worktree against its base. Runs
  of the working copy are staged, taken out of the index or thrown away; a
  double click edits the line beside the review; what an agent writes shows by
  itself.
- **Since the last look**: only what changed since you looked — edits and the
  agent's commits — the newest first, with when; counted in **Changes**.
- **Worktrees** beside the page: each with its branch, commits ahead of the
  base and behind, files changed and when; reviewed against the base, opened as
  a project (its changes and history work there through the system's git) or in
  a terminal, taken without a commit, merged, removed with its branch.
  Worktrees inside a project are left out of search and going to a file.
- **Comments** on lines, kept where their lines move, sent to the agent's
  console as one paste without Enter (never as lines a shell would run).
- **Connect Claude Code to folio**: a hook in the repository's local settings
  (shown first); reviews and worktrees say which session changed a file, and
  when.

## [1.6.0] - 2026-11-04

### Added
- Closing many tabs: a tab's menu closes the others, those to its right, the
  saved ones or all — also from the commands, the File menu and
  `Cmd/Ctrl+Shift+W`; the saved go first, each with changes is asked about.
- Tab colours and groups: a tab of a colour of its own; groups with a name and
  a colour, folded by a click on their chip, joined from the menu or by
  dropping a tab on the chip; kept across a restart.

## [1.5.1] - 2026-11-04

### Changed
- A new icon: a single page with a folded coral corner whose last line of
  text turns into a small diagram — Markdown becoming a drawing; a simpler
  page for 16–32 px.

### Fixed
- Windows: a rename, a move or a saved setting no longer fails when another
  program (an antivirus, the search indexer) holds the file for a moment —
  tried again for a little while.

## [1.5.0] - 2026-11-04

### Added
- Languages: English and Russian built in, the system's or one chosen in the
  settings menu, applied at once and kept. Every text is a JSON dictionary
  (`src/locales`); another language is one more file — also in
  `folio-data/locales` without rebuilding — English where it says nothing.
- *What folio can do*: a read-only welcome page with every kind of block drawn
  live, opened on the first start and from the commands, the Help menu and the
  empty window, in the language in use.

## [1.4.0] - 2026-11-04

### Added
- Tabs: the one closed last comes back with `Cmd/Ctrl+Shift+T` at its place,
  in its view, scrolled where it was; tabs are dragged to another place in
  the row, onto the view's right half to open beside, and back.
- `![[photo.png]]`, `![[clip.mp4]]`, `![[song.mp3]]`, `![[report.pdf]]` show
  the file in the note, found by name anywhere in the project; `|300` or
  `|300x200` sizes it. A link to a picture previews it on hover.
- Long lines wrap at the view's width in prose (plain text, Markdown, logs);
  `Alt+Z` changes it and remembers it for that kind of text.
- PDF files open in their tab in Chromium's viewer.
- CSV and TSV as a table: separator guessed, header kept in view, sorted by a
  column, a thousand rows at a time; the source in the code editor.
- Any two files compared — from the tree (select for compare, compare with)
  or the palette — in the history's views of the changes.
- Export as one HTML page (pictures and diagrams inside) and as Word (DOCX,
  written by folio itself: headings, emphasis, links, lists, quotes, code,
  tables, pictures; diagrams as pictures).
- Git: put changes aside and take them back (stash, new files too), amend the
  last commit, undo a commit with a new one (revert), tag a commit (tags go
  out with the next sync), rename and delete branches.
- The settings window (`Cmd/Ctrl+,`): keys of one's own for every command of
  folio and of the code editor, set by pressing them, clashes shown; the
  project's `.folio/settings.json` as a form, unknown keys kept.

### Fixed
- A tab dragged over an editor is no longer taken by it as a drop.

## [1.3.0] - 2026-11-04

### Added
- Pictures, video and sound open in folio instead of the system's program:
  a picture fitted, zoomed (`Cmd/Ctrl` and the wheel or a pinch, `+`, `−`,
  `0`, `1`, a double click) and dragged, over a chequerboard; video and sound
  in the players, seeking in the file; their size, length and bytes in the
  status line; the system's program a click away. An SVG is drawn, and edited
  beside its live picture. Media are listed in the trees of notes too.

## [1.2.1] - 2026-11-04

### Fixed
- A note's preview stays open while the pointer is on its way from the link
  into it, however slowly: only a pointer that leaves that way closes it.

## [1.2.0] - 2026-11-03

### Fixed
- Language servers on Windows: a rename's edits to closed files are written
  (a server's paths are compared the way folio's own are, short names kept).
- A formatter (or a language server) gone before reading what it was sent no
  longer raises an error in folio: its exit code tells what happened.
- The code editor measures its lines again when the page changes their height
  (the edit mode's larger lines): a click, a hover and going to a definition
  far down a file land on the line under the pointer.
- A completion picked with a click keeps the cursor where the item went.
- A note's preview no longer starts its note over when the pointer comes
  back onto the link while the note is still being read: on a slow machine it
  could never show.

### Added
- Language servers (ADR-003): where `typescript-language-server`,
  `intelephense`/`phpactor`, `pyright`/`pylsp`, `gopls`, `rust-analyzer` or
  `clangd` is on the machine (or in the project, once it is trusted), the
  code editor shows its problems as they are typed (and in Problems), what a
  name is on hover, goes to a definition (`F12`, `Cmd/Ctrl`+click), lists
  references (`Shift+F12`), renames across the project (`F2`, one undo a tab),
  offers its fixes (`Cmd/Ctrl+.`), completes from it, shows a call's
  parameters and builds the outline and breadcrumbs from it. `"lsp"` in
  `.folio/settings.json` sets a language's command or turns it off;
  `"formatter": "lsp"` formats on save with the server; *Language server
  output* shows its log.
- Projects of notes and of code (ADR-002, I1): the kind is guessed when a
  project is added (a `package.json`, `go.mod`, `Cargo.toml`… or a repository
  with no notes) and changed in its menu. A code project lists every file, its
  dot files too, opens a file that is not text in the system's program, and
  never commits a save on its own.
- `.gitignore` (with `.git/info/exclude` and the global excludes file) is
  followed in the tree, going to a file and searching, live as it is written.
- The **Changes** panel (`Ctrl+Shift+G` on every system, as in VS Code): the
  changed and the staged files, staged and unstaged a file at a time or all
  at once, a file's changes thrown away (asked first), a message and Commit
  (`Cmd/Ctrl+Enter`).
- A file under git edited in the code editor marks its changes against the
  last commit in the gutter as they are typed; a click on a mark shows what
  the lines were and takes the change back.
- **Who changed each line (blame)** among the commands: a column of authors
  and dates by the line numbers (the system git when there is one, else the
  file's history read by folio).
- Code navigation (ADR-002, I2): a file's symbols in the **Outline**, the
  one holding the caret marked; breadcrumbs above the code editor;
  `Cmd/Ctrl+Shift+O` goes to a symbol of the file, `Cmd/Ctrl+Alt+O` to one of
  every visible project; completion offers the projects' names.
- Tasks (ADR-002, I3): `Cmd/Ctrl+Shift+B` runs a script of `package.json` or
  `composer.json`, a `Makefile` target, a `justfile` recipe or a task of
  `.folio/settings.json` in a console tab of its own; the ones run lately come
  first.
- The **Problems** panel: errors and warnings read from a task's output (tsc,
  eslint, gcc/clang, go, rustc, ruff, mypy, pytest, psalm…), each a way to
  its place, and underlined in the code editor.
- Formatting on save with the project's formatter (prettier, pint, gofmt,
  ruff, rustfmt, black, or a command of its own), when `.folio/settings.json`
  asks for it.
- `.folio/settings.json`: a project's kind, indentation, tasks and
  formatting; `folio-data/keybindings.json`: keys of one's own for the code
  editor's commands and folio's.

## [1.1.0] - 2026-11-03

Code and other text files in folio's own code editor.

### Added
- Text files, diagram notations and AsyncAPI are edited in folio's own code
  editor (`@dskripchenko/code-editor`): highlighted as they are typed,
  folded, a data file checked while it is written; VS Code's keys —
  brackets and quotes that close themselves, comments, moving and copying
  lines, several cursors, completion from the file's words.
- The indentation of a file in a project comes from its `.editorconfig`, else
  from the file itself.
- The status line of a file in the code editor: the line and column, the
  indentation, the line breaks and the language.
- Go to a line: `Ctrl+G` on every system (also among the commands).
- The find bar searches a file in the code editor whole and marks the
  matches in it.

### Fixed
- A note's preview no longer closes under a resting pointer when the browser
  reports a leave that did not happen (the preview drawn again under it), nor
  stays open after leaving a link the document drew again.
- A row in a subfolder of the tree keeps the focus when a folder above it is
  drawn again (the disk reporting a move late): Delete and F2 still reach it.
- The divider between two documents ends where it is let go: the last moves of
  a fast drag are no longer lost.

### Changed
- Files up to 64 MB are edited (5 MB before); a bigger one is read.
- Off a Mac the next and the previous match are `F3` and `Shift+F3`, as in
  VS Code: `Ctrl+G` goes to a line there.

## [1.0.0] - 2026-11-03

The first release: portable builds for macOS, Windows and Linux.

### Fixed
- A PDF of a document whose drawings hold links (draw.io, diagrams) is
  exported again: the print page failed on their SVG links.
- A palette opened under a resting pointer no longer chooses the row under it.
- The tree no longer loses a name being typed, or shows a stale folder, when
  the disk reports changes late (macOS).
- The Markdown source is highlighted more fully (embed 1.13.1, syntax 0.3.3):
  links and badges in parts, quoted text, references, tables, inline HTML.
- The Markdown source is in colour (embed 1.13.0, markdown-editor 0.4.0), and an
  edit in the visual mode no longer rewrites the rest of the file: wrapped lines
  stay wrapped, a wrapped list item no longer becomes a loose list.
- A console's shell no longer gets the variables of the way folio was started
  (`npm_config_prefix` from `pnpm start` made nvm refuse to load).

### Added
- Portable builds: a zip for macOS (Apple Silicon and Intel) and Windows, an
  AppImage for Linux, each run unpacked in CI before it is published, with a
  `.sha256` and Sigstore provenance; a VirusTotal report in the release notes.
- Updates: the latest release looked for once a day at start (or from the
  settings), downloaded and checked against its checksum, and put in the
  program's place when folio closes; can be turned off.
- Whiteboards: `*.board` files drawn and drawn on as a whiteboard
  (@dskripchenko/board), kept as indented JSON; a new one from the commands.
- Slides: a note shown over the whole screen a slide at a time, split on its
  `---` lines (`F5`), and exported as PDF with one 16:9 page per slide.
- Boards and calendars: `*.kanban.md` and `*.calendar.md` files drawn and
  edited as a kanban board and a calendar, kept as markup; new ones from the
  commands.
- The tasks panel: the project's `- [ ]` tasks by when they are due, checked
  from the panel into their notes.
- Embedded notes: `![[Note]]` and `![[Note#Heading]]` drawn in the note
  (embed 1.18.0), an embed in an embed three deep, a loop left a link.
- The outline panel: the note's headings, live, a click going to one, the
  section in view marked. Search filters `tag:`, `path:`, `file:`.
- Aliases: `aliases:` in a note's properties work as its name in `[[links]]`
  (previews, the links panel and the graph too), and `[[` offers them.
- Spelling checked as text is written (the system's on macOS and Windows;
  on Linux when turned on), corrections in a field's menu; a status line with
  the document's words, characters, reading time and the caret's place.
- The graph of notes: the project's notes and their links, around the note in
  view or all of them; a point opens its note; zoom and pan.
- Bookmarks: files kept at hand above Shared — added from a tab, the tree or
  the commands; they follow a rename or a move.
- Daily notes (`Cmd/Ctrl+Shift+D`, the days before and after) and templates
  (inserted at the caret, or a new note from one; `{{title}}`, `{{date}}`,
  `{{time}}`, `{{date:FORMAT}}`); their folders chosen in the settings menu.
- Previews: the pointer resting on a link to a note shows it by the link, at
  the heading it names; a click there opens it (in the editor, with Cmd/Ctrl).
- Tags and properties (embed 1.17.0): `#tags` as chips, a note's front matter
  as a table of properties (kept as written in the editor); the tags panel —
  the project's tags, nested, with their notes and a filter; a tag in a note
  opens it.
- Formulas: TeX math (`$…$`, `$$…$$`, ` ```math `) drawn as MathML by the new
  `@dskripchenko/math` (embed 1.16.0); one piece in the visual editor, a double
  click edits its TeX; highlighted in the source. STIX Two Math (OFL) comes with
  folio for systems without a math font. `==highlighted==` text.
- Two documents side by side: **Open beside** in a tab's menu, `Cmd/Ctrl+\` or
  the command; each view with its own document and scroll, the divider dragged.
- Commands (`Cmd/Ctrl+K`, `F1`, **View → Commands**): every action of the menus
  and rails by its name, with its keys; the last used first.
- The links panel (the link icon on the right rail): the notes linking to the
  note in view, its own links (missing ones faded, made with a click), and the
  notes naming it without a link — each made a `[[link]]` with **Link**.
- Pictures pasted into a note or dropped on the editor (and chosen with its
  image button) are saved in `attachments/` beside the note and linked at the
  caret — by their name, or `Pasted image <time>` for a screenshot (embed 1.15.0).
- Links between notes: `[[Note]]`, `[[Note#Heading|text]]`, `![[picture.png]]`
  name a file of the project by its name (embed 1.14.0). A click opens it at the
  heading, or makes a missing note (drawn faded) beside the linking one; in the
  editor `Cmd/Ctrl`+click, and `[[` suggests the project's notes. Renaming or
  moving a note or folder in the tree updates the links to it — `[[…]]` and
  relative Markdown links — and the moved note's own relative links.
- Consoles (`` Ctrl+` ``, **View → Console**, the rail; **Open a Console Here**
  in a project's or folder's menu): your shell in a panel under the page, in
  tabs, in Shared or the folder chosen; full-screen programs and the mouse
  work; the panel's height is dragged, the theme followed. Drawn by the new
  package `@dskripchenko/terminal`, the shell in `node-pty`.
- Replace in files (the arrow before the query in the search panel): each
  match previewed, files ticked, **Replace all** asks once more with the count;
  `$1` groups with a regular expression, literal text without; files open with
  unsaved changes left out; one commit per folder that keeps a history.
- Search the files' text (`Cmd/Ctrl+Shift+F`, **Edit → Find in Files**, the
  magnifier on the rail): everything, Shared or one project, case / whole word
  / regular expression; matches stream in by file and line, a click opens the
  file with the find bar on that match. Binary files and files over 8 MB are
  passed over.
- Go to a file by its name (`Cmd/Ctrl+T`, **File → Go to File**): every file
  of Shared and the projects, ranked fuzzily as typed (a name's initials, the
  name before the folders); the list is kept per folder until a file comes or
  goes, dependencies and build output left out.
- Find in the document (`Cmd/Ctrl+F`, **Edit → Find**; `Cmd/Ctrl+G` and
  `Cmd/Ctrl+Shift+G` step): every match marked without touching the page,
  the current one brought into view, a count; case, whole word (any script),
  regular expression. The page as drawn in reading and the visual editor, the
  field in the Markdown source and text editing (the match selected there on
  Escape), the whole text of a big file; searched again when the page changes.
  In a code view the line numbers stay put when a line scrolls sideways.
- Code, data, logs and configuration files: listed in the tree and shown
  with numbered lines in the colours of their language, through the new
  package `@dskripchenko/syntax` (17 programming languages and 17 formats;
  the language by name, extension or `#!` line). Links to them open in folio.
- Data files are checked (`@dskripchenko/syntax` 0.2): JSON (with comments
  for tsconfig.json and the like, JSON Lines), YAML, XML, TOML, CSV/TSV, INI
  and `.env` — errors and warnings marked at their line numbers with the
  message on hover, a count in the head that steps through them (unfolding
  what hides one). Blocks fold by an arrow beside the line number: brackets,
  tags, indentation, Markdown sections.
- Big files (`@dskripchenko/syntax` 0.3): code, data and logs up to 200 MB;
  past 2 MB or 20 000 lines only the lines in view are drawn, highlighted
  from checkpoints (a 100 MB log opens in under a second); read-only past
  5 MB, a long line cut at 2 000 characters there. Logs filter by level —
  errors, warnings, info, debug, other — with a stack trace kept with its
  entry, and a log read at its end follows what is written to it.
- Code blocks in documents and in the editor are highlighted by the same
  `@dskripchenko/syntax` as source files (embed 1.12.0): some 35 languages
  instead of 17.

### Changed
- The view modes are one button on the rail: a click goes round Read → Edit
  visually → Markdown → beside the page, the icon shows the mode now, a
  right click lists them.
- Markdown, and Markdown beside the page, take the whole workspace edge to
  edge; side by side the halves meet at a line and scroll on their own (a
  drawing's source beside its picture too).
- The window: the page in the middle, the controls at its edges. The
  editor's toolbar floats over the page (embed 1.11, `toolbar-target`); the
  right rail switches Read / Edit visually / Markdown / Markdown beside the
  page and holds the history, print, PDF and settings (the theme); the
  sidebar has a header (open, new note, collapse), menus per section (**+**
  adds a folder or clones, **⋯**), file and folder icons, a branch chip, and
  collapses to a rail of initials whose trees slide out over the page.

### Added
- PDF (stage 7): **Export as PDF** (`Cmd/Ctrl+Shift+P`) — the active document
  as shown — and **Export Folder as PDF** (project and folder menus) — a
  folder as one PDF in the order of a book (index/README first, documents by
  name, subfolders), each document from a new page, links between them
  within the PDF. Page size, orientation, margins, the title at the top and
  page numbers at the bottom, a table of contents with links, bookmarks from
  the headings (tagged PDF), colours and backgrounds; remembered. Laid out in
  a hidden window, every widget in its print form (embed 1.10.2).
- Printing (stage 6): **File → Print** (`Cmd/Ctrl+P`) prints the active
  document read, without folio's chrome, on light paper, every widget in its
  print form from embed 1.10 (`DskEmbed.print.prepare`): diagrams whole, DMN
  with its tables, every draw.io page, flows and boards whole, an API
  reference as its static document, video as poster and chapters.
- Diagram and API files open directly (stage 5), each in its embed element:
  `.bpmn`/`.dmn` in `<dsk-bpmn>`/`<dsk-dmn>` and their editors, draw.io
  (`.drawio`, `.dio`, `.drawio.svg`) shown, OpenAPI/Swagger in the reference
  and its visual editor, AsyncAPI and the text notations (`.mmd`, `.puml`,
  `.dot`, `.d2`, `.dbml`, `.dsl`, `.wardley`) as source beside a live
  preview, other text as text. YAML/JSON are told apart by a top-level
  `openapi`/`swagger`/`asyncapi` key. Links to these files open them in a
  tab; the Open dialog and the tree offer them. An API without a server on
  the web gets no try-it and samples against `http://localhost` (not
  `folio://app`). Save As keeps a file's extension.
- The commit graph (stage 4c): beside the History list, lanes, merges and
  branches drawn as in Fork, by `@dskripchenko/diagrams` 1.4
  (`renderCommitGraph`). **This file** — the file's versions, their parents
  rewritten through commits that left it alone; **All commits** — every
  branch, remote branch and tag of the repository, named on its commit, the
  checked-out one marked.
- Branches and sync (stage 4b). The branch in the **History** panel lists the
  branches: switch (refused over changes it would overwrite) or create one.
  **Sync** fetches, fast-forwards or merges, and pushes, with ↑/↓ counts; a
  folder without a remote takes an address. **Clone Repository…** (File menu,
  ⤓ beside *Projects*) clones into a chosen folder and adds it as a project. A
  conflicting merge leaves git's markers in the text and stays open as git
  keeps it (`MERGE_HEAD`): the panel lists the files, **Finish the merge**
  (refused while a marker is left) or **Cancel the merge**; no commits on save
  meanwhile. The network goes through the system git when installed, else
  isomorphic-git over HTTPS with a user and token asked in the panel, kept
  encrypted by the system (`folio-data/logins.json`) or for the session only.
- History with git, per folder (stage 4a), through isomorphic-git (no git needed):
  **Keep a history** starts one (`git init`, a first commit); **Commit when
  saved** commits a saved file 3 minutes after its last save (one commit for a
  series), and at once when leaving folio — on by default for a history folio
  started, off for an existing repository. The **History** panel
  (`Cmd/Ctrl+Shift+H`) lists the file's versions; one opens as it was, as its
  changes against now (line by line), or side by side with now (drawn, with
  diagrams); **Restore** puts it into the editor as an unsaved edit. Commit now
  with a message. The tree marks changed files and folders and shows a project's
  branch. The author comes from git's config, else the system user. Commits
  compare content, not git's stat cache (a save in the same second still
  counts).
- Editing: `Cmd/Ctrl+E` turns a document into embed's `<dsk-markdown-editor>`
  (visual with every block live, Markdown, side by side) and back; Save, Save
  As, and quick notes (`Cmd/Ctrl+N`) named by their first line, saved into
  Shared by default.
- Unsaved work survives, as in Sublime Text: edits and notes are written to
  `folio-data/session/buffers` as you type — closing folio, a crash or a restart
  loses nothing, and the file changes only on Save. Closing an edited tab asks;
  closing folio does not. A file changed on disk during an edit is not
  overwritten: take it from disk, or keep your version and save over it.
- Shortcuts handled by the window on every system (the menus show them).
- The folder of every open document is watched, not only the workspace's.
- The workspace in a sidebar: Shared and the projects (any folders added to
  folio) — pinned first, then by group; a project's native menu pins, renames,
  groups, hides, reveals or removes it. Lazily listed file trees, folders first,
  documents only, expanded folders remembered; they follow the disk (recursive
  watching), and an open document is drawn again when its file changes.
  `Cmd/Ctrl+B` hides the sidebar, its width is dragged. Native menus speak the
  system's language (ru/en).
- Paths are compared as real paths: one file is one tab however it was reached.
- Reading: a Markdown file opens with every block of embed live — diagrams of
  all notations, OpenAPI and AsyncAPI, BPMN, draw.io, kanban, calendar, media —
  offline (embed is inside the app). Pictures, media and specifications load by
  relative path through `folio://`, from the document's folder, project or
  Shared and nothing outside it. Links to other documents open tabs; web links
  go to the system browser.
- The network rule: a document's requests to the web are blocked until you
  allow them for its file or folder (a banner says what was blocked).
- Opening: File → Open, dropping on the window, the command line, a second
  start; the open documents come back after a restart.
- The workspace model: Shared and projects (`folio-data/workspace.json`).
- The repository: an Electron window isolated from the system (context
  isolation, sandbox, a content security policy, no navigation away, links to
  the system browser), its data kept beside the program, CI on Linux, macOS and
  Windows with the built app started and checked.

[Unreleased]: https://github.com/dskripchenko/folio/compare/v1.8.2...HEAD
[1.8.2]: https://github.com/dskripchenko/folio/compare/v1.8.1...v1.8.2
[1.8.1]: https://github.com/dskripchenko/folio/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/dskripchenko/folio/compare/v1.7.1...v1.8.0
[1.7.1]: https://github.com/dskripchenko/folio/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/dskripchenko/folio/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/dskripchenko/folio/compare/v1.5.1...v1.6.0
[1.5.1]: https://github.com/dskripchenko/folio/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/dskripchenko/folio/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/dskripchenko/folio/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dskripchenko/folio/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/dskripchenko/folio/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/dskripchenko/folio/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dskripchenko/folio/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dskripchenko/folio/releases/tag/v1.0.0
