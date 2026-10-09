// Resolve once at job creation; retries consume the persisted musicSoundId.
export function drawPhotoMusic(ids,random=Math.random){return ids?.length?ids[Math.floor(random()*ids.length)]:'';}
export function normalizePhotoMusicIds(value){
 if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!/^\d{1,30}$/.test(id)))throw Object.assign(new Error('配乐池最多 100 个纯数字音乐 ID。'),{statusCode:400});
 return [...new Set(value)];
}
