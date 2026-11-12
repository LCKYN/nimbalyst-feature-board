// The host preload's generic IPC bridge. The channels are handled in the
// Nimbalyst host (main process), not by this extension.
//
// ponytail: `window.electronAPI` is not part of the SDK. The board calls
// host-internal channels through it (`get-folder-contents`, `read-file-content`,
// `document-service:tracker-items-list`, `sessions:list`,
// `ai-session-state:get-state`, `open-external`), and a host that renames or reshapes one
// breaks the board. Move to `services.filesystem` and a backend module or
// `host.data` once the SDK covers folder listing, tracker items and sessions.
// Each channel also needs its line in the fork's
// `scripts/check-extension-ipc-channels.mjs`.
interface Window {
  electronAPI: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
  };
}
