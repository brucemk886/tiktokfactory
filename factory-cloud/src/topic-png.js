// Decode PNG scanlines without allocating a full RGBA image. Header limits alone
// do not bound a malicious DEFLATE stream; stop at the exact expected row count.
import {inspectPng} from './topic-image-operation.js';
const fail=()=>{throw Object.assign(new Error('PNG 图片损坏或格式不支持，请提供完整静态 PNG。'),{statusCode:400,code:'INVALID_IMAGE'});};
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function pngCrc(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
export async function decodeTopicPng(bytes){
 try{
  const {width,height}=inspectPng(bytes),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let p=8,header=false,ended=false,idatEnded=false,palette=0,paletteSeen=false,idat=[],depth,type,channels,interlace;
  while(p+12<=bytes.length){
   const n=v.getUint32(p);if(n>bytes.length-p-12)fail();
   const tag=String.fromCharCode(...bytes.subarray(p+4,p+8)),data=bytes.subarray(p+8,p+8+n);
   if(!/^[A-Za-z]{4}$/.test(tag)||pngCrc(bytes.subarray(p+4,p+8+n))!==v.getUint32(p+8+n))fail();
   if(!header&&tag!=='IHDR')fail();
   if(tag==='IHDR'){
    if(header||n!==13)fail();header=true;depth=data[8];type=data[9];interlace=data[12];
    channels=({0:1,2:3,3:1,4:2,6:4})[type];
    if(!channels||!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]})[type].includes(depth)||data[10]||data[11]||interlace>1)fail();
   }else if(tag==='PLTE'){
    if(paletteSeen||idat.length||!n||n%3||n>768||[0,4].includes(type))fail();paletteSeen=true;palette=n/3;if(type===3&&palette>2**depth)fail();
   }else if(tag==='IDAT'){
    if(idatEnded||type===3&&!paletteSeen)fail();idat.push(data);
   }else if(tag==='IEND'){
    if(n||!idat.length||p+12!==bytes.length)fail();ended=true;break;
   }else{
    if(tag==='acTL'||tag[0]===tag[0].toUpperCase())fail();
   }
   if(idat.length&&tag!=='IDAT')idatEnded=true;
   p+=12+n;
  }
  if(!ended)fail();
  const passes=(interlace?[[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]:[[0,0,1,1]]).map(([x,y,dx,dy])=>({w:Math.max(0,Math.ceil((width-x)/dx)),h:Math.max(0,Math.ceil((height-y)/dy))})).filter(a=>a.w&&a.h);
  const bpp=Math.max(1,Math.ceil(channels*depth/8));let pass=0,rowIndex=0,rowOffset=0,row,prior,filter;
  function nextPass(){const size=Math.ceil(passes[pass].w*channels*depth/8);row=new Uint8Array(size);prior=new Uint8Array(size);rowIndex=0;rowOffset=0;}
  nextPass();
  let ci=0;const source=new ReadableStream({pull(controller){if(ci<idat.length)controller.enqueue(idat[ci++]);else controller.close();}});
  const reader=source.pipeThrough(new DecompressionStream('deflate')).getReader();
  try{
   for(;;){const {value,done}=await reader.read();if(done)break;
    for(const byte of value){
     if(pass>=passes.length)fail();
     if(rowOffset===0){filter=byte;if(filter>4)fail();rowOffset=1;continue;}
     const x=rowOffset-1,a=x>=bpp?row[x-bpp]:0,b=prior[x],c=x>=bpp?prior[x-bpp]:0;
     row[x]=(byte+(filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c)))&255;
     rowOffset++;
     if(rowOffset===row.length+1){
      if(type===3)for(let pixel=0;pixel<passes[pass].w;pixel++){const bit=pixel*depth,index=(row[bit>>>3]>>>(8-depth-(bit&7)))&((1<<depth)-1);if(index>=palette)fail();}
      [prior,row]=[row,prior];rowOffset=0;rowIndex++;
      if(rowIndex===passes[pass].h){pass++;if(pass<passes.length)nextPass();}
     }
    }
   }
   if(pass!==passes.length)fail();
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {bytes,width,height};
 }catch{fail();}
}
