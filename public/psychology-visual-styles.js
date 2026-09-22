// Stable IDs are persisted with publishing tasks; never rename or reuse an ID.
const originalRows=[
 ['classic','经典黑白','#111111','#f4f1ea','#f4f1ea','#171717','#b3bc75','center'],
 ['editorial','奶油杂志','#ede4d2','#25241f','#fbf7ee','#25241f','#ad5e42','editorial'],
 ['night','深夜独白','#132b38','#f2eee5','#183544','#f2eee5','#79c9d0','night'],
 ['letter','私信信笺','#efe5d9','#493c32','#faf3e7','#493c32','#a96550','letter'],
 ['dialogue','关系对话','#e1ece7','#1c473b','#eff6f2','#1c473b','#729e87','dialogue'],
 ['notebook','横线笔记','#f7edc9','#34392d','#fcf6e1','#34392d','#74824c','notebook'],
 ['index','编号索引','#dfe6ee','#20334f','#f1f4f8','#20334f','#6587b1','index'],
 ['quote','留白引语','#e8dfe8','#48344d','#f8f1f7','#48344d','#9c719b','quote'],
 ['window','窗框留白','#d7e1d8','#293f31','#f0f3e9','#293f31','#698b70','window'],
 ['poster','醒目海报','#efb354','#362714','#fff1d4','#362714','#bd6137','poster'],
 ['sidebar','侧栏重点','#dce8f1','#1e364a','#f1f6fa','#1e364a','#407e9b','sidebar'],
 ['memo','便签叠纸','#e6ddc9','#393b2d','#f8f4d7','#393b2d','#a98b3e','memo'],
 ['frame','细框日记','#f1e0dc','#573c39','#faf1ed','#573c39','#b5746a','frame'],
 ['chapter','章节扉页','#3a3443','#f8eeee','#f0eaf2','#3a3443','#ad849d','chapter'],
 ['underline','划线重点','#e8ecdc','#34402d','#f6f8ee','#34402d','#83975b','underline'],
 ['corner','折角手账','#eadfcf','#473a2e','#fff8eb','#473a2e','#bd9964','corner'],
 ['ticket','票根记录','#d4e9e7','#23423f','#edf7f4','#23423f','#548c85','ticket'],
 ['split','双色分区','#efd6c9','#573a30','#fcf0e8','#573a30','#b6795b','split'],
 ['minimal','极简短句','#f3f1eb','#202723','#f3f1eb','#202723','#7b8c7d','minimal'],
 ['timeline','情绪路径','#e1e1f0','#383b62','#f4f3fb','#383b62','#8489b2','timeline'],
];
const emotionalRows=[
 ['unsent','未寄出的信','#e9e0d3','#453d34','#f7f0e5','#453d34','#aa8a70','unsent'],
 ['inner-voice','心里那句话','#293d48','#f5eee6','#354b56','#f5eee6','#9ebbbd','inner-voice'],
 ['soft-space','温柔留白','#f0e6e3','#59423e','#fbf5f1','#59423e','#c29b91','soft-space'],
 ['midnight-letter','深夜来信','#252b40','#f1e9dd','#30374d','#f1e9dd','#afabc7','midnight-letter'],
 ['soft-boundary','温柔边界','#dfe7de','#34483b','#f4f6ed','#34483b','#819c86','soft-boundary'],
 ['reassurance','安心回应','#e3ece5','#304b3c','#f4f8f0','#304b3c','#8caa92','reassurance'],
 ['relationship-journal','关系日记','#ecdcd4','#65463b','#fbefe6','#65463b','#b98f7a','relationship-journal'],
 ['confession','内心告白','#403341','#fff1e7','#4d3e4e','#fff1e7','#c19cab','confession'],
 ['emotional-echo','情绪回声','#e8e3ec','#51445d','#f6f1f8','#51445d','#a394b3','emotional-echo'],
 ['after-talk','谈话之后','#dce6ec','#324b59','#edf4f6','#324b59','#8eaab9','after-talk'],
 ['intimacy-distance','亲密距离','#e4dfd6','#4c493e','#f7f3e9','#4c493e','#a6a08b','intimacy-distance'],
 ['reconnection','关系修复','#f0ded4','#694737','#fff4e9','#694737','#c49a7c','reconnection'],
 ['slow-closeness','慢慢靠近','#dce8e6','#34504e','#f1f7f2','#34504e','#8bada5','slow-closeness'],
];
export const STYLE_REPLACEMENTS=Object.freeze(Object.fromEntries(['notebook','index','window','poster','sidebar','memo','frame','chapter','underline','corner','ticket','split','timeline'].map((id,i)=>[id,emotionalRows[i][0]])));
const makeStyle=([id,label,coverBg,coverInk,bg,ink,accent,layout])=>Object.freeze({id,label,coverBg,coverInk,bg,ink,accent,layout});
const archive=originalRows.filter(r=>STYLE_REPLACEMENTS[r[0]]).map(makeStyle);
const activeRows=originalRows.map(r=>STYLE_REPLACEMENTS[r[0]]?emotionalRows.find(n=>n[0]===STYLE_REPLACEMENTS[r[0]]):r);
export const VISUAL_STYLES=Object.freeze(activeRows.map(makeStyle));
// Archive lookup is for frozen jobs and historical reports only. New selections use currentStyleId.
export const styleById=id=>VISUAL_STYLES.find(s=>s.id===id)||archive.find(s=>s.id===id);
export const currentStyleId=id=>STYLE_REPLACEMENTS[id]||id;
export function currentStyleBindings(bindings){return bindings.map(b=>({...b,styles_json:JSON.stringify([...new Set(JSON.parse(b.styles_json).map(currentStyleId))])}));}
export function stableIndex(text,size){let n=2166136261;for(const c of String(text)){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0)%size;}
export function chooseVisualStyle(account,bindings=[],mode='group',fixed='classic'){
 if(mode==='legacy')return '';
 if(mode==='fixed')return styleById(currentStyleId(fixed))?.id||'classic';
 const id=String(account.connectionId||account.id),direct=bindings.find(b=>b.kind==='account'&&b.target_id===id),group=bindings.find(b=>b.kind==='group'&&b.target_id===account.groupId);
 const selected=direct||group, pool=selected?JSON.parse(selected.styles_json):VISUAL_STYLES.map(s=>s.id);
 const valid=[...new Set(pool.map(currentStyleId))].filter(id=>VISUAL_STYLES.some(s=>s.id===id));return valid[stableIndex(id,valid.length)]||'classic';
}
