// Selection snapshots retain revisions, so concurrent edits are never silently deleted.
export async function collectTopics(api, base, filters) {
  const selected = new Map();
  let pages = 1;
  for (let page = 1; page <= pages; page++) {
    const data = await api(base + '?' + new URLSearchParams({...filters, page: String(page), pageSize: '100'}));
    if (page === 1) pages = data.totalPages;
    for (const item of data.items) selected.set(item.id, item);
    if (!data.hasMore) break;
  }
  return selected;
}
export async function deleteSelectedTopics(api, base, items, progress = () => {}) {
  const result = {deleted: 0, failed: []};
  for (const item of items) {
    try { await api(base + '/' + encodeURIComponent(item.id), 'DELETE', {revision: item.revision}); result.deleted++; }
    catch (error) { result.failed.push({id: item.id, title: item.title, error: error.message}); }
    progress(result.deleted + result.failed.length, items.length);
  }
  return result;
}
