import assert from "node:assert/strict";
import test from "node:test";
import { createGeminiVideoSourceUrl, handleGeminiVideoSource } from "./gemini-video-source.js";

test("signed Gemini video source streams the private R2 object", async () => {
  const now = Date.UTC(2026, 8, 16, 8, 0, 0);
  const signedUrl = await createGeminiVideoSourceUrl({
    baseUrl: "https://factory.test",
    analysisId: "analysis-1",
    secret: "kie-secret",
    expiresAt: now + 60 * 60 * 1000
  });
  const env = {
    KIE_API_KEY: "kie-secret",
    DB: { prepare() { return { bind() { return this; }, async first() { return { r2_key: "videos/1.mp4", mime_type: "video/mp4", file_size: 5, status: "processing" }; } }; } },
    ARCHIVE: { async get(key) { assert.equal(key, "videos/1.mp4"); return { body: new Uint8Array([1, 2, 3, 4, 5]), size: 5, range: { offset: 0, length: 5 }, httpEtag: "etag" }; } }
  };
  const request = new Request(signedUrl);
  const response = await handleGeminiVideoSource(request, env, new URL(signedUrl), now);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-range"), null);
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4, 5]));
});

test("Gemini video source rejects a tampered or expired signature", async () => {
  const now = Date.UTC(2026, 8, 16, 8, 0, 0);
  const url = await createGeminiVideoSourceUrl({
    baseUrl: "https://factory.test",
    analysisId: "analysis-1",
    secret: "kie-secret",
    expiresAt: now + 60 * 1000
  });
  const env = { KIE_API_KEY: "kie-secret" };
  const tampered = new URL(url);
  tampered.searchParams.set("signature", "00");
  assert.equal((await handleGeminiVideoSource(new Request(tampered), env, tampered, now)).status, 401);
  assert.equal((await handleGeminiVideoSource(new Request(url), env, new URL(url), now + 2 * 60 * 1000)).status, 401);
});


test("signed source returns 206 only for an actual partial range request", async () => {
  const now=Date.UTC(2026,8,16,8);
  const signedUrl=await createGeminiVideoSourceUrl({baseUrl:"https://factory.test",analysisId:"analysis-range",secret:"kie-secret",expiresAt:now+60000});
  const env={
    KIE_API_KEY:"kie-secret",
    DB:{prepare(){return{bind(){return this;},async first(){return{r2_key:"source.mp4",mime_type:"video/mp4",file_size:5,status:"processing"};}};}},
    ARCHIVE:{async get(key,options){assert.equal(key,"source.mp4");assert.equal(options.range.get("range"),"bytes=1-2");return{body:new Uint8Array([2,3]),size:5,range:{offset:1,length:2}};}}
  };
  const response=await handleGeminiVideoSource(new Request(signedUrl,{headers:{range:"bytes=1-2"}}),env,new URL(signedUrl),now);
  assert.equal(response.status,206);
  assert.equal(response.headers.get("content-range"),"bytes 1-2/5");
  assert.equal(response.headers.get("content-length"),"2");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([2,3]));
});
