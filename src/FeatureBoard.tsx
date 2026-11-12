import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { loadFeatures, type Feature } from './features';

export function FeatureBoard({ host }: PanelHostProps) {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A fullscreen panel remounts each time it is opened, so loading on mount
  // already picks up Feature files that changed while it was closed.
  useEffect(() => {
    let cancelled = false;
    loadFeatures(host.workspacePath)
      .then((loaded) => !cancelled && setFeatures(loaded))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [host.workspacePath]);

  return (
    <div className="feature-board flex h-full flex-col overflow-hidden bg-nim text-nim">
      <header className="feature-board-header flex items-baseline gap-2 px-4 pt-4">
        <h1 className="text-base font-semibold">Features</h1>
        {features && <span className="text-xs text-nim-muted">{features.length}</span>}
      </header>
      <div className="feature-board-body flex-1 overflow-auto p-4">
        {error ? (
          <p className="feature-board-error text-sm text-nim-error select-text">Could not read .features/: {error}</p>
        ) : !features ? (
          <p className="text-sm text-nim-muted">Loading…</p>
        ) : features.length === 0 ? (
          <p className="feature-board-empty text-sm text-nim-muted">
            No Feature files in <code>.features/</code> of this workspace.
          </p>
        ) : (
          <ul className="feature-board-list grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
            {features.map((feature) => (
              <li key={feature.id}>
                <FeatureCard feature={feature} onOpen={() => host.openFile(feature.path)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeatureCard({ feature, onOpen }: { feature: Feature; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="feature-card flex h-full w-full flex-col gap-2 rounded-md border border-nim bg-nim-secondary p-3 text-left hover:bg-nim-hover"
    >
      <span className="feature-card-title text-sm font-medium">{feature.title}</span>
      <span className="feature-card-meta flex flex-wrap gap-x-3 gap-y-1 text-xs text-nim-muted">
        <span className="font-mono">{feature.id}</span>
        {feature.kind && <span>{feature.kind}</span>}
        {feature.branch && <span className="font-mono">{feature.branch}</span>}
        {feature.mrs.length > 0 && <span>MR {feature.mrs.map((mr) => `!${mr}`).join(' ')}</span>}
        {feature.relates.length > 0 && <span>relates to {feature.relates.join(', ')}</span>}
      </span>
    </button>
  );
}
