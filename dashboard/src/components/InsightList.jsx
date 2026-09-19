// Written by the insight-agent, not by a rule. The model name and alert count
// are shown deliberately: an operator should be able to tell at a glance that
// this text was generated from a specific cluster of alerts, not measured.
const SEVERITY_STYLES = {
  high: 'bg-red-50 border-red-200',
  medium: 'bg-amber-50 border-amber-200',
  low: 'bg-slate-50 border-slate-200',
};

const SEVERITY_LABEL = {
  high: 'text-red-700 bg-red-100',
  medium: 'text-amber-700 bg-amber-100',
  low: 'text-slate-600 bg-slate-200',
};

function formatWindow(start, end) {
  const time = (v) =>
    new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${time(start)} – ${time(end)}`;
}

export default function InsightList({ insights }) {
  if (!insights.length) {
    return (
      <p className="text-sm text-slate-400">
        No insights yet — the agent writes one when several alerts for the same device
        land close together.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {insights.map((insight) => (
        <article
          key={insight._id}
          className={`rounded-xl border p-4 space-y-2 ${
            SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.low
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold text-slate-800 text-sm">{insight.headline}</h3>
            <span
              className={`text-[11px] font-medium uppercase tracking-wide px-2 py-0.5 rounded shrink-0 ${
                SEVERITY_LABEL[insight.severity] || SEVERITY_LABEL.low
              }`}
            >
              {insight.severity}
            </span>
          </div>

          <dl className="text-sm text-slate-700 space-y-1">
            <div>
              <dt className="inline font-medium text-slate-500">Likely cause: </dt>
              <dd className="inline">{insight.likelyCause}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-slate-500">Recommended: </dt>
              <dd className="inline">{insight.recommendedAction}</dd>
            </div>
          </dl>

          {/* Provenance, so a generated summary is never mistaken for a reading. */}
          <p className="text-xs text-slate-400 pt-1 border-t border-slate-200/70">
            <span className="font-mono">{insight.deviceId}</span>
            {' · '}
            {insight.alertCount} alert{insight.alertCount === 1 ? '' : 's'}
            {' · '}
            {formatWindow(insight.windowStart, insight.windowEnd)}
            {' · '}
            {insight.confidence} confidence
            {' · '}
            <span className="font-mono">{insight.model}</span>
          </p>
        </article>
      ))}
    </div>
  );
}
