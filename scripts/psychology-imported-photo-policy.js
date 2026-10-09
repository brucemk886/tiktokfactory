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
export function importedPhotoCaption(caption,connectionId,receiver){
 if(!receiver?.linkReady||!receiver.connectionId||!/^\w[\w.]{0,23}$/.test(receiver.username||''))throw Error('请配置有效承接账号并确认主页测试链接。');
 const cta='Curious about your attachment style? 💭\n'+(connectionId===receiver.connectionId?'Tap the link in my bio to take the test.':'Visit @'+receiver.username+' and tap the link in their bio to take the test.');
 const base=String(caption||'').trim(),result=base.endsWith(cta)?base:[base,cta].filter(Boolean).join('\n\n');
 if(!base)throw Error('二创发布文案为空。');if(result.length>2200)throw Error('加上测试引导后文案超过 2200 字，请缩短二创文案。');
 return {caption:result,cta};
}
