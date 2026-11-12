# Nimbalyst Feature Board

A [Nimbalyst](https://github.com/nimbalyst/nimbalyst) extension that adds a full-window **Features** panel to the rail. It lists every Feature file in the workspace's `.features/` folder (see `~/.claude/feature-rules.md` for the file format) as a table: computed status, Task progress, and, when `.features/jira-cache.json` exists, each Epic's Jira status and labels plus the Epics that have no Feature file yet. Tasks whose `featureId` matches no file and no Epic get a row of their own. Clicking a row opens the file. The board never calls Jira; the feature-* and card-* skills write that cache.

## What the board can show today

- **Four of the seven statuses**: จะทำ, กำลังทำ, เสร็จแล้ว and ยกเลิก. Sessions, worktrees and MR state are not read yet, so รอตัดสินใจ, เริ่มทำ and ปรึกษา never appear, and neither does the `stalled` flag.
- **`unknown` in place of a status** when a fact it needs was not read: the Feature names an Epic the cache does not hold (`Jira not read`), or it lists MRs and nothing open explains its status (`MR !345 not checked`). A Feature whose file has an `mrs` key (an MR repo, also while the list is empty) is never เสร็จแล้ว from its Epic alone.
- **No hand-set status.** The rules let the user set a status by hand on the board; that is not built, so ยกเลิก comes only from the Epic's `rejected` label.
- **The main checkout's workspace.** The Jira cache and the Tasks are kept with the repo's main checkout. A worktree opened as its own project shows its Feature files without Jira status or Tasks, and the board says so.
- **Up to 200 entries of `.features/`**, which is where the host cuts a folder listing. The board says when a listing came back at that cap.

## Host

Tested on Nimbalyst 0.82.0 or later. An older host can answer the tracker listing for another project; the board drops those items, so it shows no Tasks there, not wrong ones.

The SDK has no documented way to list a folder or the tracker items, so the board calls three undocumented host IPC channels through `window.electronAPI.invoke`: `get-folder-contents`, `read-file-content` and `document-service:tracker-items-list`. A host that renames or reshapes one of them breaks the board.

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
