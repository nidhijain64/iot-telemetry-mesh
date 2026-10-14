// The broker assigns readingId before forwarding and persisting each reading.
export function mergeHistory(saved, live) {
  const rows = new Map();
  for (const row of [...saved, ...live]) {
    rows.set(row.readingId || row._id || row, row);
  }
  return [...rows.values()].sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
}
