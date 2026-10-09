import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import puppeteer from 'puppeteer-core';
import {fixture} from '../factory-cloud/src/psychology-cloud-test-fixture.js';
import {handleAccounts,toPublicUser} from '../factory-cloud/src/auth.js';
import {publicSidebarModules} from '../factory-cloud/src/sidebar.js';
import {pageFileFor} from '../factory-cloud/src/pages.js';
test('admin can grant every psychology checkbox to a member and save exactly one; child-only grant remains navigable',async t=>{
 const f=await fixture(t);f.sqlite.prepare("INSERT INTO factory_users(id,username,role,password_hash,password_salt,sidebar_modules_json,created_at,updated_at) VALUES('member','member','operator','','','[]',0,0)").run();
 const root=fileURLToPath(new URL('../public/',import.meta.url)),out=fileURLToPath(new URL('../tmp/psychology-member-qa/',import.meta.url));fs.mkdirSync(out,{recursive:true});
 let identity='admin';const current=()=>toPublicUser(f.sqlite.prepare('SELECT * FROM factory_users WHERE id=?').get(identity));
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1:'+server.address().port);let response;
  if(url.pathname==='/api/auth/me')response=Response.json({user:current(),sidebarModules:publicSidebarModules(),home:'/'});
  else if(url.pathname.startsWith('/api/admin/')){const parts=[];for await(const part of req)parts.push(part);response=await handleAccounts(new Request(url,{method:req.method,headers:req.headers,...(parts.length?{body:Buffer.concat(parts)}:{})}),f.env,url,{user:current()});}
  else {const file=path.resolve(root,pageFileFor(url.pathname)||url.pathname.slice(1));if(!file.startsWith(root)||!fs.existsSync(file)){res.writeHead(404).end();return;}response=new Response(fs.readFileSync(file),{headers:{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}});}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.writeHead(500).end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),origin='http://127.0.0.1:'+server.address().port,errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)||r.url().startsWith('data:')?r.continue():r.abort());
 await page.setViewport({width:1440,height:1000});await page.goto(origin+'/accounts',{waitUntil:'networkidle0'});await page.click('[data-edit-user="member"]');
 const card='[data-group-id="psychology"]';assert.equal(await page.$eval('#userRole',n=>n.value),'operator');assert.equal(await page.$$eval(card+' .child-switch',nodes=>nodes.length),17);assert.equal(await page.$$eval(card+' .child-switch:checked',nodes=>nodes.length),0);
 await page.click(card+' .group-switch');assert.equal(await page.$$eval(card+' .child-switch:checked',nodes=>nodes.length),17);await page.click(card+' .group-switch');
 await page.click(card+' [value="psychology-video-hits"]');const response=page.waitForResponse(r=>r.url().endsWith('/api/admin/accounts/member')&&r.request().method()==='PATCH');await page.click('#userForm [type=submit]');assert.equal((await response).status(),200);await page.waitForFunction(()=>document.querySelector('#userId').value==='');
 const saved=toPublicUser(f.sqlite.prepare("SELECT * FROM factory_users WHERE id='member'").get());assert.equal(saved.role,'operator');assert.deepEqual(saved.sidebarModules,['psychology-video-hits']);
 await page.reload({waitUntil:'networkidle0'});await page.click('[data-edit-user="member"]');assert.equal(await page.$$eval(card+' .child-switch:checked',nodes=>nodes.map(n=>n.value)).then(v=>v.join(',')),'psychology-video-hits');
 for(const width of [1440,390]){await page.setViewport({width,height:1000});await page.$eval(card,n=>n.scrollIntoView());await (await page.$(card)).screenshot({path:path.join(out,'checkboxes-'+width+'.png')});assert.equal(await page.$$eval(card+' .child-switch',nodes=>nodes.every(n=>{const r=n.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth;})),true);}
 f.sqlite.prepare("UPDATE factory_users SET sidebar_modules_json='[\"psychology-collage\"]' WHERE id='member'").run();identity='member';await page.goto(origin+'/psychology-templates',{waitUntil:'networkidle0'});assert.ok(await page.$('a[data-sidebar-module="psychology-collage"]'));assert.equal(await page.$('a[data-sidebar-module="accounts"]'),null);assert.deepEqual(errors,[]);assert.equal(f.requests.length,0);
});
