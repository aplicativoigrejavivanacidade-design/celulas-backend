const test=require('node:test');const assert=require('node:assert/strict');
const express=require('express');const {criarFinanceiro}=require('../financeiro/router');
async function harness(fn){
 let revoked=false;
 const query=async(sql,p=[])=>{
  if(sql.startsWith('SELECT id,nome,nivel FROM usuarios WHERE usuario'))return {rows:p[0]==='admin'&&p[1]==='teste'? [{id:1,nome:'Admin',nivel:'admin'}]:p[0]==='tesoureiro'&&p[1]==='teste'?[{id:2,nome:'Tesoureiro',nivel:'lider'}]:[],rowCount:0};
  if(sql.startsWith('SELECT id,nome,nivel FROM usuarios WHERE id'))return {rows:[{id:p[0],nome:'Teste',nivel:p[0]===1?'admin':'lider'}]};
  if(sql.startsWith('SELECT 1 FROM fin_acessos'))return {rows:[{}],rowCount:1};
  if(sql.startsWith('SELECT * FROM fin_acessos'))return {rows:revoked?[]:[{unidade_id:5,consultar:true,lancar:false,liquidar:false,estornar:false}]};
  if(sql.startsWith('WITH RECURSIVE'))return {rows:[{id:5}]};
  if(sql.startsWith('SELECT t.*,k.unidade_id'))return {rows:[{id:1,unidade_id:8,valor:'10000'}]};
  if(sql==='BEGIN'||sql==='ROLLBACK'||sql==='COMMIT')return {rows:[]};
  throw new Error('Consulta inesperada no teste: '+sql);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const app=express();app.use(express.json());app.use('/financeiro',criarFinanceiro(pool).router);
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port+'/financeiro/api/';
 const call=async(route,method='GET',body,token)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json()};};
 try{await fn(call,()=>revoked=true);}finally{await new Promise(r=>server.close(r));}
}
test('rotas financeiras recusam acesso sem sessão e token inventado',()=>harness(async call=>{
 assert.equal((await call('cadastros')).status,401);assert.equal((await call('cadastros','GET',undefined,'inventado')).status,401);
}));
test('login financeiro não devolve senha e logout invalida sessão',()=>harness(async call=>{
 const login=await call('login','POST',{usuario:'admin',senha:'teste'});assert.equal(login.status,200);assert.equal(login.body.usuario.senha,undefined);
 assert.equal((await call('logout','POST',{},login.body.token)).status,200);
 assert.equal((await call('cadastros','GET',undefined,login.body.token)).status,401);
}));
test('perfil enviado pelo cliente não concede Admin nem liquidação',()=>harness(async call=>{
 const login=await call('login','POST',{usuario:'tesoureiro',senha:'teste'});const token=login.body.token;
 assert.equal((await call('unidades','POST',{nome:'Tentativa',tipo:'igreja',nivelUsuario:'admin'},token)).status,403);
 assert.equal((await call('titulos','POST',{unidade_id:5,nivelUsuario:'admin'},token)).status,403);
 assert.equal((await call('titulos/1/liquidar','POST',{data:'2026-01-01',meio:'pix',chave:'550e8400-e29b-41d4-a716-446655440000',nivelUsuario:'admin'},token)).status,403);
}));
test('revogação de acesso vale para uma sessão existente',()=>harness(async(call,revoke)=>{
 const login=await call('login','POST',{usuario:'tesoureiro',senha:'teste'});revoke();
 assert.equal((await call('cadastros','GET',undefined,login.body.token)).status,403);
}));
test('limite de tentativas no acesso financeiro',()=>harness(async call=>{
 for(let i=0;i<5;i++)assert.equal((await call('login','POST',{usuario:'erro',senha:'erro'})).status,401);
 assert.equal((await call('login','POST',{usuario:'admin',senha:'teste'})).status,429);
}));
