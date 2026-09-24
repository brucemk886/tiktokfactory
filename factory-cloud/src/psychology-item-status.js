const parse=value=>{try{return JSON.parse(value||'{}');}catch{return {};}};
// Publication receipts win over old preparation errors; live retries win over stale failures.
export function psychologyItemStatus(row,record={},group={}){
 const receipt=parse(row.receipt_json),result=parse(row.result_json);
 const remote=String(record.officialRemoteStatus||record.status||'').toLowerCase();
 const error=record.publishError||record.officialRemoteError||record.errorMessage||record.error||row.error||row.execution_error||group.error||'';
 if(['published','publish_complete'].includes(remote))return {displayStatus:'published',failureReason:''};
 const local=row.status;
 if(!receipt.batchId&&!record.batchId&&['queued','running'].includes(local))return {displayStatus:local==='queued'?'queued':row.type==='official-publish'?'publishing':'producing',failureReason:''};
 if(['failed','rejected','status_timeout','needs_review','canceled','cancelled','enqueue_failed'].includes(remote))return {displayStatus:'publish_failed',failureReason:error};
 if(receipt.batchId||record.batchId){
  return {displayStatus:['processing','publishing','sending','uploading','publish_processing'].includes(remote)?'publishing':'scheduled',failureReason:''};
 }
 if(group.retrying||['queued','running'].includes(group.retry_status)||group.status==='submitting')return {displayStatus:'publishing',failureReason:''};
 const status=local||row.execution_status,type=row.type||row.execution_type;
 if(status==='cancelled'||status==='canceled')return {displayStatus:'cancelled',failureReason:''};
 if(status==='failed'||result.publishFailed||group.status==='failed')return {displayStatus:type==='official-publish'||result.publishFailed||group.status==='failed'?'publish_failed':'production_failed',failureReason:error};
 if(row.ready_json&&row.ready_json!=='{}')return {displayStatus:'publishing',failureReason:''};
 if(local==='done')return {displayStatus:'producing',failureReason:''};
 return {displayStatus:'missing',failureReason:'执行记录缺失，暂无可核对的发布结果。'};
}
