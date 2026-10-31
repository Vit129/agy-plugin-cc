# Product

The Claude Code plugin packages the Antigravity `agy` companion for Claude Code users. It provides plugin metadata, skills, hooks, and a local companion wrapper for invoking the `agy` CLI.

## Users and interface

The users are developers running Claude Code with Antigravity installed and authenticated. The interface is the plugin's skills, commands, hooks, and status messages. This repository does not ship a graphical application.

## Delivery

`npm test` runs the Node test suite, `npm run check` validates JavaScript syntax, and `npm run build` combines those checks with `npm pack --dry-run`. `make start` runs the safe preview gate. Runtime review requires a separate test Claude Code profile.
