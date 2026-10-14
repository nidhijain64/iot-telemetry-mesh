import { expect, it } from 'vitest';
import { mergeHistory } from '../history';
it('preserves live readings that arrive while history loads and deduplicates overlaps', () => {
  const old = { _id: 'old', receivedAt: '2026-01-01T00:00:00Z' };
  const shared = { readingId: 'shared', receivedAt: '2026-01-01T00:00:01Z' };
  const fresh = { readingId: 'new', receivedAt: '2026-01-01T00:00:02Z' };
  expect(mergeHistory([old, { ...shared, _id: 'mongo-id' }], [fresh, shared])).toEqual([old, shared, fresh]);
});
it('continues showing live readings when no history is available', () => {
  const live = { readingId: 'new', receivedAt: '2026-01-01T00:00:02Z' };
  expect(mergeHistory([], [live])).toEqual([live]);
});
