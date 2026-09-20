import { signalDeskAllAccounts } from './signal-desk.js';
const directories=new WeakMap();
export async function publishAccountDirectory(env,{fresh=true}={}){
 const previous=directories.get(env.DB),stamp=Date.now();
 const identity=String(env.SIGNAL_DESK_BASE_URL||'')+':'+String(env.SIGNAL_DESK_BRIDGE_KEY||'');
 if(!fresh&&previous?.identity===identity&&previous.expires>stamp)return previous.promise;
 const promise=signalDeskAllAccounts(env,env.DB);
 const entry={identity,expires:stamp+30000,promise};directories.set(env.DB,entry);
 try{return await promise;}catch(error){if(directories.get(env.DB)===entry)directories.delete(env.DB);throw error;}
}
export function temporaryAccessError(error){
 const status=Number(error?.statusCode||error?.status)||0;
 return !status||status===408||status===429||status>=500;
}

export function clearPublishAccountDirectory(db){directories.delete(db);}
