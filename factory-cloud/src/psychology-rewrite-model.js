// Attribution is separate from copy text and its fingerprint. Unknown is never inferred from translation provider.
const LABELS={"claude-sonnet-5":"Claude Sonnet 5","claude-opus-4.7":"Claude Opus 4.7","claude-haiku-4.5":"Claude Haiku 4.5","deepseek-flash":"DeepSeek Flash"};
export function normalizeRewriteModel(value){
 if(value==null||value==='')return '';
 if(typeof value!=='string'||value.length>100||!/^[-a-zA-Z0-9._/:]+$/.test(value))throw Object.assign(new Error('rewriteModel 须为最多100字符的模型标识。'),{statusCode:400});
 return value.toLowerCase();
}
export function rewriteModelLabel(id){return LABELS[id]||id||'模型未知';}
