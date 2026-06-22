import type { InteractionWarning } from '../lib/interactions';

export default function InteractionWarnings({ warnings }: { warnings: InteractionWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <div className="interaction-warnings">
      {warnings.map((w, i) => (
        <div key={i} className="interaction-warning">
          <span className="interaction-icon" aria-hidden="true">
            ⚠️
          </span>
          <span>
            <strong>{w.medA.name}</strong> and <strong>{w.medB.name}</strong> shouldn't be taken together —{' '}
            {w.reason}.
          </span>
        </div>
      ))}
    </div>
  );
}
