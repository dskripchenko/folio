![folio](build/icons/png/128.png)

# folio

[![tests](https://img.shields.io/github/actions/workflow/status/dskripchenko/folio/tests.yml?branch=main&label=tests)](https://github.com/dskripchenko/folio/actions/workflows/tests.yml)
[![release](https://img.shields.io/github/v/release/dskripchenko/folio?label=release)](https://github.com/dskripchenko/folio/releases/latest)
[![license](https://img.shields.io/github/license/dskripchenko/folio?label=license)](https://github.com/dskripchenko/folio/blob/main/LICENSE)

A desktop app to read, edit and print Markdown — with live diagrams of every
notation, OpenAPI and AsyncAPI references, BPMN and DMN, draw.io, process
flows, kanban boards, calendars and whiteboards, slides — on macOS, Windows and Linux, without
installing anything.

> Status: **1.1.** It reads a Markdown file with every block live, offline;
> edits it visually or as Markdown, keeping quick notes and unsaved edits
> through restarts; keeps a git history per folder; links notes with
> `[[links]]`, tags, aliases, embeds, a graph and a tasks panel; opens diagram,
> API, kanban, calendar and whiteboard files in their editors; shows a note as
> slides; edits code and other text files in its own code editor —
> highlighting, folding, checks and VS Code's keys; prints and exports PDF;
> runs consoles; and updates itself.

Documentation: [English](docs/en/) · [Русский](docs/ru/) · [Deutsch](docs/de/) ·
[中文](docs/zh/)

## Download

From the [latest release](https://github.com/dskripchenko/folio/releases/latest):

| System | Archive | How to run |
|---|---|---|
| macOS, Apple Silicon | `folio-<version>-mac-arm64.zip` | unpack into a folder of its own, open `folio.app` (the first time: see [below](#honest-limits)) |
| macOS, Intel | `folio-<version>-mac-x64.zip` | the same |
| Windows x64 | `folio-<version>-win-x64.zip` | unpack into a folder you can write to, run `folio.exe` |
| Linux x64 | `folio-<version>-linux-x64.AppImage` | `chmod +x` it and run it |

Each archive has a `.sha256` beside it, and its build provenance can be
checked with `gh attestation verify <archive> --repo dskripchenko/folio`.
folio updates itself afterwards; see [Honest limits](#honest-limits) for
what the systems say about an unsigned program.

## What it is for

A Markdown file is where documentation lives, but the pictures in it — a
sequence diagram, an API, a process — usually live somewhere else. folio draws
them from the file itself: a ```` ```mermaid ````, ```` ```plantuml ````,
```` ```openapi ```` or ```` ```bpmn ```` block is a live diagram, editable in
place, and printed as one. It opens:

- **a Markdown file**, with every block live;
- **a diagram or API file on its own** — `.bpmn`, `.dmn`, `.drawio`,
  `.mmd`, `.puml`, `.dot`, an OpenAPI or AsyncAPI `.yaml` — in its editor;
- **a folder as a project** — a tree of files, links between documents,
  pictures and attachments by relative path, the whole folder printed as one
  PDF. "Shared" holds the documents common to everything; any folder on disk
  can be added as a project.

A folder that is a git repository keeps its history in folio too — versions of
a document, what changed between them, going back to one — with commits made as
you save. It is optional: a folder without git works the same.

Unsaved changes never get lost and never reach the file on their own: a quick
note in an untitled tab, or an edit you have not saved, survives closing folio
and restarting the computer, exactly as it was.

The widgets are those of [@dskripchenko/embed](https://github.com/dskripchenko/embed),
shipped inside the app: nothing is fetched from a CDN, and a document opens
offline.

## Beside the system

The same rules as [portable](https://github.com/dskripchenko/portable):

- **No installer, no administrator rights.** A zip on Windows and macOS, an
  AppImage on Linux. Unpack it anywhere and run it.
- **Everything in one place.** Settings, caches and window state go to
  `folio-data/` beside the program, not into the user profile; deleting the
  folder removes folio completely. No registry, no file associations, no
  background services.
- **Updates replace the program in its folder**, once a day at start or when
  asked: the release's archive downloaded, checked against its `.sha256`, and
  put in place when folio closes. No background service; it can be turned off.
- **A document is not trusted.** It sees only the files of its own folder, runs
  no code with access to the system, and reaches the network — "Try it" in an
  API reference, a picture by URL — only after you allow it for that file or
  folder.

## Honest limits

- **Size.** Electron brings its own Chromium: about 130 MB an archive. "Light"
  here means no installation, services or traces in the system, not megabytes.
- **No publisher's signature.** macOS says it cannot verify the developer, or
  that folio "is damaged", the first time it is opened from a browser
  download. Either open it once, then **System Settings → Privacy & Security
  → Open Anyway** (on macOS 15 and later the context menu's Open no longer
  does this), or remove the quarantine in Terminal:
  `xattr -dr com.apple.quarantine folio.app`. An archive fetched with `curl`
  carries no quarantine and opens at once; updates folio downloads itself
  don't either. Windows SmartScreen says "unknown publisher": More info → Run
  anyway. What each archive is can be checked by its `.sha256` and its
  provenance (`gh attestation verify <archive> --repo dskripchenko/folio`).
- **Linux.** An AppImage needs FUSE 2 (`libfuse2`), or run it with
  `--appimage-extract-and-run`. Where unprivileged user namespaces are
  restricted (Ubuntu 24.04 and later), Chromium's sandbox cannot start: allow
  them for folio with an AppArmor profile, or run it with `--no-sandbox`.

## Plan

| Stage | What |
|---|---|
| 0 | The repository, CI on three systems, an empty window — **done** |
| 1 | Reading: a Markdown file with every block live, offline — **done** |
| 2 | The workspace: Shared and projects in the sidebar, groups, pinning, file trees that follow the disk — **done** |
| 3 | Editing: visual and source, live blocks, saving; unsaved changes and quick notes survive closing and restarts, as in Sublime Text — **done** |
| 4 | History with git, per folder, if you want it: versions and their differences, restoring one, status in the tree, commits on save — **done (4a)**; branches, sync, cloning, conflicts in the text — **done (4b)**; a graph of the commits — **done (4c)** |
| 5 | Diagram and API files on their own, in their editors — **done** |
| 6 | A printed form for every widget (in embed) — **done**: File → Print |
| 7 | PDF: page size and margins, headers and footers, contents and bookmarks, a folder as one PDF — **done** |
| 8 | Portable builds and updating itself — **done** |
| 9 | Releases: checksums, provenance, a virus scan report — **1.0** |

## Development

```sh
pnpm install
pnpm start          # build and run
pnpm test           # unit tests
pnpm test:e2e       # start the built app and look at it
```

More in [docs/en/development.md](docs/en/development.md).

## License

MIT — see [LICENSE](LICENSE).
