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
| code, data, logs, configuration — every text file with a known language (17 programming languages, JSON, XML, logs, TOML, INI, `.env`, CSV, diff, Dockerfile, Makefile, …) | numbered lines in the colours of its language (`@dskripchenko/syntax`; the language by name, extension or `#!` line) | the source |
| other text | as text | the source |

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

## One window at a time

A second start brings the running folio to the front instead of starting a
second copy; documents open as tabs of that window.
