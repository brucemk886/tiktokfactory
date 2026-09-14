export async function syncPeerArtboardProgress(context, job, local, state, send, at = Date.now()) {
  if (!job.payload?.peerSource || local.updatedAt === state.version || at - state.at < 5000 || ['done','failed','canceled','cancelled'].includes(local.status)) return false;
  state.at = at;
  try {
    await send(context, `/api/worker/jobs/${encodeURIComponent(job.id || job.jobId)}/progress`, {method:'POST',body:{percent:local.percent,message:local.message,result:local}});
    state.version = local.updatedAt;
    return true;
  } catch { return false; }
}
