import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadTikTokToR2, runPsychologyRecreationWorkflow } from './psychology-recreation-workflow.js';

function mp4(size = 2048) {
  const bytes = new Uint8Array(size);
  bytes.set([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
  return bytes;
}

function archive() {
  const writes = [], deletes = [];
  return {
    writes,
    deletes,
    async put(key, body, options) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      writes.push({ key, bytes, options });
      return { size: bytes.byteLength };
    },
    async delete(key) { deletes.push(key); }
  };
}

test('TikTok download fetches an existing CDN video URL and archives it temporarily without a container', async () => {
  const ARCHIVE = archive();
  const env = {
    ARCHIVE,
    fetch: async (url, init) => {
      assert.equal(url, 'https://v16.tiktokcdn.com/source.mp4');
      assert.equal(init.redirect, 'manual');
      return new Response(mp4(), { headers: { 'content-type': 'video/mp4', 'content-length': '2048' } });
    }
  };
  const result = await downloadTikTokToR2(env, { url: 'https://www.tiktok.com/@creator/video/123', videoFileUrl: 'https://v16.tiktokcdn.com/source.mp4', r2Key: 'temp/source.mp4', jobId: 'job-1' });
  assert.equal(result.size, 2048);
  assert.equal(ARCHIVE.writes[0].key, 'temp/source.mp4');
  assert.equal(ARCHIVE.writes[0].options.customMetadata.kind, 'psychology-recreation-source');
});

test('TikTok download rejects non-TikTok hosts and invalid download bodies', async () => {
  const ARCHIVE = archive();
  await assert.rejects(downloadTikTokToR2({ ARCHIVE }, { url: 'https://example.com/video/1', r2Key: 'x', jobId: 'job' }), /只支持公开的 TikTok/);
  await assert.rejects(downloadTikTokToR2({
    ARCHIVE,
    fetch: async () => new Response(new Uint8Array(20), { headers: { 'content-type': 'video/mp4', 'content-length': '20' } })
  }, { url: 'https://vm.tiktok.com/abc', videoFileUrl: 'https://v16.tiktokcdn.com/source.mp4', r2Key: 'x', jobId: 'job' }), /下载内容无效/);
  assert.deepEqual(ARCHIVE.deletes, ['x']);
});

test('recreation workflow downloads, analyzes, generates review assets and deletes the source', async () => {
  const job={
    id:'job-full',type:'psychology-recreation',status:'queued',title:'Full flow',created_by:'admin',
    payload_json:JSON.stringify({peerSource:{videoUrl:'https://www.tiktok.com/@creator/video/456',title:'Full flow',durationSeconds:5},voiceId:'voice-test-123'})
  };
  let analysis=null;
  const objects=new Map(), deleted=[];
  const DB={prepare(sql){return {args:[],bind(...args){this.args=args;return this;},async first(){
    if(/SELECT \* FROM factory_jobs/.test(sql))return job;
    if(/SELECT \* FROM factory_video_analyses/.test(sql))return analysis;
    if(/SELECT status,result_text/.test(sql))return analysis;
    return null;
  },async run(){
    if(/INSERT INTO factory_video_analyses/.test(sql)){
      const [id,owner_username,model,file_name,mime_type,file_size,prompt,r2_key,created_at,updated_at]=this.args;
      analysis={id,owner_username,model,file_name,mime_type,file_size,prompt,r2_key,created_at,updated_at,status:'queued',progress:5,result_text:'',error:'',google_file_name:'',input_tokens:0,output_tokens:0,provider:'google',provider_credits:0};
    }else if(/UPDATE factory_video_analyses SET/.test(sql)){
      const [status,progress,result_text,error,google_file_name,input_tokens,output_tokens,provider,provider_credits,updated_at,completed_at]=this.args;
      Object.assign(analysis,{status,progress,result_text,error,google_file_name,input_tokens,output_tokens,provider,provider_credits,updated_at,completed_at});
    }else if(/DELETE FROM factory_video_analyses/.test(sql))analysis=null;
    else if(/UPDATE factory_jobs/.test(sql)){
      const [status,percent,message,result_json,error,,completed_at]=this.args;
      Object.assign(job,{status,percent,message,result_json,error,completed_at});
    }
    return {meta:{changes:1}};
  }};}};
  const ARCHIVE={
    async put(key,body,options){const bytes=new Uint8Array(await new Response(body).arrayBuffer());objects.set(key,{bytes,options});return {size:bytes.byteLength};},
    async get(key){const object=objects.get(key);return object?{body:object.bytes,size:object.bytes.byteLength,httpMetadata:object.options?.httpMetadata}:null;},
    async delete(key){deleted.push(key);objects.delete(key);}
  };
  const generatedPlan={title:'A safer pause',language:'en',creativeDirection:'Warm cinematic realism with a recurring adult character in gentle window light.',scenes:[{startSeconds:0,endSeconds:4.5,observedVisual:'An adult studies a quiet phone while sitting beside a softly lit window.',narration:'A pause can feel personal before you know what actually happened.',visualPrompt:'Vertical 9:16 cinematic portrait of an adult beside a window holding a quiet phone, warm natural light, reflective mood, no text or logo.'}]};
  const audio=Buffer.alloc(1200,7).toString('base64');
  const fetchImpl=async (url,init={})=>{
    const value=String(url);
    if(value.startsWith('https://api.tikhub.io/')) return Response.json({code:200,request_id:'test-resolve',data:{aweme_detail:{aweme_id:'456',video:{play_addr:{url_list:['https://v16.tiktokcdn.com/source.mp4']}}}}});
    if(value==='https://v16.tiktokcdn.com/source.mp4')return new Response(mp4(),{headers:{'content-type':'video/mp4','content-length':'2048'}});
    if(value.endsWith('/upload/v1beta/files'))return new Response('{}',{status:200,headers:{'x-goog-upload-url':'https://upload.test/video'}});
    if(value==='https://upload.test/video')return Response.json({file:{name:'files/1',uri:'https://google.test/files/1',mimeType:'video/mp4',state:'PROCESSING'}});
    if(value.endsWith('/v1beta/files/1')&&init.method==='DELETE')return new Response(null,{status:204});
    if(value.endsWith('/v1beta/files/1'))return Response.json({name:'files/1',uri:'https://google.test/files/1',mimeType:'video/mp4',state:'ACTIVE'});
    if(value.includes(':generateContent'))return Response.json({candidates:[{content:{parts:[{text:JSON.stringify(generatedPlan)}]}}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:50}});
    if(value.includes('/api/v1/jobs/createTask'))return Response.json({code:200,data:{taskId:'image-1'}});
    if(value.includes('/api/v1/jobs/recordInfo'))return Response.json({code:200,data:{taskId:'image-1',state:'success',resultJson:JSON.stringify({resultUrls:['https://images.test/1.webp']})}});
    if(value==='https://images.test/1.webp')return new Response(new Uint8Array(512),{headers:{'content-type':'image/webp','content-length':'512'}});
    if(value.includes('api.elevenlabs.io'))return Response.json({audio_base64:audio,normalized_alignment:{character_end_times_seconds:[3.2]}});
    throw new Error(`Unexpected request ${value}`);
  };
  const env={DB,ARCHIVE,TIKHUB_API_KEY:'tikhub-test',GEMINI_API_KEY:'gemini',KIE_API_KEY:'kie',ELEVENLABS_API_KEY:'eleven',fetch:fetchImpl};
  const step={async do(name,options,run){return (typeof options==='function'?options:run)();},async sleep(){}};
  const result=await runPsychologyRecreationWorkflow(env,{payload:{jobId:'job-full'}},step);
  assert.equal(result.scenes,1);
  assert.equal(job.status,'done');
  const saved=JSON.parse(job.result_json);
  assert.equal(saved.materialStatus,'ready-for-review');
  assert.equal(saved.sourceDeleted,true);
  assert.equal(saved.sourceDownload.provider,'tikhub');
  assert.equal(saved.sourceDownload.size,2048);
  assert.equal(saved.scenes[0].imageStatus,'done');
  assert.equal(saved.scenes[0].audioStatus,'done');
  assert.equal(saved.scenes[0].audioDuration,3.2);
  assert.ok(objects.has('psychology-recreation/job-full/scene-0.image'));
  assert.ok(objects.has('psychology-recreation/job-full/scene-0.mp3'));
  assert.ok(deleted.includes('psychology-recreation-sources/job-full/source.mp4'));
  assert.equal(analysis,null);
});


test('download rejects missing file URLs and unsafe hosts before making any request', async () => {
  const env = { ARCHIVE: archive(), fetch() { throw new Error('Must not request an unsafe URL'); } };
  for (const videoFileUrl of [undefined, 'http://v16.tiktokcdn.com/video.mp4', 'https://127.0.0.1/video.mp4', 'https://tiktokcdn.com.example.org/video.mp4', 'https://user:pass@v16.tiktokcdn.com/video.mp4', 'https://v16.tiktokcdn.com:444/video.mp4']) {
    await assert.rejects(downloadTikTokToR2(env, { url: 'https://www.tiktok.com/@creator/video/123', videoFileUrl, r2Key: 'temp', jobId: '1' }), /尚未配置|HTTPS 视频文件地址/);
  }
  assert.equal(env.ARCHIVE.writes.length, 0);
});

test('download rejects HTML responses instead of submitting them to Gemini', async () => {
  const ARCHIVE = archive();
  const env = { ARCHIVE, fetch: async () => new Response('<html>blocked</html>', { headers: { 'content-type': 'text/html' } }) };
  await assert.rejects(downloadTikTokToR2(env, { url: 'https://www.tiktok.com/@creator/video/123', videoFileUrl: 'https://v16.tiktokcdn.com/source.mp4', r2Key: 'temp', jobId: '1' }), /不是视频文件/);
  assert.equal(ARCHIVE.writes.length, 0);
});
