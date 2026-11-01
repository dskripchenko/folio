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

## Opening documents

A Markdown file opens from **File → Open**, by dropping it on the window, from
the command line (`folio notes.md`), or — when folio is already running — by
starting it again with a file: the running one opens it. A link to another
document of the same folder opens that document in a tab. The open documents and
the active one come back after a restart.

## Shared and projects

The workspace has two parts: **Shared**, one folder for the documents common to
everything (by default `folio-data/library`, or a folder of your choice), and
**projects** — any folders on disk added to folio. The list lives in
`folio-data/workspace.json`; the folders stay where they are. A document of a
project or of Shared may read the files of that whole folder; a file opened on
its own may read its own folder. (The sidebar to manage them comes with stage 2.)

## Unsaved changes and quick notes

As in Sublime Text: an untitled tab is a quick note, and an edit you have not
saved does not reach the file. Both are written to `folio-data/session/` as you
type, so they survive closing folio, a crash and a restart of the computer, and
come back exactly as they were. (With editing, stage 3.)

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
