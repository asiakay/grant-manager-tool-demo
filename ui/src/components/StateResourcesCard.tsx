import { STATE_RESOURCES, stateName } from "../stateResources";

interface Props {
  state: string | null;
  // True when the state came from IP detection rather than the saved profile.
  detected?: boolean;
  onChangeState?: () => void;
}

// Link-out card for curated state business resources. Renders nothing for
// states without entries in STATE_RESOURCES.
export default function StateResourcesCard({ state, detected, onChangeState }: Props) {
  const resources = state ? STATE_RESOURCES[state] : undefined;
  if (!state || !resources?.length) return null;

  return (
    <section className="card space-y-3" aria-label={`${stateName(state)} business resources`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">{stateName(state)} business resources</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {detected ? "Based on your location." : "Based on your profile."}
            {onChangeState && (
              <>
                {" "}
                <button type="button" onClick={onChangeState} className="text-brand-300 hover:underline">
                  Change state
                </button>
              </>
            )}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {resources.map((r) => (
          <li key={r.url}>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-gray-700 bg-gray-800/40 px-3 py-2.5 hover:border-brand-500 transition-colors"
            >
              <span className="text-sm font-medium text-brand-300">{r.label} ↗</span>
              <span className="block text-xs text-gray-400 mt-0.5">{r.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
