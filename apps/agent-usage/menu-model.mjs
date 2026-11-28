function knownAmount(remaining) {
  return Number.isFinite(remaining) && remaining >= 0 && remaining <= 100;
}

function amountLabel(remaining) {
  return knownAmount(remaining) ? `${Math.floor(remaining)}%` : '—';
}

export function buildMenuModel(rows, active) {
  const lowest = new Map();
  for (const row of rows) {
    for (const { remaining } of row.windows) {
      if (knownAmount(remaining) && remaining < (lowest.get(row.provider) ?? Infinity)) {
        lowest.set(row.provider, remaining);
      }
    }
  }
  const idle = [...lowest.keys()].reduce((first, provider) =>
    first === undefined || lowest.get(provider) < lowest.get(first) ? provider : first, undefined);
  const selected = active.length ? active.map(entry => entry.provider) : idle ? [idle] : [];
  return {
    status: selected.map(provider => ({
      provider,
      label: rows.find(row => row.provider === provider)?.label.split(' · ')[0] ?? provider,
      amount: amountLabel(lowest.get(provider)),
      dimmed: active.length === 0,
    })),
    groups: rows.map(({ label, login, windows }) => ({
      label,
      ...(login ? { secondary: ` — ${login}` } : {}),
      windows: windows.map(({ short, remaining, resetsAt, state, level }) => ({
        label: `${short} · `,
        amount: amountLabel(remaining),
        level,
        resetLabel: resetsAt == null ? 'Reset time unavailable' : state === 'reset_assumed' ? 'Last reported reset' : 'Resets',
        resetsAt,
        ...(state === 'aging' ? { suffix: ' · Stale' } : {}),
      })),
    })),
  };
}

export function formatMenuGroup(group, timeLabel = time => new Date(time * 1000).toLocaleString()) {
  return [
    group.label + (group.secondary ?? ''),
    ...group.windows.map(window => {
      const reset = window.resetsAt == null ? window.resetLabel : `${window.resetLabel} ${timeLabel(window.resetsAt)}`;
      return `  ${window.label}${window.amount} remaining · ${reset}${window.suffix ?? ''}`;
    }),
  ];
}
