import { cardCanvasSize, wrapLines } from "./psychology-text-card.js";
import { styleById } from "./psychology-visual-styles.js";
export function renderStyledCard(slide,aspectRatio,styleId,styleDefinition=null){
 const s=styleDefinition||styleById(styleId);if(!s)throw new Error('未知图文样式');
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

 // Relationship-focused collection. Decorations remain outside the text-safe rectangle.
 const circle=(x,y,r,color,fill=false)=>{c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.strokeStyle=color;c.fillStyle=color;c.lineWidth=2;fill?c.fill():c.stroke();};
 const round=(x,y,width,height,r,color)=>{c.fillStyle=color;c.beginPath();c.roundRect(x,y,width,height,r);c.fill();};
 if(l==='unsent'){
  rect(w*.055,h*.045,w*.89,h*.91,cover?'#f8f1e5':'#fff9ef');
  line(w*.12,h*.89,w*.5,h*.94);line(w*.5,h*.94,w*.88,h*.89);line(w*.12,h*.12,w*.3,h*.12);
  left=w*.15;right=w*.85;top=h*.24;bottom=h*.79;
 }
 if(l==='inner-voice'){
  circle(w*.86,h*.12,w*.11,accent);circle(w*.9,h*.09,w*.04,accent);
  rect(w*.08,h*.23,w*.012,h*.5,accent);left=w*.15;right=w*.86;top=h*.29;bottom=h*.77;
 }
 if(l==='soft-space'){
  circle(w*.08,h*.04,w*.22,'#e4d2cd',true);circle(w*.94,h*.96,w*.2,'#e8dbd6',true);
  align='center';left=w*.16;right=w*.84;top=h*.24;bottom=h*.76;
 }
 if(l==='midnight-letter'){
  circle(w*.8,h*.13,w*.038,accent);rect(w*.803,h*.089,w*.045,h*.08,cover?s.coverBg:s.bg);
  line(w*.15,h*.87,w*.45,h*.87);left=w*.15;right=w*.85;top=h*.31;bottom=h*.8;
 }
 if(l==='soft-boundary'){
  c.strokeStyle=accent;c.lineWidth=w*.008;c.beginPath();c.roundRect(w*.065,h*.07,w*.87,h*.86,w*.16);c.stroke();
  rect(w*.065,h*.38,w*.009,h*.16,cover?s.coverBg:s.bg);
  align='center';left=w*.16;right=w*.84;top=h*.25;bottom=h*.76;
 }
 if(l==='reassurance'){
  round(w*.09,h*.21,w*.82,h*.57,w*.045,cover?'#f7faf2':'#e1ebe0');
  circle(w*.76,h*.817,w*.012,accent,true);circle(w*.8,h*.817,w*.012,accent,true);circle(w*.84,h*.817,w*.012,accent,true);
  left=w*.16;right=w*.84;top=h*.29;bottom=h*.71;
 }
 if(l==='relationship-journal'){
  rect(w*.045,h*.04,w*.91,h*.92,cover?'#faf0e5':'#fff8ef');line(w*.115,h*.06,w*.115,h*.94,'#dcc9bc');
  line(w*.18,h*.17,w*.46,h*.17);line(w*.18,h*.87,w*.82,h*.87);
  left=w*.19;right=w*.82;top=h*.25;bottom=h*.8;
 }
 if(l==='confession'){
  c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.arc(w*.5,h*.47,w*.43,Math.PI*1.07,Math.PI*1.93);c.stroke();
  circle(w*.5,h*.86,w*.008,accent,true);align='center';left=w*.17;right=w*.83;top=h*.33;bottom=h*.79;
 }
 if(l==='emotional-echo'){
  for(let i=0;i<3;i++){c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.arc(w*1.02,h*.92,w*(.13+i*.08),Math.PI,Math.PI*1.5);c.stroke();}
  c.font=`${w*.19}px Georgia`;c.fillStyle=accent;c.fillText('“',w*.1,h*.19);
  left=w*.16;right=w*.84;top=h*.28;bottom=h*.77;
 }
 if(l==='after-talk'){
  round(w*.12,h*.11,w*.34,h*.055,w*.022,'#c3d5dd');round(w*.56,h*.18,w*.26,h*.045,w*.018,'#b0c8d1');
  line(w*.18,h*.83,w*.82,h*.83);align='center';left=w*.16;right=w*.84;top=h*.33;bottom=h*.76;
 }
 if(l==='intimacy-distance'){
  circle(w*.24,h*.15,w*.055,accent);circle(w*.76,h*.15,w*.055,accent);line(w*.34,h*.15,w*.66,h*.15,'#c4beaf');
  line(w*.08,h*.36,w*.08,h*.67);line(w*.92,h*.36,w*.92,h*.67);align='center';left=w*.16;right=w*.84;top=h*.29;bottom=h*.78;
 }
 if(l==='reconnection'){
  const gradient=c.createLinearGradient(0,0,0,h);gradient.addColorStop(0,cover?s.coverBg:s.bg);gradient.addColorStop(1,'#f7e9ce');c.fillStyle=gradient;c.fillRect(0,0,w,h);
  c.strokeStyle=accent;c.lineWidth=3;c.beginPath();c.moveTo(w*.15,h*.86);c.quadraticCurveTo(w*.5,h*.7,w*.85,h*.86);c.stroke();
  left=w*.14;right=w*.86;top=h*.23;bottom=h*.72;
 }
 if(l==='slow-closeness'){
  for(let i=0;i<3;i++)circle(w*(.36+i*.14),h*.83,w*(.012+i*.006),accent);
  c.strokeStyle=accent;c.lineWidth=2;c.beginPath();c.arc(w*.5,h*.12,w*.19,0,Math.PI);c.stroke();
  align='center';left=w*.18;right=w*.82;top=h*.28;bottom=h*.73;
 }
 const family=['editorial','letter','quote','frame','chapter','center','unsent','midnight-letter','relationship-journal','confession','emotional-echo'].includes(l)?'Georgia,"Times New Roman",serif':'"Segoe UI",Arial,sans-serif';
 const blocks=(cover?[slide.title]:slide.bullets?.length?slide.bullets:[slide.title]).filter(Boolean).map(t=>String(t).replace(/\*\*/g,''));
 const coverScale=['poster','sidebar','index'].includes(l)?.12:['editorial','split','minimal','inner-voice','after-talk','reconnection'].includes(l)?.105:.092;
 let size=Math.round(w*(cover?coverScale:.05)),lines=[];
 for(;size>=16;size--){c.font=`${cover?700:450} ${size}px ${family}`;lines=blocks.flatMap((b,i)=>[...(i?['']:[]),...wrapLines(b,t=>c.measureText(t).width,right-left)]);if(lines.length*size*1.32<=bottom-top&&lines.every(t=>c.measureText(t).width<=right-left+1))break;}
 if(size<16)throw new Error('单页文案过长，请缩短或拆页');
 let y=align==='center'?top+(bottom-top-lines.length*size*1.32)/2:top;
 c.textAlign=align;c.textBaseline='top';c.fillStyle=ink;c.font=`${cover?700:450} ${size}px ${family}`;
 for(const text of lines){c.fillText(text,align==='center'?w/2:left,y);y+=size*1.32;}
 if(slide.pageNumber){c.font=`500 ${w*.026}px Arial`;c.textAlign='right';c.fillStyle=ink;c.fillText(String(slide.pageNumber).padStart(2,'0'),right,h*.94);}
 return canvas;
}
