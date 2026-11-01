# folio

[![tests](https://img.shields.io/github/actions/workflow/status/dskripchenko/folio/tests.yml?branch=main&label=tests)](https://github.com/dskripchenko/folio/actions/workflows/tests.yml)
[![license](https://img.shields.io/github/license/dskripchenko/folio?label=license)](https://github.com/dskripchenko/folio/blob/main/LICENSE)

A desktop app to read, edit and print Markdown — with live diagrams of every
notation, OpenAPI and AsyncAPI references, BPMN and DMN, draw.io, process
flows, kanban boards and calendars — on macOS, Windows and Linux, without
installing anything.

> Status: **in development, nothing to download yet.** It reads: a Markdown file
> opens with every block live, offline, its pictures by relative path, the web
> only with consent, and the open documents come back after a restart. Folders,
> editing and PDF come in the stages listed under [Plan](#plan).

Documentation: [English](docs/en/) · [Русский](docs/ru/) · [Deutsch](docs/de/) ·
[中文](docs/zh/)

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
- **A document is not trusted.** It sees only the files of its own folder, runs
  no code with access to the system, and reaches the network — "Try it" in an
  API reference, a picture by URL — only after you allow it for that file or
  folder.

## Plan

| Stage | What |
|---|---|
| 0 | The repository, CI on three systems, an empty window — **done** |
| 1 | Reading: a Markdown file with every block live, offline — **done** |
| 2 | A folder as a project: the tree, links, watching for changes |
| 3 | Editing: visual and source, live blocks, saving; unsaved changes and quick notes survive closing and restarts, as in Sublime Text |
| 4 | Diagram and API files on their own, in their editors |
| 5 | A printed form for every widget (in embed) |
| 6 | PDF: page size and margins, headers and footers, contents and bookmarks, a folder as one PDF |
| 7 | Portable builds and updating itself |
| 8 | Releases: checksums, provenance, a virus scan report — 1.0 |

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
