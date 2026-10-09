export function mountPhotoReceivers({api,changed,isBusy}){
 const $=id=>document.getElementById(id);let active=false,busy=false,model=null,error='';
 const enabled=()=>active&&$('mentionReceiver').checked;
 function render(){
  $('photoReceiverSettings').hidden=!active;$('photoReceiverDetails').hidden=!enabled();$('photoReceiverRefresh').disabled=busy||isBusy();
  $('photoReceiverStatus').textContent=busy?'正在核对已保存的承接账号…':model?.receivers?.length?'':'尚未配置可用承接账号，请先保存承接账号和主页链接确认。';
  if(error)$('photoReceiverStatus').textContent=error;
  else if(!busy&&model?.receivers?.length)$('photoReceiverStatus').textContent='可用承接账号 '+model.receivers.length+' 个：'+model.receivers.map(r=>'@'+r.username).join('、');
  $('photoReceiverCta').textContent=model?.mention?.replace('{account}','@随机承接账号')||'';
 }
 async function load(){if(busy||isBusy())return;busy=true;error='';render();try{model=await api('/api/psychology-auto-publish/photo-receivers');}catch(e){model=null;error=e.message;}finally{busy=false;render();changed();}}
 $('mentionReceiver').addEventListener('change',()=>{if(isBusy())return;changed();render();if(enabled())load();});
 $('photoReceiverRefresh').onclick=load;
 return {sync(value){active=value;render();},enabled,validate(ids){if(!enabled())return '';if(busy)return '正在核对承接账号，请稍候。';if(error||!model)return error||'请先刷新承接账号。';if(ids.some(id=>!model.receivers?.some(r=>r.connectionId!==id)))return '所选发布账号没有其他可用承接账号，请补充承接账号或更换发布账号。';return '';}};
}
