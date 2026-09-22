// Stable IDs are persisted with publishing tasks; never rename or reuse an ID.
const rows=[
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
export const VISUAL_STYLES=Object.freeze(rows.map(([id,label,coverBg,coverInk,bg,ink,accent,layout])=>Object.freeze({id,label,coverBg,coverInk,bg,ink,accent,layout})));
export const styleById=id=>VISUAL_STYLES.find(s=>s.id===id);
export function stableIndex(text,size){let n=2166136261;for(const c of String(text)){n^=c.codePointAt(0);n=Math.imul(n,16777619);}return (n>>>0)%size;}
export function chooseVisualStyle(account,bindings=[],mode='group',fixed='classic'){
 if(mode==='legacy')return '';
 if(mode==='fixed')return styleById(fixed)?.id||'classic';
 const id=String(account.connectionId||account.id),direct=bindings.find(b=>b.kind==='account'&&b.target_id===id),group=bindings.find(b=>b.kind==='group'&&b.target_id===account.groupId);
 const selected=direct||group, pool=selected?JSON.parse(selected.styles_json):VISUAL_STYLES.map(s=>s.id);
 const valid=pool.filter(id=>styleById(id));return valid[stableIndex(id,valid.length)]||'classic';
}
