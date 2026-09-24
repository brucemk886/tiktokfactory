import { photoCopyKey } from './peer-photo-copy-cache.js';
import { variantPlan } from './psychology-creative.js';
import { filterPhotoPageTexts, NO_USABLE_PAGES } from './photo-page-filter.js';
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
const clean=value=>typeof value==='string'?value.trim():'';
// Split for card layout without calling a model or dropping source words.
export function textPages(blocks){
 const pages=[];
 for(const block of blocks){let text=clean(block);while(text.length>1500){
  let cut=text.lastIndexOf(' ',1500);if(cut<750)cut=1500;
  pages.push(text.slice(0,cut));text=text.slice(cut).trim();
 }if(text)pages.push(text);}
 if(!pages.length)fail('文案没有可用正文，请先完善文案或新增改写版本。');
 if(pages.length>6)fail('原文分页后超过6页，请先在改写详情保存精简版本，再用于图文生成。');
 return pages;
}
export function librarySource(row,mediaType){
 const content=JSON.parse(row.content_json||'{}'),source=JSON.parse(row.source_json||'{}');
 const texts=(content.pages||[]).map(p=>clean(p.text)).filter(Boolean);
 const pages=row.media_type==='photo'?filterPhotoPageTexts(texts):texts;
 if(row.media_type==='photo'&&texts.length&&!pages.length)fail(NO_USABLE_PAGES);
 const transcript=clean(content.transcript),screen=(content.onScreenText||[]).map(clean).filter(Boolean);
 const body=row.media_type==='photo'?pages.join('\n\n'):[transcript,screen.length?'画面文字：\n'+screen.join('\n'): ''].filter(Boolean).join('\n\n');
 if(!body)fail('爆款文案没有可用正文，请先完善提取内容。');
 if(mediaType==='video'&&body.length>5000)fail('原文超过视频模板5000字符上限，请选择精简改写版本，正文不会被自动截断。');
 let sourceKey;try{sourceKey=photoCopyKey(row.source_url);}catch{sourceKey=row.id;}
 const title=clean(content.title)||row.title,caption=clean(content.caption);
 const output={id:row.id,title,videoUrl:row.source_url,voiceGender:source.voiceGender,sourceKey,videoData:{transcript:body,caption},
  copySource:{id:row.id,sourceKey,mediaType:row.media_type,kind:'original',completedAt:row.completed_at,content}};
 if(mediaType==='photo'){
  const blocks=row.media_type==='photo'?pages:transcript?[transcript]:screen;
  // Spoken script and matching screen captions are separate source streams;
  // prefer speech for cards, retain both in the immutable source snapshot.
  output.videoData={caption};
  output.copyVariant=variantPlan({title,caption,pages_json:JSON.stringify(textPages(blocks))});
 }
 return output;
}
export function reviewedSource(row,mediaType){
 const plan=variantPlan(row),body=plan.scenes.map(s=>s.originalText).join('\n\n');
 if(mediaType==='video'&&body.length>5000)fail('所选改写超过视频模板5000字符上限，请新增精简版本。');
 return {id:row.id,title:row.title,videoUrl:'',sourceKey:row.source_key,variantId:row.external_id,copyVariant:plan,videoData:mediaType==='photo'?{caption:row.caption}:{transcript:body,caption:row.caption},
  copySource:{id:row.id,sourceKey:row.source_key,kind:'rewrite',variantId:row.external_id,content:{title:row.title,caption:row.caption,pages:JSON.parse(row.pages_json)}}};
}
