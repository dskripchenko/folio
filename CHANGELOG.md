# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
