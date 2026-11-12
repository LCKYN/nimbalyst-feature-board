// The host preload's generic IPC bridge. The channels are handled in the
// Nimbalyst host (main process), not by this extension.
//
// ponytail: `window.electronAPI` is not part of the SDK. The board calls three
// host-internal channels through it (`get-folder-contents`, `read-file-content`,
// `document-service:tracker-items-list`), and a host that renames or reshapes
// one breaks the board. Move to `services.filesystem` and a backend module or
// `host.data` once the SDK covers folder listing and tracker items.
interface Window {
  electronAPI: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
  };
}
