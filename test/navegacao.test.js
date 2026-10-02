const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
function boot(pathname,level='admin',cached){
 const storage=new Map([['celulasSessao','session']]);if(cached)storage.set('celulasMenu',JSON.stringify(cached));
 function element(tag){return {tag,children:[],dataset:{},classList:{add(){}},append(...nodes){this.children.push(...nodes)},replaceChildren(){this.children=[]},setAttribute(){}};}
 const menu=element('nav');menu.hidden=true;let requests=0;const listeners={};
 const context={document:{querySelector:()=>menu,createElement:element,addEventListener:(name,fn)=>listeners[name]=fn},location:{pathname,search:''},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem:()=>level},URLSearchParams,fetch:()=>{requests++;return new Promise(()=>{})}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'menu-modulos.js'),'utf8'),context);
 return {menu,requests,listeners,labels:()=>menu.children.map(x=>x.children[0].textContent)};
}
test('menu novo aparece sem aguardar a resposta do servidor',()=>{const b=boot('/painel.html');assert.equal(b.requests,1);assert.equal(b.menu.hidden,false);assert.equal(b.menu.dataset.modulos,'true');assert(b.labels().includes('Financeiro'));assert(b.labels().includes('Células'));});
test('Financeiro reutiliza a consulta da própria tela e conserva o menu ao confirmar o mesmo acesso',()=>{const b=boot('/financeiro/');assert.equal(b.requests,0);const first=b.menu.children[0];b.listeners['celulas:financeiro']({detail:{admin:true}});assert.equal(b.menu.children[0],first);});
test('cache de outro login não concede opção financeira ao menu',()=>{const b=boot('/painel.html','lider',{token:'other',permitido:true,admin:true});assert(!b.labels().includes('Financeiro'));assert(!b.labels().includes('Acessos'));});
test('conteúdo financeiro só é exibido após preparar a tela solicitada',()=>{const s=fs.readFileSync(path.join(root,'financeiro/financeiro.html'),'utf8');assert(s.includes('id="app" hidden'));assert(s.includes("await refresh();document.getElementById('loading').hidden=true;document.getElementById('app').hidden=false"));assert(s.includes('applyView();}'));assert(s.includes('id="loading" role="status"'));});
