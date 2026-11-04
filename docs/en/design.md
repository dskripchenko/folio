# How it works

## Two kinds of process

folio is an Electron app, and Electron splits it in two:

- **The main process** owns the windows, the menus, the disk and the network
  rules. It is the only part that reads or writes files.
- **A document's window** draws the document. It runs with context isolation
  and Chromium's sandbox, without Node.js, under a content security policy that
  allows only folio's own scripts. What it may ask the main process for goes
  through a small bridge (the preload script) — open, save, read a file of the
  project — and nothing else.

## What a document may do


A Markdown file may come from anywhere, so the window treats it as untrusted:

- it sees the files of the folder it was opened from, served under a scheme of
  folio's own, and nothing outside that folder;
- it reaches the network — "Try it" in an API reference, a picture or a video by
  URL — only after you allow it for that file or folder;
- it cannot navigate the window to another page or open new windows; a link goes
  to the system browser.

## The window

The page takes the middle; the controls stay at its edges.

- **Left — the workspace.** Shared and the projects, each a tree of its
  documents. At the top: open a file, a new quick note, collapse. Each
  section has its own menu: Shared — its folder; Projects — **+** adds a
  folder or clones a repository, **⋯** shows the hidden projects. A
  repository's branch is a chip beside its name. **Collapsed** (`Cmd/Ctrl+B`)
  the sidebar is a narrow rail — Shared and each project as its initials — and
  a click slides that tree out over the page until a document is opened.
- **Top — the tabs**, nothing else.
- **The editor's toolbar floats over the page**, at hand however far down
  the text goes; the page itself has no frame. In **Markdown** the text takes the whole
  workspace, edge to edge; **beside the page**, the two halves meet at a line
  and scroll on their own.
- **Right — the rail.** One button shows how the document is shown and goes
  round the modes on a click — **Read**, **Edit visually**, **Markdown**,
  **Markdown beside the page** (a drawing offers read and edit; draw.io,
  read); a right click lists them to pick one. Then the history, print and PDF; settings at
  the bottom (the theme: as the system, light, dark).

## Opening documents

A Markdown file opens from **File → Open**, by dropping it on the window, from
the command line (`folio notes.md`), or — when folio is already running — by
starting it again with a file: the running one opens it. A link to another
document of the same folder opens that document in a tab. The open documents and
the active one come back after a restart.

### Diagram and API files

Not only Markdown: a diagram or an API description opens in a tab of its
own, drawn by its embed element, and links to such files in a document open
them too.

| File | Drawn by | Edited in |
|---|---|---|
| `.bpmn`, `.dmn` | `<dsk-bpmn>`, `<dsk-dmn>` | their editors: palette, context pad, properties, undo |
| `.drawio`, `.dio`, `.drawio.svg` | `<dsk-drawio>`, page tabs | — (shown only) |
| OpenAPI / Swagger (`.yaml`, `.yml`, `.json`) | `<dsk-openapi>`, the reference | its visual editor, with source and preview |
| AsyncAPI (`.yaml`, `.yml`, `.json`) | `<dsk-asyncapi>` | the source beside a live preview |
| `.mmd`, `.puml`, `.dot`, `.gv`, `.d2`, `.dbml`, `.dsl`, `.wardley` | `<dsk-diagram>`, the syntax by the extension | the source beside a live preview |
| code, data, logs, configuration — every text file with a known language (17 programming languages, JSON, XML, logs, TOML, INI, `.env`, CSV, diff, Dockerfile, Makefile, …) | numbered lines in the colours of its language (`@dskripchenko/syntax`; the language by name, extension or `#!` line); a data file (JSON, YAML, XML, TOML, CSV, INI, `.env`) checked — errors marked at their lines, a count in the head steps through them; blocks fold by the arrows beside the numbers; a big file (over 2 MB or 20 000 lines, up to 200 MB) draws only the lines in view and is read-only past 64 MB; a log filters by level (a stack trace stays with its entry) and, read at its end, follows what is written | the code editor |
| other text | as text | the code editor |

The **code editor** (`@dskripchenko/code-editor`) edits every text file, a
diagram's notation and AsyncAPI beside their preview: highlighted as it is
typed, folded by the arrows beside the numbers, a data file checked while it
is written. Its keys are VS Code's — brackets and quotes close themselves,
`Cmd/Ctrl+/` comments lines, `Alt+↑/↓` moves them, `Cmd/Ctrl+D` adds the next
occurrence to the cursors, `Ctrl+Space` completes from the words of the file.
The indentation comes from the project's `.editorconfig`, else from the file
itself; the status line shows the line and column, the indentation, the line
breaks (LF or CRLF, kept as they came) and the language. Files up to 64 MB
are edited; a bigger one is read.

YAML and JSON are recognised by a top-level `openapi`, `swagger` or
`asyncapi` key; the tree lists YAML files and JSON files named like an API
description (`openapi.json`), not every `package.json`. An API without a
server on the web gets no try-it, and its request samples name
`http://localhost`. Saving, unsaved edits that survive a restart, the
history and its comparisons work for these files as for Markdown.

## Shared and projects

The workspace has two parts: **Shared**, one folder for the documents common to
everything (by default `folio-data/library`, or a folder of your choice), and
**projects** — any folders on disk added to folio. The list lives in
`folio-data/workspace.json`; the folders stay where they are. A document of a
project or of Shared may read the files of that whole folder; a file opened on
its own may read its own folder.

The sidebar shows Shared and the projects: pinned projects first, then by
group, then the rest; a project's menu (right click) pins it, renames it, puts
it in a group, hides it or removes it from folio (the folder stays on disk).
The trees list folders and the files folio opens, folders first, and follow the
disk: a file added, changed or removed elsewhere shows at once, and an open
document is drawn again. `Cmd/Ctrl+B` hides the sidebar.

In the code editor a file's **symbols** — functions, classes, methods, types,
constants; a config's keys and sections — are read as it is typed: the
**Outline** (right rail) lists them, the one holding the caret marked, a click
going to it; breadcrumbs above the text show the file's project and folders,
then the symbols holding the caret; `Cmd/Ctrl+Shift+O` goes to a symbol of the
file by name and `Cmd/Ctrl+Alt+O` to one of every visible project (its file
opened in the editor at it). Completion offers the projects' names besides the
file's own words.

**Tasks** (`Cmd/Ctrl+Shift+B`, or *Run a task* among the commands) are the
project's own: the scripts of `package.json` (run by the package manager its
lockfile names) and `composer.json`, the targets of a `Makefile`, the recipes of
a `justfile`, and the tasks of `.folio/settings.json`; the ones run lately come
first. A task runs in a console tab of its own named after it, which ends when
it does. Its output is read for **problems** — `path:line:col: message` (gcc,
clang, go, ruff, mypy, pytest, eslint's unix form), tsc, eslint's stylish
blocks, rustc, psalm — shown in the **Problems** panel (right rail, opened when
a task finds some), each a way to its place, and underlined in the code editor.

A project of code may **format on save** with its own formatter — prettier
(the project's), pint, gofmt, ruff, rustfmt, black, or a command of its own
reading the text on stdin — when `.folio/settings.json` asks for it; only what
the formatter changed is changed, undone as one step.

`.folio/settings.json` at a project's top holds its own settings, written by
hand (and committed with it, if its people want):

```json
{
  "kind": "code",
  "indentUnit": "  ",
  "tabSize": 2,
  "formatOnSave": true,
  "formatter": "prettier",
  "tasks": [{ "name": "serve", "command": "php artisan serve" }],
  "lsp": { "php": ["phpactor", "language-server"], "python": false }
}
```

The kind is taken over the guessed one, the indentation over `.editorconfig`'s.
Keys of one's own go in `folio-data/keybindings.json`, without a window for
them: `[{ "key": "Mod-Shift-d", "command": "copyLineDown" }, { "key":
"Mod-Alt-p", "command": "folio.problems" }]` — the code editor's commands by
their names, folio's by `folio.` and their command's id; in the editor its own
win over folio's shortcuts.

**Language servers** (LSP) understand the code in the editor where one is on
the machine: `typescript-language-server`, `intelephense` or `phpactor`,
`pyright` or `pylsp`, `gopls`, `rust-analyzer`, `clangd` — none ships with
folio. A file of a language starts its server for the project (stopped a few
minutes after its last file closes); the project's own one (`node_modules/.bin`,
`vendor/bin`, `.venv/bin`) runs only once the project is trusted, asked once.
Then problems are underlined as they are typed and listed in **Problems**; the
pointer resting on a name tells what it is; `F12` or `Cmd/Ctrl`+click goes to
its definition, `Shift+F12` lists its references, `F2` renames it across the
project (open files changed in their tabs, one undo each), `Cmd/Ctrl+.` offers
the server's fixes; completion takes the server's items first, a call's
parameters show after `(` (`Cmd/Ctrl+Shift+Space`), and the outline and
breadcrumbs come from the server. The status line names the server, or what to
install for one; *Language server output* among the commands shows its log.
`"lsp"` in `.folio/settings.json` gives a language a command of its own, or
`false` to have none; `"formatter": "lsp"` formats on save with the server.

**Pictures, video and sound** open in a tab of their own: PNG, JPEG, GIF,
WebP, AVIF, BMP and icons fitted to the view (a small one at its own size),
zoomed with `Cmd/Ctrl` and the wheel or a pinch about the pointer, `+`, `−`,
`0` (fit) and `1` (actual size), a double click going between the two, dragged
when larger than the view, transparency over a chequerboard; MP4, WebM, MOV and
MKV in the video player, MP3, WAV, OGG, Opus, M4A, AAC and FLAC in the sound
player with its waveform. The status line gives the size, the length and the
bytes; the bar under the file opens it in the system's program, as a file
Chromium cannot decode offers by itself. An SVG is drawn, and edited as text
beside its picture, which follows what is written. They are listed in the
trees of notes too, but never read as text: searching, a folder's PDF and the
history's versions pass them over.

A project is of **notes** or of **code** — guessed when it is added (a
`package.json`, `composer.json`, `go.mod`, `Cargo.toml`… at its top, or a git
repository with no notes beside its README makes it code) and changed in its
menu. A project of code lists every file, its dot files too (`.github`,
`.editorconfig`), and a file that is not text (but a picture, a video or a
sound, shown in folio) opens in the system's program;
a save there is never committed on its own — commits are made by hand. In a
folder under git, what `.gitignore` leaves out (with `.git/info/exclude` and
the user's global excludes file) is left out of the tree, going to a file and
searching, and the tree follows a `.gitignore` as it is written; a folder
without git keeps folio's own list of tooling folders (`node_modules`,
`vendor`, `dist`…).

### Files and folders

The tree makes and changes files too: **New Note** and **New Folder** in a
folder's or a project's right-click menu (and in Shared's **…** menu) — the name
typed in place, a note opened at once with its title as a heading; **Rename…**
(or `F2`) edits the name in its row, the extension kept; a file or folder
dragged onto a folder (or a project) moves there; **Duplicate** makes a copy
beside it; **Move to Trash** (or `Delete`, `Cmd+Backspace`) asks first and puts
it in the system's trash, from where it can be put back. Open documents follow
a rename or a move; a document put in the trash closes, unless it has unsaved
changes. A name with `/ \ : * ? " < > |` or one already there is refused in
place, with the reason.

### Two documents side by side

**Open beside** in a tab's menu (or `Cmd/Ctrl+\`, or the command) shows that
document in a second view to the right; the main view keeps another tab. Each
view keeps its own document and scroll; a click in a view puts its document in
use, and the panels, find and the history follow it. The divider between the
views is dragged, and the share is kept. **Back to the main view** (or
`Cmd/Ctrl+\` again) closes the side view, the document staying open in a tab;
closing its tab closes the view too. Printing prints the document in use only.

### Links between notes

`[[Note]]` links to a note by its name, wherever it lies in the same project
(or Shared): the note's own folder first, then the shortest path. `[[Note#Heading]]`
opens it at that heading, `[[Note|text]]` shows other text, `![[picture.png]]`
shows a picture. A link to no note is drawn faded; a click makes the note beside
the linking one and opens it. In the editor a link opens with `Cmd/Ctrl`+click,
and typing `[[` suggests the project's notes. A note or folder renamed or moved
in the tree takes its links along: `[[…]]` links and relative links
(`[text](notes/plan.md)`, pictures) in the project's notes are written anew, and
so are the moved note's own relative links; notes open with unsaved changes are
left as they are.

**The links panel** (the link icon on the right rail) shows, for the note in
view, the notes linking to it, its own links — a missing one faded, a click
makes it — and the notes that name it without a link; **Link** turns such a
mention into `[[Note]]` (the spelling kept as its text). A line clicked opens
its note there. The panel follows the note in view and what is typed.

### Daily notes and templates

`Cmd/Ctrl+Shift+D` (or **Today's note** among the commands) opens the note of
the day — `YYYY-MM-DD.md` in the daily notes folder (`Daily` in Shared unless
chosen otherwise) — made when missing, from the `Daily` template when there is
one. **The daily note before / after** goes to the nearest one that exists. A
template is a note in the templates folder (`Templates` in Shared):
**Insert a template…** puts it at the caret, **New note from a template…** makes
a quick note of it; `{{title}}`, `{{date}}`, `{{time}}` and `{{date:DD.MM.YYYY}}`
are filled in. Both folders are chosen in the settings menu.

`![[Note]]` embeds another note in this one — drawn as when read, in a frame
with its link; `![[Note#Heading]]` embeds that heading's section. An embed
inside an embed is drawn too (three deep), a note embedding itself stays a
link, and in the editor an embed is its link, kept as written.

A note's other names — `aliases:` in its properties (`aliases: [Road map]`) —
work as its name in links: `[[Road map]]` reaches it when no file is named so,
and `[[` offers them, writing `[[Roadmap|Road map]]`.

### The outline

The outline panel (on the right rail, or among the commands) lists the
headings of the note in view, indented by level, as it is written; a click
goes to one — the caret on its line in the source — and the section in view
is marked as the page scrolls.

### Spelling and the status line

Spelling is checked as text is written — by the system on macOS and Windows,
offline; on Linux Chromium fetches the dictionaries, so it is off until
turned on in the settings menu. A field's menu offers corrections, **Add to
the dictionary**, and cut, copy and paste. Under the page the status line
shows the document's words, characters and minutes to read it, and in the
Markdown source the caret's line and column.

### The graph

The graph panel (on the right rail, or among the commands) draws the notes of
the project in view as points and their links as lines — **This note**: the
notes up to two links from the one in view, **All**: the whole project. A
point's size is its number of links, the note in view is coloured; the
pointer on a point lights it and its neighbours, a click opens it; the wheel
zooms and a drag moves the picture.

### Bookmarks

A file kept at hand: **Add to bookmarks** in a tab's menu, a file's menu in the
tree, or among the commands. The bookmarks are listed above Shared; a click
opens one, its menu lets it go. A bookmark follows its file renamed or moved
in folio; one whose file is gone elsewhere stays, faded.

### Boards and calendars

A `*.kanban.md` file opens as a kanban board, a `*.calendar.md` file as a
calendar — both written as markup any editor can read (columns `## …` and
cards `- …`; events `2026-11-03 10:00 …`, repeats `every mon …`). **Edit**
makes them editable on themselves: cards dragged and added, events moved, the
source in a tab of their own; the file keeps the markup, changed only where
the edit was. **New kanban board** and **New calendar** among the commands
make one beside the note in view.

### Whiteboards

A `*.board` file opens as a whiteboard (`@dskripchenko/board`): sticky notes,
shapes, text, frames, connectors, emoji, pen and marker on an endless canvas.
**Edit** draws on it; the file keeps the board's JSON, indented, so a diff
shows what moved. **New whiteboard** among the commands makes one beside the
note in view.

### Tasks

The tasks panel (on the right rail, or among the commands) lists the `- [ ]`
tasks of the project in view by when they are due — **Overdue**, **Today**,
**Later**, **No date** — and with **All** the done ones too; a day is written
`📅 2026-11-10`, `@2026-11-10` or `due:2026-11-10`. A task is checked or
unchecked from the panel, in its note (not one open with unsaved changes); its
text opens the note there.

### Slides

**Show as slides** (`F5`, or among the commands) shows the note in view over
the whole screen, a slide at a time: the slides are its parts between `---`
lines with an empty line before them (outside code and the properties, as in
Marp and reveal.js). The arrows, Space, Page Up/Down, Home and End, or a click
on the left or right half go through them; Escape ends the show. **Export the
slides as PDF** (among the commands, or on the show's bar) writes one 16:9
page per slide.

### Previews

The pointer resting on a `[[link]]` or a link to a note shows the note in a
panel by the link — drawn as when read, at the heading the link names. The
panel scrolls; a click in it opens the note; moving away, or Escape, closes
it. In the editor the preview waits for `Cmd/Ctrl`.

### Tags and properties

`#todo`, `#work/urgent` in a note are tags (a letter is needed: `#123` is not
one, nor is `C#`); the `tags:` of its properties too. A note's properties — a
YAML front matter at its start, `---` lines around `key: value` — are shown as
a table above it, and kept exactly as written in the editor. The tags panel
(the tag icon on the right rail, or the command) lists the tags of the
project in view with the number of their notes, nested ones under their
parents; a tag opened shows its notes, a click opens one; the filter finds a
tag by its name. A tag clicked in a note opens the panel on it (in the editor,
with `Cmd/Ctrl`).

### Formulas and highlights

TeX math is drawn as it is read: `$E = mc^2$` in a line, `$$ … $$` (or a
` ```math ` block) on lines of its own — by folio's own `@dskripchenko/math`,
as MathML. A price (`$5 or $10`) stays text. In the visual editor a formula is
one piece: a double click edits its TeX, **Formula** in the `/` menu adds one,
and the file keeps it exactly as written; the Markdown source colours its TeX.
Fences and roots stretch in a math font: the system's (macOS, Windows), or
STIX Two Math, which folio carries (SIL Open Font License). `==text==` is
highlighted.

### Pictures

A picture pasted into a note (a screenshot, an image copied) or dropped on the
editor — the visual mode or the source — is saved in `attachments/` beside the
note and linked where the caret is: by its own name, or `Pasted image` and the
time for a nameless screenshot; a name already taken gets a number. The
editor's image button picks pictures from the disk the same way. A quick note
not yet saved says to save it first, as its pictures need a folder.

## History with git

Per folder — Shared and each project — and only if you want it. A folder that
is a git repository (or lies inside one) shows its history at once; another
starts one with **Keep a history** in the **History** panel (`Cmd/Ctrl+Shift+H`):
a repository on branch `main` and a first commit of what is there.

- **Commit when saved** — on for a history folio started, off for a repository
  that was there already (folio does not commit into a project on its own). A
  saved file is committed 3 minutes after its last save, so a series of saves
  makes one commit; leaving folio commits what is waiting at once. Only the
  saved file is committed, as *Update <path>*; **Commit** with a message of your
  own does it now.
- **Versions** of the open file, newest first. One opens read-only, as it was;
  **Changes** shows its difference from now line by line, **Side by side** the
  two drawn documents, diagrams included. **Restore this version** puts its text
  into the editor as an unsaved edit — saving it is your call.
- **In the tree**: changed files are marked, a folder with changes inside gets
  a dot, a project shows its branch.
- The author is `user.name` / `user.email` of the repository's config, then of
  `~/.gitconfig`, else the system user.

git is inside folio (isomorphic-git, pure JavaScript), so this works on a
machine without git.

### Changes

`Ctrl+Shift+G` on every system (or the commit button on the right rail) opens
**Changes**, as a code editor's source control: the files changed in the
working folder and the ones staged for the next commit, each with its letter
(**A**dded, **M**odified, **D**eleted, **U**ntracked). A file goes into the
index and out of it with its `+` and `−` (or all of them at once from the
group's heading), its changes are thrown away with the arrow — asked first,
it cannot be undone — and its name opens it. A message and **Commit** (or
`Cmd/Ctrl+Enter`) commit what is staged. The panel follows the document in
view and looks again as the disk changes. In a project of code this is how
commits are made: a save there never commits on its own.

### Changes in the gutter, who changed a line

A file under git edited in the code editor marks its changes against the last
commit beside the line numbers as they are typed: a green bar for added lines,
a blue one for changed lines, a red notch where lines were deleted. A click on
a mark shows what the lines were, with **Revert** to take that change back.
**Who changed each line (blame)** among the commands adds a column by the
numbers — the author and how long ago, the commit's message, author and date
on hover; the same command takes it away. It uses the system git when there
is one, else reads the file's history itself.

### Branches and sync

- **Branches**: the branch name in the panel opens the list — switch to one, or
  create a new one from where you are. A switch is refused while files have
  changes it would overwrite (commits waiting for their pause are made first).
- **A remote**: a folder without one takes an address in the panel; a
  repository cloned in folio (**File → Clone Repository…**, or ⤓ beside
  *Projects*) has its own and becomes a project with **Commit when saved** on.
- **Sync** fetches, takes the remote's commits — a fast-forward, or a merge
  commit when both sides moved — and sends yours; the button shows how many go
  each way (↑ ↓). It wants every change committed first.
- **A conflict** stays in the text, the way git leaves it: both versions
  between `<<<<<<<` and `>>>>>>>` lines, the files listed in the panel. Edit
  them (in folio or anywhere), save, and **Finish the merge** — refused while
  a marker is left; **Cancel the merge** returns to your version. The merge is
  kept as git keeps one (`MERGE_HEAD`), so the system git sees it too, and no
  commit is made on save until it is finished.
- **The network**: through the system's git when it is installed — its
  credential helpers and SSH keys work as in a terminal (it never stops to ask
  for a password in a terminal nobody sees). Without it, folio speaks HTTPS
  itself: when the remote asks for a login, the panel takes a user and a token,
  kept encrypted by the system (Keychain, DPAPI, the Secret Service) in
  `folio-data/logins.json` — or for the session only where the system has no
  encryption. Sync is an action you take, so it does not need the network
  consent of documents.

### The commit graph

Beside the list, a graph as in Fork: a lane per line of development, merges
as rings joining lanes, branches running beside their base until they bend
back in. **This file** shows the file's versions, their lines drawn through
the commits that left the file alone (as `git log -- file` simplifies
history); **All commits** shows the whole repository — its branches, the
remote's as last fetched and the tags, named on their commits, the
checked-out one marked. Choosing a commit opens the file as it was then. The
graph is drawn by `@dskripchenko/diagrams` (`renderCommitGraph`).

## Tabs, tables, comparing, exporting, settings

**Tabs.** `Cmd/Ctrl+Shift+T` brings back the tab closed last — at its place in
the row, in its view, scrolled where it was. A tab is dragged to another place
in the row, onto the right half of the view to open it beside the main one,
and back onto the left half.

A tab's menu closes it, the others, those to its right, the saved ones or all
(`Cmd/Ctrl+Shift+W`); saved tabs go first, then each with changes is asked
about, and a Cancel stops there. A tab may have a colour of its own and belong
to a group: a chip with a name and a colour before its tabs, which stand
together and are underlined in that colour. A click on the chip folds the
group (its tabs hidden, their number shown); a tab joins a group from its menu
or by being dropped on the chip or between the group's tabs. The chip's menu
renames, recolours, ungroups or closes the group. Colours and groups are kept
in the session.

**Embeds of files.** `![[photo.png]]`, `![[clip.mp4]]`, `![[song.mp3]]` and
`![[report.pdf]]` show the file in the note, found by its name anywhere in the
project (as a link is); `![[photo.png|300]]` or `|300x200` sizes it. A click on
a picture opens it in its tab; the pointer resting on a link to one shows it.

**Long lines** wrap at the view's width in prose (plain text, Markdown, logs)
and not in code; `Alt+Z` (or *Wrap long lines* among the commands) changes it
for the editor in view and remembers it for that kind of text.

**PDF** opens in its tab in Chromium's own viewer: pages, zoom, search, its
outline, printing.

**CSV and TSV** are read as a table: the separator guessed, the header kept in
view, a click on a column sorting by it (numbers by value), a thousand rows at
a time; the source is edited in the code editor.

**Two files compared**: *Select for compare* on one in the tree, then *Compare
with* on the other — or *Compare the file with…* among the commands for the
file in view. The changes, side by side, or the other file drawn; *Take its
text* puts it into the editor.

**Export.** *Export as HTML* writes one page with its pictures and diagrams
inside and folio's look; *Export as Word (DOCX)* writes headings, emphasis,
links, lists, quotes, code, tables and pictures, diagrams as pictures.

**Git beyond committing.** In Changes: the box under the message amends the
last commit (its message to start from); the save button puts every change
aside, new files too (a stash, named by the message) — the list under the
changes takes them back or deletes them. In the history: a commit's menu
undoes it with a new commit (revert) or tags it (`v1.2.0 The message` makes
an annotated tag); a tag goes out with the next sync. Branches are renamed and
deleted in the branch menu. Stash and revert need git installed.

**Settings** (`Cmd/Ctrl+,`, or the settings menu): every command of folio and
of the code editor with its keys — *Set a key* takes the keys pressed (kept in
`keybindings.json` with `Mod`, so the file works on every system), a clash is
shown; and the project's `.folio/settings.json` as a form, every key folio does
not know kept.

## Languages and the welcome page

folio speaks English and Russian out of the box: the system's language, or the
one chosen in the settings menu (at once, kept). Every text is a JSON
dictionary (`src/locales/<code>.json`: `meta`, `main` for the menus and
dialogs, `window`, `print`); another language is one more such file — in the
repository, or in `folio-data/locales/<code>.json` without rebuilding folio.
What it leaves out is English; forms of a number are a list in the order of
`Intl.PluralRules` (`["{n} file", "{n} files"]`, or one, few, many).

*What folio can do* (the commands, the Help menu, the empty window) opens a
read-only page with every kind of block drawn live; it opens by itself on the
first start, in the language in use.

## Unsaved changes and quick notes

As in Sublime Text: an untitled tab is a quick note, and an edit you have not
saved does not reach the file. Both are written to `folio-data/session/` as you
type, so they survive closing folio, a crash and a restart of the computer, and
come back exactly as they were. A tab with unsaved changes is marked with a dot.
Closing such a tab asks whether to save; closing folio asks nothing — it is all
on disk already. If the file changes on disk while you edit it, folio says so
and keeps both: take the file from disk, or keep your version and save over it.
A quick note is saved with **Save** into Shared (or anywhere), named by its
first line.

## Printing

**File → Print** (`Cmd/Ctrl+P`) prints the active document as a document:
read, not edited; folio's sidebar, tabs, buttons and history stay off paper,
and paper is light whatever the screen is. Every widget prints in its print
form from embed (`DskEmbed.print.prepare`): a BPMN or DMN diagram whole (a
DMN file with its decision tables), every draw.io page, a flow or a board
whole, an API reference as its static document, a video as its poster and
chapters, a kanban or a calendar without their controls. The system's print
dialog follows; a PDF is saved through Export as PDF (below).

### PDF

**File → Export as PDF** (`Cmd/Ctrl+Shift+P`) saves the active document —
as shown, unsaved edits included — and **Export Folder as PDF** (the menu of
a project or of a folder in the tree) saves a whole folder as one PDF. The
dialog asks once and remembers:

- page size (A4, A3, A5, Letter, Legal, Tabloid), portrait or landscape,
  margins (none, narrow, normal, wide);
- the title at the top of each page, page numbers (`3 / 12`) at the bottom;
- a table of contents with links, before the text; bookmarks from the
  headings (the PDF's outline, in a tagged PDF);
- the drawings' colours and backgrounds.

A folder prints in the order of a book: in each folder its `index.md` or
`README.md` first, then its documents by name, then its subfolders; each
document from a new page, diagram and API files with their names as
headings. A link from one document to another becomes a link within the
PDF. The pages are laid out in a hidden window of the documents' session —
the network consent holds there too — with every widget in its print form,
then Chromium prints them to PDF.

## Editing

`Cmd/Ctrl+E` (or **Edit** on the bar) turns a document into the editor and back.
The editor has three modes: visual (a word-processor editing with the toolbar,
the `/` menu and every block live), Markdown itself, and the two side by side.
The file stays Markdown: what the visual mode cannot hold — headings below h3,
task lists, callouts, HTML — is kept as written, and pictures keep their
relative paths.

| Keys | |
|---|---|
| `Cmd/Ctrl+N` | a quick note |
| `Cmd/Ctrl+O` | open a file |
| `Cmd/Ctrl+S`, `Cmd/Ctrl+Shift+S` | save, save as |
| `Cmd/Ctrl+E` | edit / read |
| `Cmd/Ctrl+W` | close the tab |
| `Cmd/Ctrl+B` | the sidebar |
| `Cmd/Ctrl+T` | go to a file by its name |
| `Cmd/Ctrl+K`, `F1` | the commands: any action by its name |
| `Cmd/Ctrl+Shift+D` | today's note |
| `Cmd/Ctrl+\` | the document beside the main view, or the side view closed |
| `Cmd/Ctrl+Shift+F` | search the files |
| `Cmd/Ctrl+F` | find in the document |
| `Cmd+G`, `Cmd+Shift+G` (macOS); `F3`, `Shift+F3` | the next match, the previous |
| `Ctrl+G` | go to a line, in the code editor (on every system) |
| `Ctrl+Shift+G` | the changes: staged, committed (on every system) |
| `Cmd/Ctrl+Shift+O`, `Cmd/Ctrl+Alt+O` | a symbol of the file, of the projects |
| `Cmd/Ctrl+Shift+B` | run a task of the project |

Filters narrow the files searched: `tag:work` (nested tags too), `path:notes/`,
`file:plan` (a value in quotes may have spaces); with no text left, a filter
alone lists its files.

## Finding

`Cmd/Ctrl+Shift+F` (**Edit → Find in Files**, or the magnifier on the right
rail) opens a panel beside the page that searches the text of the files — all
of them, Shared or one project — with the same three options. Matches come in
as they are found, by file, each line with its match; a click opens the file
and lands the find bar on that match. Binary files, files over 8 MB and the
folders left out of going to a file are not searched; at most 200 matches a
file and 5 000 in all are listed.

The arrow before the query opens **Replace**: each match shows what it
becomes, files are ticked to take part, and **Replace all** asks once more
with the count before it writes. With a regular expression `$1`, `$&` and the
like name its groups; without one the text is taken as it is. A file open with
unsaved changes is left out (said so), so neither side is lost; an open file
without changes shows the new text. A folder that keeps a history gets one
commit for the replacement — `Replace "a" with "b"` — not a commit per file.

`Cmd/Ctrl+K` or `F1` (**View → Commands**) opens a palette of folio's actions —
those of the menus and the rails — found the same way by their names, each with
its keys; the ones used lately come first, and the ones that cannot run now
(saving with no document open, the mode already on) are not offered.

`Cmd/Ctrl+T` (**File → Go to File**) opens a palette of every file folio opens
in Shared and the visible projects, ranked as the name is typed: the
characters in order, not necessarily together — `rn` finds
`release-notes.md`, a word's first letters count most, a match in the name
more than one in the folders. Arrows choose, Enter opens, Escape leaves. The
list is walked once per folder and kept until a file is added or removed
there; folders of dependencies and build output (`vendor`, `dist`, `build`,
`target`, `coverage`…) are left out of it, though the tree shows them.

`Cmd/Ctrl+F` (**Edit → Find**) opens a bar over the page: every match is
marked, the current one brought into view; Enter and Shift+Enter step through
them, the count shows where you are. **Aa** matches case, **ab** whole words
(of any script), **.\*** takes a regular expression. Reading and the visual
editor search the page as drawn — a match never runs from one paragraph into
the next, and the page itself is not touched; the Markdown source searches its
field and a file in the code editor its whole text, the matches marked in it, and
Escape leaves the current match selected there; a big file is searched whole, not only the lines in view. A page that
changes under the bar — an edit, the file changed on disk — is searched again.

## Consoles

`` Ctrl+` `` (**View → Console**, or the console button on the right rail) opens
a panel under the page with your shell — zsh or bash as your terminal starts
it, PowerShell on Windows — in Shared; **Open a Console Here** in a project's
or a folder's menu opens one in that folder. Tabs keep several; **+** opens
another in the same folder, a tab's × ends its shell. Full-screen programs —
`vim`, `htop`, `less`, `mc` — work as in a terminal app, with the mouse where
they ask for it; the panel's height is dragged by its top edge, and it follows
the window's light or dark theme. Off a Mac, Ctrl with a letter in a console
is the shell's (^W, ^E, ^P…), not folio's shortcut — except Ctrl+F, which finds in the output. The consoles end with the
window.

With zsh, bash and PowerShell, folio adds a little to the shell's start (after
your own startup files, which run as always): each command gets a mark beside
its prompt — green when it succeeded, red when it failed, pulsing while it runs;
hover for the command, its exit code and how long it took; a click selects its
output. The tab shows what runs and the folder (it follows `cd`), a dot when a
command failed or a tab not in front printed something. `Cmd+↑`/`Cmd+↓`
(`Ctrl+Shift+↑`/`↓` off a Mac) go from command to command, `Cmd+K`
(`Ctrl+Shift+K`) clears, `Cmd+D` (`Ctrl+Shift+D`) opens a second console beside
the first; `Cmd+F` in a console finds in its output. A path in the output —
`src/app.ts:12:3` — opens in folio at its line with Cmd (Ctrl) and a click; a
file dragged from the tree (or the system) is typed as its path. The right
click has copy, paste, select all, find, clear, split, the panel beside the page
or on the whole window. `FOLIO_SHELL_INTEGRATION=0` starts shells as they are. Drawn by `@dskripchenko/terminal`; the shell runs in `node-pty`.

## Where the data lives

Electron keeps its data in the user profile by default. folio moves all of it —
settings, caches, session data, logs — to `folio-data/` beside the program:

| How it runs | `folio-data/` is |
|---|---|
| Windows | beside `folio.exe` |
| macOS | beside `folio.app` |
| Linux | beside the `.AppImage` file |
| `FOLIO_DATA` is set | that directory |
| from the sources | `.folio-data/` in the working directory |

Deleting the program's folder therefore removes everything it ever wrote. The
flip side: the folder must be writable, so do not unpack folio into a place
only an administrator can write to.

## Updates

Once a day at start folio looks at the latest release on GitHub. A newer
version is downloaded into `folio-data/update/`, checked against the
`.sha256` published beside it and unpacked there; it takes the program's
place when folio closes — the `.app` or the AppImage renamed into place, on
Windows the folder's files copied over once folio has exited (`folio-data/`
left alone) — or at once with **Restart to update** in the settings. Nothing
runs in the background. **Check for updates** looks now; **Look for updates
daily** turns the daily look off.

The checksum proves that the archive is the one the release names, whole; it
comes over TLS from the same release, so it does not prove who made the
release. That is what the build's provenance is for:
`gh attestation verify folio-….zip --repo dskripchenko/folio`.

## One window at a time

A second start brings the running folio to the front instead of starting a
second copy; documents open as tabs of that window.
