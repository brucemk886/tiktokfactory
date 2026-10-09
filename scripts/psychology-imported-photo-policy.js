// All values below are publication instants, independent of browser or worker timezone.
export const IMPORTED_PHOTO_TIMES=['22:30','01:30','03:30'];
export const IMPORTED_PHOTO_ZONE='Asia/Shanghai';
export const IMPORTED_PHOTO_LEAD=10*60*1000;
export const IMPORTED_PHOTO_PREPARE=60*60*1000;
export function importedPhotoSlots(now,until=now+26*3600000,enabledAt=0){
 const day=Math.floor((now+8*3600000)/86400000)*86400000-8*3600000,result=[];
 for(let d=0;d<3;d++)for(const time of IMPORTED_PHOTO_TIMES){const [h,m]=time.split(':').map(Number),at=day+d*86400000+h*3600000+m*60000;
  if(at>Math.max(now,enabledAt)+IMPORTED_PHOTO_LEAD&&at<=until)result.push(at);
 }
 return result.sort((a,b)=>a-b);
}
export const DEFAULT_IMPORTED_PHOTO_CTA=Object.freeze({
 mention:'Curious about your attachment style? 💭\nVisit {account} and tap the link in their bio to take the test.',
 self:'Curious about your attachment style? 💭\nTap the link in my bio to take the test.'
});
export function normalizeImportedPhotoCTA(value=DEFAULT_IMPORTED_PHOTO_CTA){
 const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
 if(!value||typeof value!=='object'||Array.isArray(value))fail('请填写两种引导文案。');
 const result={};
 for(const key of ['mention','self']){if(typeof value[key]!=='string'||!value[key].trim()||value[key].trim().length>1000)fail('每种引导文案须为 1–1000 字。');result[key]=value[key].trim();}
 if(result.mention.split('{account}').length!==2)fail('引导其他账号时，请保留且只使用一次 {account}。');
 if(result.self.includes('{account}'))fail('承接账号自己发布的文案无需填写 {account}。');
 if(Object.values(result).some(s=>/[{}]/.test(s.replace('{account}',''))))fail('引导文案仅支持 {account} 这个占位符。');
 if(Object.values(result).some(s=>/@[a-zA-Z0-9_.]+/.test(s)))fail('请使用 {account} 代替固定 @账号，系统会自动填入已分配的承接账号。');
 return result;
}
export function importedPhotoCaption(caption,connectionId,receiver,templates){
 if(!receiver?.linkReady||!receiver.connectionId||!/^\w[\w.]{0,23}$/.test(receiver.username||''))throw Error('请配置有效承接账号并确认主页测试链接。');
 const copy=normalizeImportedPhotoCTA(templates),cta=connectionId===receiver.connectionId?copy.self:copy.mention.replace('{account}','@'+receiver.username);
 const base=String(caption||'').trim(),result=base.endsWith(cta)?base:[base,cta].filter(Boolean).join('\n\n');
 if(!base)throw Error('二创发布文案为空。');if(result.length>2200)throw Error('加上测试引导后文案超过 2200 字，请缩短二创文案。');
 return {caption:result,cta};
}
