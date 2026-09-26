import {UI_ASSETS} from './ui-asset-manifest.js';
const VERSION='__asset';
export function uiAssetUrl(value,base){
 if(!value)return value;
 const url=new URL(value,base);
 if(url.origin!==new URL(base).origin||!Object.hasOwn(UI_ASSETS,url.pathname))return value;
 url.searchParams.set(VERSION,UI_ASSETS[url.pathname]);
 return url.pathname+url.search+url.hash;
}
export async function serveUiAsset(request,env,url){
 if(!['GET','HEAD'].includes(request.method)||!Object.hasOwn(UI_ASSETS,url.pathname))return null;
 if(!env.ASSETS)return new Response('Static assets unavailable',{status:503});
 const assetUrl=new URL(url);assetUrl.search='';
 const response=await env.ASSETS.fetch(new Request(assetUrl,request));
 const headers=new Headers(response.headers);
 const validType=/^(text\/css|(?:text|application)\/javascript|image\/svg\+xml)(?:;|$)/i.test(headers.get('content-type')||'');
 const success=[200,304].includes(response.status)&&validType;
 headers.set('Cache-Control',success?(url.searchParams.get(VERSION)===UI_ASSETS[url.pathname]?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate'):'no-store');
 headers.delete('Set-Cookie');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function versionPageAssets(response,request){
 if(!response.ok||!(response.headers.get('content-type')||'').includes('text/html'))return response;
 const headers=new Headers(response.headers);headers.set('Cache-Control','private, no-store');
 headers.delete('ETag');headers.delete('Content-Length');
 const page=new Response(response.body,{status:response.status,headers});
 const handler=attribute=>({element(element){const value=element.getAttribute(attribute);if(value)element.setAttribute(attribute,uiAssetUrl(value,request.url));}});
 return new HTMLRewriter().on('script[src]',handler('src')).on('link[href]',handler('href')).on('img[src]',handler('src')).transform(page);
}
