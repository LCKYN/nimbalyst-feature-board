# Nimbalyst Feature Board

A [Nimbalyst](https://github.com/nimbalyst/nimbalyst) extension that adds a full-window **Features** panel to the rail. It lists every Feature file in the workspace's `.features/` folder (see `~/.claude/feature-rules.md` for the file format) as a table: computed status, Task progress, and, when `.features/jira-cache.json` exists, each Epic's Jira status and labels plus the Epics that have no Feature file yet. Tasks whose `featureId` matches no file and no Epic get a row of their own. Clicking a row opens the file. The board never calls Jira; the feature-* and card-* skills write that cache.

## What the board can show today

- **Six of the seven statuses**: every one but เริ่มทำ, which needs to know whether a worktree for the Feature's `branch` exists. Worktrees and MR state are not read yet, so such a Feature reads ปรึกษา or จะทำ, and an MR that waits for review or failed CI neither makes a row รอตัดสินใจ nor shows in the lists.
- **"Waiting on you" and "Stuck"** above the table: a session linked to one of the Feature's Tasks that has an unanswered question (it opens from there), a blocked Task, a session that ended with an error. A Feature in กำลังทำ with Tasks and no running session is flagged `stalled`.
- **`unknown` in place of a status** when a fact it needs was not read: the Feature names an Epic the cache does not hold (`Jira not read`), or it lists MRs and nothing open explains its status (`MR !345 not checked`). A Feature whose file has an `mrs` key (an MR repo, also while the list is empty) is never เสร็จแล้ว from its Epic alone.
- **Tokens, cost and time** in a row's detail, for the Feature and again beside each Task: `3 sessions · 4.1M tokens · $12.40 · 2 h 5 min`. Each figure is summed over the sessions the Tasks link; a session two Tasks link counts under both, so the Task lines do not add up to the Feature's. The cost is the host's own figure: `~` when the host estimated part of it, and a session it could not price is counted as `not priced`, never as $0. The time is how long the sessions' finished turns ran (prompt to last reply), not the wait for an answer in between; it is left out when it could not be read for every session. Child sessions that a linked session started are not included.
- **A Criteria column**, only when some row's file has acceptance criteria: ticked/total, with `no open Task` when criteria are still open and no Task is. It is not the rules' "Still missing": a Task has no field that names the criterion it covers.
- **A Target column**, only when some row has one: the `target:` of the Feature file (a date or a milestone name, for repos without Jira), else the Epic's `due` from the Jira cache. A date that has passed on a row that is still open is marked `overdue`.
- **A status set by hand.** The select under a row's status overrides the computed one; the row is marked `✎ hand-set` and the same select clears it. The override is kept in the board's own storage for the workspace, never in the Feature file.
- **The main checkout's workspace.** The Jira cache and the Tasks are kept with the repo's main checkout. A worktree opened as its own project shows its Feature files without Jira status or Tasks, and the board says so.
- **Up to 200 entries of `.features/`**, which is where the host cuts a folder listing. The board says when a listing came back at that cap.

## Finding a Feature

Rows are ordered by what needs you first: รอตัดสินใจ, then กำลังทำ (blocked ones first), เริ่มทำ, ปรึกษา, จะทำ, and the closed ones last; within a status by id.

Click a column header to sort by it: once ascending, again descending, a third time back to the board's own order (what needs you first). Rows with nothing in that column stay last, and the choice is remembered per workspace.

The search box looks for every word you type in a row's title, id, kind, labels, Jira status and shown status, and it searches the closed rows too: `prod` lists what can be sold, `demo` what can be shown. A label on a row puts itself in the box. "Copy list" copies the rows shown as plain text for a message to sales, one line each: title, Jira status and labels, without the keys.

The ↗ beside an id opens the Epic in Jira. The site comes from the repo's `CLAUDE.md`, from the line `Jira project: KEY (https://<site>/...)`; a line without the URL gives no link.

## Staying current

The board reloads when a Task changes, when a file in `.features/` changes, when the window gets the focus back, and from its Refresh button. A burst of changes, such as a session writing several files, is one reload, 0.3 s after the last of them. A rewritten Jira cache is seen through the file event only while it is not in `.gitignore` (the host's watcher skips gitignored changes); after that, focus and Refresh pick it up. The board does not listen for session changes yet, so a session that starts to wait for an answer shows on the next of those reloads.

## Host

Tested on Nimbalyst 0.82.0 or later. An older host can answer the tracker listing for another project; the board drops those items, so it shows no Tasks there, not wrong ones.

The SDK has no documented way to list a folder, the tracker items or the sessions, so the board calls undocumented host IPC channels through `window.electronAPI.invoke`: `get-folder-contents`, `read-file-content`, `document-service:tracker-items-list`, `sessions:list`, `ai-session-state:get-state`, `open-external` and `usage-analytics:get-session-breakdown`, `usage-analytics:get-session-turns`. It opens a session with the host's `open-ai-session` window event, and listens to the host events `document-service:tracker-items-changed` and `file-changed-on-disk` through `host.onWorkspaceEvent`. A host that renames or reshapes one of them breaks the board.

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
