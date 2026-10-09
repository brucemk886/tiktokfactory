// Bound preflight work only. Real video upload/submission keeps its existing pacing.
export async function checkPublishEntries(items,check){
 const results=new Array(items.length);let next=0,failure=null;
 const worker=async()=>{while(!failure&&next<items.length){const index=next++;try{results[index]=await check(items[index],index);}catch(error){failure??=error;}}};
 // Drain started checks before returning an error, so a retry cannot overlap them.
 await Promise.all(Array.from({length:Math.min(3,items.length)},worker));
 if(failure)throw failure;return results;
}
