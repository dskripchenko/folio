# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
