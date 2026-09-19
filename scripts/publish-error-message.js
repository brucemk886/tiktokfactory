export function publishErrorMessage(error,phase='发布'){
  const status=Number(error?.statusCode||error?.status)||0;
  const causes=[error,error?.cause,...(error?.cause?.errors||[])];
  const codes=[...new Set(causes.map(e=>String(e?.code||'')).filter(Boolean))].slice(0,5);
  const detail=[status?'HTTP '+status:'',...codes].filter(Boolean).join(' / ');
  const message=String(error?.message||error||'未知错误').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/([?&](?:token|key|signature|secret)=)[^&\s]+/gi,'$1[redacted]');
  return `${phase}失败${detail?'（'+detail+'）':''}：${message}`.slice(0,4000);
}
