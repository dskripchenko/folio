# folio

A desktop app to read, edit and print Markdown with live diagrams, API
references and editors — on macOS, Windows and Linux, without installing
anything. Also a light IDE made to sit beside an AI agent in a terminal: its
changes reviewed as a pull request, what changed since the last look, its
worktrees, comments sent to its console.

> Status: **1.18** — download the archive for your system from the [latest release](https://github.com/dskripchenko/folio/releases/latest).

- [How it works](design.md) — the windows, what a document may do, where the
  data lives
- [Development](development.md) — building, running and testing it

## Beside the system

- No installer and no administrator rights: a zip on Windows and macOS, an
  AppImage on Linux.
- Settings, caches and window state live in `folio-data/` beside the program;
  deleting the folder removes folio completely.
- A document is not trusted: it sees only its own folder and reaches the
  network only with your consent.

## Beside the shell terminal

When the [shell](https://github.com/dskripchenko/shell) terminal is on the
machine too, the two find each other: shell opens files, projects and reviews
in folio; folio opens a tab in shell, sends review comments to the agent's pane
there and shows shell's colours in its consoles; both keep one journal of which
agent edited what. See *Beside the shell terminal* in [How it works](design.md).
