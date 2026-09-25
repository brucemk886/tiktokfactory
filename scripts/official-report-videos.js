// Keep the fields used by the operations report, excluding covers, download
// URLs, profile payloads and other archive-only metadata.
const fields=['id','videoId','createTime','createdAt','title','caption','views','viewCount','playCount','likes','comments','shares','favorites','saves','favorites_count','collectCount','reach','duration','averageTimeWatched','fullWatchRate','mediaType','media_type','postType','post_type','photoCount','shareUrl','shareLink','videoUrl','syncedAt'];
const analyticsFields=['views','viewCount','view_count','playCount','likes','like_count','diggCount','comments','comment_count','commentCount','shares','share_count','shareCount','favorites','saves','favorites_count','collectCount','fullWatchRate','full_video_watched_rate','fullVideoWatchedRate','averageTimeWatched','average_time_watched','duration','video_duration','media_type'];
export function projectReportVideos(videos=[]){
 return videos.slice(0,100).map(v=>{
  const row=Object.fromEntries(fields.filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
  row.analytics=Object.fromEntries(analyticsFields.filter(k=>v.analytics?.[k]!==undefined).map(k=>[k,v.analytics[k]]));
  if(Array.isArray(v.retention))row.retention=v.retention.slice(0,40);
  return row;
 });
}
