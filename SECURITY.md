# Security

## Reporting something

Use [private vulnerability
reporting](https://github.com/dskripchenko/folio/security/advisories/new), or
write to denskrp90@gmail.com if that form is not available to you. Please do not
open a public issue for anything that would tell somebody how to attack a user
of folio before it can be fixed.

This is one person's project. Expect an answer in days rather than hours, and
expect to be told plainly if something is not going to be fixed and why.

## Which versions get fixes

The newest release, and only that one. There are no releases yet.

## What a document can do

A Markdown file may come from anywhere, so folio treats it as untrusted:

- **The document's window has no Node.js.** It runs with context isolation and
  Chromium's sandbox; the only thing it can call is a small bridge that asks
  the main process for specific things.
- **It sees only its own folder.** Files are served to the window under a
  scheme of folio's own and only from inside the folder that was opened.
- **It does not reach the network on its own.** Requests to other addresses are
  blocked until you allow them for that file or folder.
- **It cannot navigate the window away** or open new windows; links go to the
  system browser.

Anything that gets around one of these is a vulnerability worth reporting.

## What is checked in the build

**Every GitHub Action is named by commit rather than by tag**, so a moved tag
cannot change what CI runs. Dependencies are pinned by the lockfile.
