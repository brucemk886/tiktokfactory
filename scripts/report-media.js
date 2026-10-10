// Explicit publication evidence only: a photo album can also have a duration.
export const MEDIA_LABELS={all:'全部类型',photo:'图文',video:'视频',unknown:'类型未知'};
export function reportMedia(item={}){
 const a=item.analytics||{};
 const type=String(item.mediaType||item.media_type||item.postType||item.post_type||a.media_type||'').toLowerCase();
 if(['photo','image','images','photo_post'].includes(type)||item.photoCount>0)return 'photo';
 if(type==='video')return 'video';
 if(type==='unknown')return 'unknown';
 const url=String(item.shareUrl||item.shareLink||item.videoUrl||'');
 if(/\/photo\//.test(url))return 'photo';
 if(/\/video\//.test(url))return 'video';
 return 'unknown';
}
export function reportMetric(item,...keys){
 for(const key of keys){const v=item[key]??item.analytics?.[key];if(v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0)return Number(v);}
 return null;
}
export function mediaComparison(videos,highView=1000){
 return ['photo','video','unknown'].map(media=>{
  const items=videos.filter(v=>v.media===media),known=items.filter(v=>v.views!==null),sum=key=>items.some(v=>v[key]!==null)?items.reduce((n,v)=>n+(v[key]??0),0):null;
  return {media,published:items.length,synced:known.length,missing:items.length-known.length,views:sum('views'),avgViews:known.length?sum('views')/known.length:null,
   highView:known.filter(v=>v.views>=highView).length,highRate:known.length?known.filter(v=>v.views>=highView).length/known.length:null,
   likes:sum('likes'),comments:sum('comments'),shares:sum('shares')};
 });
}
