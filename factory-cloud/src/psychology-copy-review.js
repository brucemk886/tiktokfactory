import {comparisonUnits} from './psychology-copy-comparison.js';
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
export function normalizeCopyReview(input){
 const score=input.score==null?null:input.score;
 if(score!==null&&(typeof score!=='number'||!Number.isFinite(score)||score<0||score>100))fail('score 须为 0–100 的数字。');
 const scoreReason=input.scoreReason==null?'':input.scoreReason;
 if(typeof scoreReason!=='string'||scoreReason.length>2000)fail('scoreReason 须为不超过2000字符的评分理由。');
 let comparison=null;
 if(input.comparison!=null){
  const c=input.comparison;
  if(!Array.isArray(c.original)||!Array.isArray(c.rewrite)||c.original.length+c.rewrite.length>300)fail('comparison 须包含 original 和 rewrite 逐句翻译数组，合计最多300句。');
  const clean=(row,isRewrite)=>{
   if(!row||typeof row.text!=='string'||!row.text.trim()||row.text.length>12000||typeof row.zh!=='string'||!row.zh.trim()||row.zh.length>12000)fail('逐句翻译须填写完整 text 和 zh。');
   const originalTexts=isRewrite?row.originalTexts:undefined;
   if(isRewrite&&(!Array.isArray(originalTexts)||originalTexts.length>12||originalTexts.some(v=>typeof v!=='string'||!v.trim()||v.length>12000)))fail('改写句须提供 originalTexts 数组；新增内容填写空数组。');
   return {text:row.text.trim(),zh:row.zh.trim(),...(isRewrite?{originalTexts:originalTexts.map(t=>t.trim())}:{})};
  };
  comparison={original:c.original.map(r=>clean(r,false)),rewrite:c.rewrite.map(r=>clean(r,true))};
  if(JSON.stringify(comparison).length>180000)fail('翻译内容过大。');
  const expected=comparisonUnits(input,'photo','r');
  if(expected.some(u=>!comparison.rewrite.some(r=>r.text===u.text)))fail('comparison.rewrite 须覆盖标题、发布文案和正文的每句完整原语言文本。');
 }
 return {score,scoreReason:scoreReason.trim(),comparison};
}
