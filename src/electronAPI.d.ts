// The host preload's generic IPC bridge. The channels are handled in the
// Nimbalyst host (main process), not by this extension.
interface Window {
  electronAPI: {
    invoke: (channel: string, ...args: any[]) => Promise<any>;
  };
}
