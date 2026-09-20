export const TOPIC_TEMPLATES=Object.freeze([
  {id:"psychology",label:"01 · 四图测试模板",hint:"题目作为测试问题；上传 A/B/C/D 四张图片并填写每张对应的文案。"},
  {id:"psychology-collage",label:"02 · 纸张拼贴模板",hint:"题目作为视频主题；内容填写观点、故事线或解说稿。"},
  {id:"psychology-target-2",label:"03 · 单图互动测试模板",hint:"题目作为测试问题；上传一张图片，并自行填写 A/B/C/D 四个选项。"},
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
function isSingleImageQuizValue(value){
  return Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&(value.kind==="single-image-quiz"||value.imageKey||value.imageUrl||value.image||value["图片"]));
}
export function parseFourImageChoices(content){
  const raw=String(content||"").trim();
  if(!raw)return null;
  if(raw.startsWith("{")||raw.startsWith("[")){
    try{
      const value=JSON.parse(raw);
      if(isSingleImageQuizValue(value))return null;
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
function readTextChoices(items,required){
  if(!Array.isArray(items)||items.length!==4)return required?fail("单图互动题目需要 A/B/C/D 四个选项。"):null;
  const choices=[];
  for(const [index,label] of CHOICE_LABELS.entries()){
    const item=items[index]&&typeof items[index]==="object"&&!Array.isArray(items[index])?items[index]:{};
    const text=String(item.copy??item.text??item.文案??"").trim();
    if(required&&(!text||text.length>80))fail(`${label} 选项须为1–80个字符。`);
    choices.push({label,copy:text.slice(0,80)});
  }
  return choices;
}
function sourceImageFromInput(input,required){
  const imageKey=String(input.imageKey||"").trim();
  const imageUrl=String(input.imageUrl||input.image||input["图片"]||"").trim();
  if(required){
    if(imageKey&&!TOPIC_IMAGE_KEY.test(imageKey))fail("测试图片无效，请重新上传。");
    if(imageUrl&&!isHttpsImageUrl(imageUrl))fail("测试图片地址须为 https 链接。");
    if(!imageKey&&!imageUrl)fail("请上传一张测试图片。");
  }
  return {
    ...(imageKey?{imageKey}:{}),
    ...(!imageKey&&imageUrl?{imageUrl}:{}),
  };
}
export function serializeSingleImageQuiz(quiz){
  return JSON.stringify({
    kind:"single-image-quiz",
    ...(quiz.imageKey?{imageKey:quiz.imageKey}:{}),
    ...(quiz.imageUrl?{imageUrl:quiz.imageUrl}:{}),
    choices:(quiz.choices||[]).map(item=>({label:item.label,copy:item.copy||""})),
  });
}
export function parseSingleImageQuiz(content){
  const raw=String(content||"").trim();
  if(!raw)return null;
  if(raw.startsWith("{")){
    try{
      const value=JSON.parse(raw);
      if(!isSingleImageQuizValue(value))return null;
      const choices=readTextChoices(value.choices,false);
      if(!choices)return null;
      return {
        kind:"single-image-quiz",
        imageKey:String(value.imageKey||"").trim(),
        imageUrl:String(value.imageUrl||value.image||"").trim(),
        dataUrl:String(value.dataUrl||value.imageBase64||"").trim(),
        imagePath:String(value.imagePath||"").trim(),
        choices,
      };
    }catch{return null;}
  }
  return null;
}
export function singleImageCopyText(quiz){
  return fourImageCopyText(quiz?.choices);
}
export function hasCompleteSingleImageQuiz(quiz){
  return Boolean(quiz&&(quiz.imageKey||quiz.imageUrl||quiz.imagePath||quiz.dataUrl)&&Array.isArray(quiz.choices)&&quiz.choices.length===4&&quiz.choices.every(item=>item.copy));
}
export function operatorQuizFromPayload(payload={}){
  const parsed=parseSingleImageQuiz(payload.topicSource?.content||payload.content);
  const source=payload.sourceImage&&typeof payload.sourceImage==="object"?payload.sourceImage:{};
  const topicImage=payload.topicSource?.sourceImage&&typeof payload.topicSource.sourceImage==="object"?payload.topicSource.sourceImage:{};
  const rawChoices=Array.isArray(payload.choiceCopies)&&payload.choiceCopies.length===4
    ?payload.choiceCopies
    :Array.isArray(payload.choices)&&payload.choices.length===4
      ?payload.choices
      :parsed?.choices;
  const quiz={
    imageKey:String(source.imageKey||topicImage.imageKey||parsed?.imageKey||"").trim(),
    imageUrl:String(source.imageUrl||payload.sourceImageUrl||topicImage.imageUrl||parsed?.imageUrl||"").trim(),
    dataUrl:String(source.dataUrl||parsed?.dataUrl||"").trim(),
    imagePath:String(source.imagePath||parsed?.imagePath||"").trim(),
    choices:Array.isArray(rawChoices)?CHOICE_LABELS.map((label,index)=>{
      const item=rawChoices[index];
      const copy=item&&typeof item==="object"?String(item.copy||item.text||"").trim():String(item||"").trim();
      return {label,copy:copy.slice(0,80)};
    }):[],
  };
  return hasCompleteSingleImageQuiz(quiz)?quiz:null;
}
function hasSingleImageFields(input){
  return Boolean(input.imageKey||input.imageUrl||input.image||input["图片"]||CHOICE_LABELS.some(label=>input[`copy${label}`]||input[`${label}文案`]));
}
function singleImageFromFields(input){
  const copies=CHOICE_LABELS.map(label=>({
    label,
    copy:String(input[`copy${label}`]??input[`${label}文案`]??"").trim(),
  }));
  const hasCopies=copies.some(item=>item.copy)||Array.isArray(input.choices);
  const hasImage=Boolean(String(input.imageKey||input.imageUrl||input.image||input["图片"]||"").trim());
  if(!hasCopies&&!hasImage)return null;
  const choices=Array.isArray(input.choices)?readTextChoices(input.choices,true):readTextChoices(copies,true);
  return {...sourceImageFromInput(input,true),choices};
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
  let sourceImage=null;
  if(template==="psychology"){
    if(Array.isArray(input.choices))choices=readChoiceList(input.choices,true);
    else choices=choicesFromFlatFields(input)||parseFourImageChoices(content);
    if(choices&&hasCompleteFourImages(choices))content=serializeFourImageChoices(choices);
  }
  if(template==="psychology-target-2"){
    const quiz=Array.isArray(input.choices)||hasSingleImageFields(input)
      ?singleImageFromFields(input)
      :parseSingleImageQuiz(content);
    if(quiz&&hasCompleteSingleImageQuiz(quiz)){
      content=serializeSingleImageQuiz(quiz);
      choices=quiz.choices;
      sourceImage={imageKey:quiz.imageKey||"",imageUrl:quiz.imageUrl||""};
    }
  }
  if(content.length>5000)fail("题目内容不能超过5000个字符。");
  const revealComment=String(input.revealComment??input.reveal_comment??input["揭晓评论"]??"").trim();
  if(revealComment.length>2000)fail("揭晓评论不能超过2000个字符。");
  return {template,title,content,category,priority,enabled,choices,sourceImage,revealComment};
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
  const single=topic.sourceImage&&topic.choices?{...topic.sourceImage,choices:topic.choices}:parseSingleImageQuiz(topic.content);
  if(hasCompleteSingleImageQuiz(single)){
    return [topic.template,topic.title.normalize("NFKC").toLowerCase().replace(/\s+/g," "),[single.imageKey||single.imageUrl||"",...single.choices.map(item=>item.copy)].join("|")].join("\n");
  }
  const choices=topic.choices||parseFourImageChoices(topic.content);
  const body=hasCompleteFourImages(choices)
    ?choices.map(item=>[item.label,item.copy,item.imageKey||item.imageUrl||""].join(":")).join("|")
    :String(topic.content||"").normalize("NFKC").replace(/\s+/g," ");
  return [topic.template,topic.title.normalize("NFKC").toLowerCase().replace(/\s+/g," "),body].join("\n");
}
export function topicSource(row){
  const single=parseSingleImageQuiz(row.content);
  const choices=single?.choices||parseFourImageChoices(row.content);
  const script=hasCompleteSingleImageQuiz(single)?singleImageCopyText(single):hasCompleteFourImages(choices)?fourImageCopyText(choices):row.content;
  return {
    id:row.id,title:row.title,content:row.content,category:row.category,template:row.template,revision:row.revision,revealComment:row.reveal_comment||"",
    choices,sourceImage:single?{imageKey:single.imageKey||"",imageUrl:single.imageUrl||""}:null,
    videoData:{script},voiceGender:"male",
  };
}
