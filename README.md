# Nimbalyst Feature Board

A [Nimbalyst](https://github.com/nimbalyst/nimbalyst) extension that adds a full-window **Features** panel to the rail. It lists every Feature file in the workspace's `.features/` folder (see `~/.claude/feature-rules.md` for the file format); clicking a card opens the file.

It reads the files through the host's `get-folder-contents` and `read-file-content` IPC channels, so it needs a Nimbalyst build that registers them.

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
