# Nimbalyst Feature Board

A [Nimbalyst](https://github.com/nimbalyst/nimbalyst) extension that adds a full-window **Features** panel to the rail. It lists every Feature file in the workspace's `.features/` folder (see `~/.claude/feature-rules.md` for the file format) as a table: computed status, Task progress, and, when `.features/jira-cache.json` exists, each Epic's Jira status and labels plus the Epics that have no Feature file yet. Clicking a row opens the file. The board never calls Jira; the feature-* and card-* skills write that cache.

It reads the files through the host's `get-folder-contents`, `read-file-content` and `document-service:tracker-items-list` IPC channels, so it needs a Nimbalyst build that registers them.

## Build and install

```sh
npm install
npm run build
```

Then install the folder from Nimbalyst (the extension dev kit's `extension_install` tool links it into the extensions directory). After a change, run `npm run build` and reload the extension.

## Test

```sh
npm test
npm run typecheck
```
