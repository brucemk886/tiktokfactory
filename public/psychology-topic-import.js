export function parseTopicImport(text){
  text=String(text||"").replace(/^\uFEFF/,"").trim();
  if(!text)throw new Error("请先选择文件或粘贴题目。");
  if(text.startsWith("[")||text.startsWith("{")){
    let value;try{value=JSON.parse(text);}catch{throw new Error("JSON 格式无效，请检查逗号和引号。");}
    if(!Array.isArray(value))throw new Error("JSON 须为题目对象数组。");
    if(!value.length||value.length>100)throw new Error("每次可导入 1–100 条题目。");
    return value;
  }
  const rows=[];let row=[],value="",quoted=false,closed=false;
  const push=()=>{row.push(value);value="";closed=false;};
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){if(c==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
    if(c==='"'){if(value||closed)throw new Error("CSV 引号格式无效。");quoted=true;}
    else if(c===","){push();}
    else if(c==="\r"||c==="\n"){if(c==="\r"&&text[i+1]==="\n")i++;push();if(row.some(v=>v.trim()))rows.push(row);row=[];}
    else{if(closed&&!/\s/.test(c))throw new Error("CSV 引号后需要逗号或换行。");if(!closed)value+=c;}
  }
  if(quoted)throw new Error("CSV 存在未闭合的引号。");
  push();if(row.some(v=>v.trim()))rows.push(row);
  const aliases={揭晓评论:"revealComment",revealComment:"revealComment",题目:"title",内容:"content",分类:"category",优先级:"priority",启用:"enabled",title:"title",content:"content",category:"category",priority:"priority",enabled:"enabled",template:"template",图片:"image",image:"image",
    A文案:"copyA",B文案:"copyB",C文案:"copyC",D文案:"copyD",A图片:"imageA",B图片:"imageB",C图片:"imageC",D图片:"imageD",
    copyA:"copyA",copyB:"copyB",copyC:"copyC",copyD:"copyD",imageA:"imageA",imageB:"imageB",imageC:"imageC",imageD:"imageD"};
  const headers=(rows.shift()||[]).map(h=>aliases[h.trim()]);
  if(!headers.includes("title"))throw new Error("CSV 第一行需要「题目」或 title 列。");
  if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error("CSV 表头含未知或重复字段，请使用空白模板。");
  if(!rows.length||rows.length>100)throw new Error("每次可导入 1–100 条题目。");
  return rows.map((r,i)=>{if(r.length!==headers.length)throw new Error("第 "+(i+2)+" 行列数与表头不一致。");return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));});
}
