export const TOPIC_TEMPLATES=Object.freeze([
  {id:"psychology",label:"01 · 四图测试模板",hint:"题目作为四图测试问题；内容填写四个选项、画面方向或解读要点。"},
  {id:"psychology-collage",label:"02 · 纸张拼贴模板",hint:"题目作为视频主题；内容填写观点、故事线或解说稿。"},
  {id:"psychology-target-2",label:"03 · 互动测试模板",hint:"题目作为互动主题；内容填写问题、选项、揭晓结果或解读。"},
]);
const fail=message=>{throw Object.assign(new Error(message),{statusCode:400});};
export function validateTopicTemplate(value){
  if(!TOPIC_TEMPLATES.some(t=>t.id===value))fail("请选择1、2、3号模板对应的题库。");
  return value;
}
export function normalizeTopic(input,template){
  validateTopicTemplate(template);
  if(!input || typeof input!=="object" || Array.isArray(input))fail("题目格式无效。");
  if(input.template && input.template!==template)fail("不能将其他模板的题目混入当前题库。");
  const title=String(input.title??input["题目"]??"").trim(),content=String(input.content??input["内容"]??"").trim(),category=String(input.category??input["分类"]??"").trim();
  if(!title || title.length>200)fail("题目须为1–200个字符。");
  if(content.length>5000)fail("题目内容不能超过5000个字符。");
  if(category.length>60)fail("分类不能超过60个字符。");
  const priority=Number((input.priority??input["优先级"]) === "" ? 50 : (input.priority??input["优先级"]??50));
  if(!Number.isInteger(priority)||priority<0||priority>100)fail("优先级须为0–100的整数，数字越大越优先。");
  const raw=input.enabled??input["启用"]??true;
  if(![true,false,1,0,"1","0","true","false","是","否","启用","停用",""].includes(raw))fail("启用字段请填写是/否或true/false。");
  const enabled=![false,0,"0","false","否","停用"].includes(raw);
  return {template,title,content,category,priority,enabled};
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
export function topicFingerprintText(topic){return [topic.template,topic.title.normalize("NFKC").toLowerCase().replace(/\s+/g," "),topic.content.normalize("NFKC").replace(/\s+/g," ")].join("\n");}
export function topicSource(row){return {
  id:row.id,title:row.title,content:row.content,category:row.category,template:row.template,revision:row.revision,
  videoData:{script:row.content},voiceGender:"male",
};}
