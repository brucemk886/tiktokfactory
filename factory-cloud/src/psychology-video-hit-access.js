// Callers pass a freshly loaded module-authorized user; ownership is never reassigned.
export const hitAdmin=user=>user?.role==='admin'?1:0;
export function hitAssetScope(user,kind,alias='a'){
 const reference=kind==='image'?'psychology_video_hit_frames':'psychology_video_hit_versions';
 const field=kind==='image'?'asset_id':'video_asset_id';
 return {sql:'('+alias+'.owner_id=? OR ?=1 OR EXISTS(SELECT 1 FROM '+reference+' permission_ref JOIN psychology_video_hits permission_source ON permission_source.id=permission_ref.source_id WHERE permission_ref.'+field+'='+alias+'.id AND permission_source.owner_id=?))',args:[user.id,hitAdmin(user),user.id]};
}
export function hitLibraryScope(user,alias='a'){
 const videos=hitAssetScope(user,'video','permission_video');
 return {sql:'('+alias+'.owner=? OR EXISTS(SELECT 1 FROM psychology_video_hit_videos permission_video WHERE permission_video.id='+alias+'.id AND '+videos.sql+') OR EXISTS(SELECT 1 FROM psychology_video_hit_render_assets permission_render JOIN psychology_video_hits permission_source ON permission_source.id=permission_render.source_id WHERE permission_render.asset_id='+alias+'.id AND (permission_source.owner_id=? OR ?=1)))',args:[user.username,...videos.args,user.id,hitAdmin(user)]};
}
