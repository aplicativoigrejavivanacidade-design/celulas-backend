const test=require('node:test');const assert=require('node:assert/strict');const express=require('express');const {criarFinanceiro}=require('../financeiro/router');
test('sessão do login principal usa autenticação financeira e valida perfil no servidor',async()=>{
 let grants=true;
 const pool={query:async(sql,p=[])=>{
  if(sql.startsWith('SELECT id,nome,nivel FROM usuarios WHERE id'))return {rows:[{id:p[0],nome:'Líder',nivel:'lider'}]};
  if(sql.startsWith('SELECT * FROM fin_acessos'))return {rows:grants?[{unidade_id:1,consultar:true,lancar:false,liquidar:false,estornar:false}]:[]};
  throw Error('Consulta inesperada');
 }};
 const modulo=criarFinanceiro(pool),token=modulo.criarSessao(7),app=express();app.use(express.json());app.use('/financeiro',modulo.router);
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port+'/financeiro/api/';
 const call=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
 try{
  assert.equal((await call('unidades',{nome:'Igreja',tipo:'igreja',admin:true})).status,403);
  grants=false;assert.equal((await call('unidades',{nome:'Igreja',tipo:'igreja'})).status,403);
  grants=true;assert.equal((await call('logout',{})).status,200);assert.equal((await call('unidades',{})).status,401);
 }finally{await new Promise(r=>server.close(r));}
});
