export const TOPIC_TEMPLATES=Object.freeze([
  {id:"psychology",label:"01 · 四图测试模板",hint:"题目作为测试问题；上传 A/B/C/D 四张图片并填写每张对应的文案。"},
  {id:"psychology-collage",label:"02 · 纸张拼贴模板",hint:"题目作为视频主题；内容填写观点、故事线或解说稿。"},
  {id:"psychology-target-2",label:"03 · 互动测试模板",hint:"题目作为互动主题；内容填写问题、选项、揭晓结果或解读。"},
]);
export const CHOICE_LABELS=Object.freeze(["A","B","C","D"]);
export const TOPIC_IMAGE_KEY=/^psychology-topics\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp)$/i;
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
export function validateTopicTemplate(value){
  if(!TOPIC_TEMPLATES.some(t=>t.id===value))fail("请选择1、2、3号模板对应的题库。");
  return value;
}
export function isHttpsImageUrl(value){
  try{
    const parsed=new URL(String(value||""));
    if(parsed.protocol!=="https:")return false;
    if(parsed.username||parsed.password)return false;
    const host=parsed.hostname.toLowerCase();
    if(host==="localhost"||host.endsWith(".local")||host==="[::1]")return false;
    if(/^(127|10|0)\.|^(192\.168|169\.254|172\.(1[6-9]|2\d|3[0-1]))\./.test(host))return false;
    return String(value).length<=2000;
  }catch{return false;}
}
export function parseFourImageChoices(content){
  const raw=String(content||"").trim();
  if(!raw)return null;
  if(raw.startsWith("{")||raw.startsWith("[")){
    try{
      const value=JSON.parse(raw);
      const items=Array.isArray(value)?value:value.choices;
      const parsed=readChoiceList(items,false);
      if(parsed)return parsed;
    }catch{/* fall through to line parser */}
  }
  const found=new Map();
  const lineRe=/^\s*([ABCD])[\.\:：、\)\]]\s*(.*)$/i;
  for(const line of raw.split(/\r?\n/)){
    const match=line.match(lineRe);
    if(!match)continue;
    const label=match[1].toUpperCase();
    const rest=String(match[2]||"").trim();
    const rawUrl=(rest.match(/https:\/\/\S+/i)||[])[0]||"";
    const cleanedUrl=rawUrl.replace(/[),.;]+$/,"");
    const imageUrl=cleanedUrl&&isHttpsImageUrl(cleanedUrl)?cleanedUrl:"";
    const copy=(imageUrl?rest.replace(imageUrl,""):rest).replace(/\s*\|\s*$/,"").replace(/\s+/g," ").trim();
    found.set(label,{label,copy:copy.slice(0,80),imageUrl});
  }
  if(found.size!==4)return null;
  return CHOICE_LABELS.map(label=>found.get(label)||{label,copy:"",imageUrl:""});
}
function readChoiceList(items,required){
  if(!Array.isArray(items)||items.length!==4)return required?fail("四图题目需要 A/B/C/D 四个选项。"):null;
  const choices=[];
  for(const [index,label] of CHOICE_LABELS.entries()){
    const item=items[index]&&typeof items[index]==="object"&&!Array.isArray(items[index])?items[index]:{};
    const copy=String(item.copy??item.text??item.文案??"").trim();
    const imageKey=String(item.imageKey||"").trim();
    const imageUrl=String(item.imageUrl||item.image||item.图片||"").trim();
    if(required){
      if(!copy||copy.length>80)fail(`${label} 选项文案须为1–80个字符。`);
      if(imageKey&&!TOPIC_IMAGE_KEY.test(imageKey))fail(`${label} 图片无效，请重新上传。`);
      if(imageUrl&&!isHttpsImageUrl(imageUrl))fail(`${label} 图片地址须为 https 链接。`);
      if(!imageKey&&!imageUrl)fail(`请上传 ${label} 选项图片。`);
    }
    choices.push({
      label,
      copy:copy.slice(0,80),
      ...(imageKey?{imageKey}:{}),
      ...(!imageKey&&imageUrl?{imageUrl}:{}),
    });
  }
  return choices;
}
function choicesFromFlatFields(input){
  const items=CHOICE_LABELS.map(label=>{
    const copy=String(input[`copy${label}`]??input[`${label}文案`]??"").trim();
    const imageUrl=String(input[`image${label}`]??input[`${label}图片`]??"").trim();
    return {label,copy,imageUrl};
  });
  if(!items.some(item=>item.copy||item.imageUrl))return null;
  return readChoiceList(items,true);
}
export function serializeFourImageChoices(choices){
  return JSON.stringify({choices:(choices||[]).map(item=>({
    label:item.label,
    copy:item.copy||"",
    ...(item.imageKey?{imageKey:item.imageKey}:{}),
    ...(item.imageUrl?{imageUrl:item.imageUrl}:{}),
  }))});
}
export function fourImageCopyText(choices){
  return (choices||[]).map(item=>`${item.label}: ${item.copy||""}`.trim()).join("\n").trim();
}
export function hasCompleteFourImages(choices){
  return Array.isArray(choices)&&choices.length===4&&choices.every(item=>item.copy&&(item.imageKey||item.imageUrl||item.imagePath||item.dataUrl));
}
export function normalizeTopic(input,template){
  validateTopicTemplate(template);
  if(!input || typeof input!=="object" || Array.isArray(input))fail("题目格式无效。");
  if(input.template && input.template!==template)fail("不能将其他模板的题目混入当前题库。");
  const title=String(input.title??input["题目"]??"").trim(),category=String(input.category??input["分类"]??"").trim();
  if(!title || title.length>200)fail("题目须为1–200个字符。");
  if(category.length>60)fail("分类不能超过60个字符。");
  const priority=Number((input.priority??input["优先级"]) === "" ? 50 : (input.priority??input["优先级"]??50));
  if(!Number.isInteger(priority)||priority<0||priority>100)fail("优先级须为0–100的整数，数字越大越优先。");
  const raw=input.enabled??input["启用"]??true;
  if(![true,false,1,0,"1","0","true","false","是","否","启用","停用",""].includes(raw))fail("启用字段请填写是/否或true/false。");
  const enabled=![false,0,"0","false","否","停用"].includes(raw);
  let content=String(input.content??input["内容"]??"").trim();
  let choices=null;
  if(template==="psychology"){
    if(Array.isArray(input.choices))choices=readChoiceList(input.choices,true);
    else choices=choicesFromFlatFields(input)||parseFourImageChoices(content);
    if(choices&&hasCompleteFourImages(choices))content=serializeFourImageChoices(choices);
  }
  if(content.length>5000)fail("题目内容不能超过5000个字符。");
  return {template,title,content,category,priority,enabled,choices};
}
export function collectTopicWriteItems(input){
  if(Array.isArray(input))return normalizeWriteList(input,undefined);
  if(!input||typeof input!=="object")fail("题目格式无效。");
  if(Object.hasOwn(input,"items")){
    if(!Array.isArray(input.items))fail("items 须为题目数组。");
    return normalizeWriteList(input.items,input.template);
  }
  return normalizeWriteList([input],input.template);
}
function normalizeWriteList(items,fallbackTemplate){
  if(!items.length||items.length>100)fail("每次可导入1–100条题目。");
  return items.map((item,index)=>{
    try{
      const template=(item&&typeof item==="object"&&!Array.isArray(item)&&item.template)||fallbackTemplate;
      if(!template)fail("请指定题目所属模板：psychology、psychology-collage 或 psychology-target-2。");
      return normalizeTopic(item,template);
    }catch(error){throw Object.assign(error,{message:"第"+(index+1)+"条："+error.message});}
  });
}
export function topicFingerprintText(topic){
  const choices=topic.choices||parseFourImageChoices(topic.content);
  const body=hasCompleteFourImages(choices)
    ?choices.map(item=>[item.label,item.copy,item.imageKey||item.imageUrl||""].join(":")).join("|")
    :String(topic.content||"").normalize("NFKC").replace(/\s+/g," ");
  return [topic.template,topic.title.normalize("NFKC").toLowerCase().replace(/\s+/g," "),body].join("\n");
}
export function topicSource(row){
  const choices=parseFourImageChoices(row.content);
  const script=hasCompleteFourImages(choices)?fourImageCopyText(choices):row.content;
  return {
    id:row.id,title:row.title,content:row.content,category:row.category,template:row.template,revision:row.revision,
    choices,videoData:{script},voiceGender:"male",
  };
}
