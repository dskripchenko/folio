# folio

A desktop app to read, edit and print Markdown with live diagrams, API
references and editors — on macOS, Windows and Linux, without installing
anything.

> Status: in development, nothing to download yet.

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
