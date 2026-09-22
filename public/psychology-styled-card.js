import { cardCanvasSize, wrapLines } from "./psychology-text-card.js";
import { styleById } from "./psychology-visual-styles.js";
export function renderStyledCard(slide,aspectRatio,styleId){
 const s=styleById(styleId);if(!s)throw new Error('未知图文样式');
 const {width:w,height:h}=cardCanvasSize(aspectRatio),canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
 const c=canvas.getContext('2d'),cover=slide.kind==='cover',l=s.layout,p=w*.1;
 c.fillStyle=cover?s.coverBg:s.bg;c.fillRect(0,0,w,h);
 const ink=cover?s.coverInk:s.ink,accent=s.accent;
 const rect=(x,y,width,height,color)=>{c.fillStyle=color;c.fillRect(x,y,width,height);};
 const line=(x,y,x2,y2,color=accent)=>{c.strokeStyle=color;c.lineWidth=2;c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();};
 let left=p,right=w-p,top=h*.18,bottom=h*.84,align='left';
 if(['center','night','quote','window','frame','chapter','minimal'].includes(l))align='center';
 if(l==='editorial'){rect(p,h*.09,w*.16,8,accent);line(p,h*.88,w-p,h*.88);top=h*.2;}
 if(l==='night'){c.strokeStyle=accent;c.lineWidth=3;c.beginPath();c.arc(w*.8,h*.12,w*.045,0,Math.PI*2);c.stroke();line(p,h*.88,w*.4,h*.88);}
 if(l==='letter'){line(p,h*.12,w-p,h*.12);line(p,h*.89,w-p,h*.89);left=w*.14;right=w*.86;}
 if(l==='dialogue'){rect(w*.05,h*.14,w*.9,h*.72,cover?'#f7fcf9':'#dcebe3');rect(w*.09,h*.84,w*.08,h*.045,cover?'#f7fcf9':'#dcebe3');left=w*.12;right=w*.88;top=h*.2;bottom=h*.8;}
 if(l==='notebook'){for(let y=h*.16;y<h*.91;y+=h*.046)line(p,y,w-p,y,'#ded8b8');line(w*.075,h*.1,w*.075,h*.92,accent);}
 if(l==='index'){rect(0,0,w*.24,h*.105,accent);top=h*.2;line(p,h*.86,w-p,h*.86);}
 if(l==='quote'){c.fillStyle=accent;c.font=`${w*.18}px Georgia`;c.fillText('“',p,h*.21);top=h*.25;bottom=h*.82;}
 if(l==='window'){c.strokeStyle=accent;c.lineWidth=w*.012;c.strokeRect(w*.05,h*.06,w*.9,h*.88);left=w*.14;right=w*.86;}
 if(l==='poster'){rect(0,0,w,h*.07,accent);rect(0,h*.93,w,h*.07,accent);top=h*.15;bottom=h*.85;}
 if(l==='sidebar'){rect(0,0,w*.055,h,accent);rect(w*.11,h*.13,w*.09,7,accent);left=w*.14;}
 if(l==='memo'){rect(w*.055,h*.075,w*.89,h*.855,'#cbc1a9');rect(w*.08,h*.06,w*.84,h*.86,s.bg);rect(w*.36,h*.04,w*.28,h*.035,'#bca970');left=w*.14;right=w*.86;}
 if(l==='frame'){c.strokeStyle=accent;c.lineWidth=3;c.strokeRect(p*.55,p*.55,w-p*1.1,h-p*1.1);c.strokeRect(p*.7,p*.7,w-p*1.4,h-p*1.4);left=w*.15;right=w*.85;}
 if(l==='chapter'){rect(w*.47,h*.09,w*.06,6,accent);line(w*.35,h*.86,w*.65,h*.86);top=h*.21;}
 if(l==='underline'){rect(p,h*.12,w*.42,h*.025,accent);line(p,h*.88,w-p,h*.88);}
 if(l==='corner'){c.fillStyle=accent;c.beginPath();c.moveTo(w-w*.14,0);c.lineTo(w,h*.1);c.lineTo(w,0);c.fill();line(p,h*.88,w-p,h*.88);}
 if(l==='ticket'){c.setLineDash([w*.012,w*.009]);line(w*.085,h*.08,w*.085,h*.92);line(w*.915,h*.08,w*.915,h*.92);c.setLineDash([]);left=w*.14;right=w*.86;}
 if(l==='split'){rect(0,0,w,h*.11,accent);rect(0,h*.9,w,h*.1,accent);top=h*.21;bottom=h*.82;}
 if(l==='minimal'){left=w*.17;right=w*.83;top=h*.23;bottom=h*.77;rect(w*.48,h*.87,w*.04,4,accent);}
 if(l==='timeline'){line(w*.1,h*.15,w*.1,h*.86);c.fillStyle=accent;for(let i=0;i<3;i++){c.beginPath();c.arc(w*.1,h*(.15+i*.35),w*.01,0,Math.PI*2);c.fill();}left=w*.17;}
 const family=['editorial','letter','quote','frame','chapter','center'].includes(l)?'Georgia,"Times New Roman",serif':'"Segoe UI",Arial,sans-serif';
 const blocks=(cover?[slide.title]:slide.bullets?.length?slide.bullets:[slide.title]).filter(Boolean).map(t=>String(t).replace(/\*\*/g,''));
 const coverScale=['poster','sidebar','index'].includes(l)?.12:['editorial','split','minimal'].includes(l)?.105:.092;
 let size=Math.round(w*(cover?coverScale:.05)),lines=[];
 for(;size>=16;size--){c.font=`${cover?700:450} ${size}px ${family}`;lines=blocks.flatMap((b,i)=>[...(i?['']:[]),...wrapLines(b,t=>c.measureText(t).width,right-left)]);if(lines.length*size*1.32<=bottom-top&&lines.every(t=>c.measureText(t).width<=right-left+1))break;}
 if(size<16)throw new Error('单页文案过长，请缩短或拆页');
 let y=align==='center'?top+(bottom-top-lines.length*size*1.32)/2:top;
 c.textAlign=align;c.textBaseline='top';c.fillStyle=ink;c.font=`${cover?700:450} ${size}px ${family}`;
 for(const text of lines){c.fillText(text,align==='center'?w/2:left,y);y+=size*1.32;}
 if(slide.pageNumber){c.font=`500 ${w*.026}px Arial`;c.textAlign='right';c.fillStyle=ink;c.fillText(String(slide.pageNumber).padStart(2,'0'),right,h*.94);}
 return canvas;
}
