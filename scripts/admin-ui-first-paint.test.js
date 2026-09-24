import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const root=new URL('../public/',import.meta.url);
const pages=fs.readdirSync(root).filter(name=>name.endsWith('.html')).map(name=>({name,html:fs.readFileSync(new URL(name,root),'utf8')})).filter(({html})=>/src=["']\/access\.js/.test(html)&&/class=["'][^"']*(side-tabs|tasks-sidebar)/.test(html));
test('every authenticated console uses the new theme on its initial document, before auth or JS completes',()=>{
 assert.ok(pages.length>=50);
 for(const {name,html} of pages){
  const head=html.slice(0,html.indexOf('</head>'));
  assert.match(html,/<body\b[^>]*class="[^"]*\blf-console\b/,name);
  const styles=[...head.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]);
  assert.match(styles.at(-2)||'',/href="\/theme-ops\.css"/,name+' preserves legacy override order');
  assert.match(styles.at(-1)||'',/href="\/admin-ui\.css"/,name+' must render-block on the final theme');
  assert.doesNotMatch(styles.at(-1),/media=|onload=|disabled/,name+' must not defer CSS application');
  assert.equal((html.match(/href="\/admin-ui\.css"/g)||[]).length,1,name);
  assert.match(head,/<script src="\/admin-ui\.js" defer><\/script>/,name+' shell must load in parallel');
  assert.match(styles.at(-1),/data-lf-console="true"/,name+' prevents duplicate dynamic injection');
 }
});
test('public login and setup pages do not acquire an authenticated navigation shell',()=>{
 for(const name of ['login.html','setup.html']){const html=fs.readFileSync(new URL(name,root),'utf8');assert.doesNotMatch(html,/lf-console|admin-ui\.css|admin-ui\.js/,name);}
});

test('legacy theme bootstrap reuses existing CSS and inserts any fallback before the console theme',()=>{
 const source=fs.readFileSync(new URL('access.js',root),'utf8');
 const fn=source.slice(source.indexOf('function ensureThemeStylesheet()'),source.indexOf('function ensureSidebarChrome('));
 const consoleTheme={href:'/admin-ui.css'};
 let inserted=[];
 const run=existing=>vm.runInNewContext(fn+';ensureThemeStylesheet();',{document:{querySelector:q=>q.includes('data-lf-theme')?existing:consoleTheme,createElement:()=>({dataset:{}}),head:{insertBefore:(node,before)=>inserted.push({node,before})}}});
 run({href:'/theme-ops.css'});assert.equal(inserted.length,0);
 run(null);assert.equal(inserted.length,1);assert.equal(inserted[0].before,consoleTheme);assert.equal(inserted[0].node.href,'/theme-ops.css');
});
