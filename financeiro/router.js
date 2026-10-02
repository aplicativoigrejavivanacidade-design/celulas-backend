'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const D = require('./domain');
const uuid = v => typeof v==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const id = v => { const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw new Error('Identificador inválido.');return n; };
const texto = (v,max=200) => {if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error('Preencha o texto solicitado dentro do limite.');return v.trim();};
const optional = (v,max=1000) => v==null||v===''?'':texto(v,max);
const fail = (status,message) => Object.assign(new Error(message),{status});
function criarFinanceiro(pool) {
 const router=express.Router(), sessions=new Map(), attempts=new Map();
 function criarSessao(usuarioId) {
  for(const [k,v] of sessions) if(v.expires<Date.now()) sessions.delete(k);
  const token=crypto.randomBytes(32).toString('hex');
  sessions.set(token,{id:usuarioId,expires:Date.now()+3600000});
  return token;
 }
 const run=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
 async function auditoria(db,user,acao,entidade,entidadeId,detalhes={}) {
  await db.query('INSERT INTO fin_auditoria(usuario_id,acao,entidade,entidade_id,detalhes) VALUES($1,$2,$3,$4,$5)',[user.id,acao,entidade,entidadeId,JSON.stringify(detalhes)]);
 }
 async function tx(fn) {const c=await pool.connect();try{await c.query('BEGIN');const out=await fn(c);await c.query('COMMIT');return out;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 async function autenticar(req,res,next) {
  try {
   const token=String(req.headers.authorization||'').replace(/^Bearer /,'');const session=sessions.get(token);
   if(!session||session.expires<Date.now()) {sessions.delete(token);throw fail(401,'Entre novamente no financeiro.');}
   const r=await pool.query('SELECT id,nome,nivel FROM usuarios WHERE id=$1',[session.id]);
   if(!r.rows[0])throw fail(401,'Usuário não encontrado.');
   req.user=r.rows[0];req.user.admin=D.normalizarPerfil(req.user.nivel)==='admin';
   req.grants=(await pool.query('SELECT * FROM fin_acessos WHERE usuario_id=$1 AND ativo=TRUE',[req.user.id])).rows;
   if(!req.user.admin&&!req.grants.length)throw fail(403,'Acesso financeiro não concedido.');
   next();
  }catch(e){next(e);}
 }
 async function alcance(req,acao) {
  if(req.user.admin)return null;
  const grants=req.grants.filter(g=>g[acao]);
  if(grants.some(g=>g.unidade_id===null))return null;
  if(!grants.length)return [];
  const ids=grants.map(g=>g.unidade_id);
  return (await pool.query('WITH RECURSIVE arvore AS (SELECT id FROM fin_unidades WHERE id=ANY($1::int[]) UNION SELECT u.id FROM fin_unidades u JOIN arvore a ON u.pai_id=a.id) SELECT id FROM arvore',[ids])).rows.map(r=>r.id);
 }
 async function permitir(req,acao,unidade) {const allowed=await alcance(req,acao);if(allowed!==null&&!allowed.includes(Number(unidade)))throw fail(403,'Operação fora do seu alcance ou sem permissão.');}
 const admin=req=>{if(!req.user.admin)throw fail(403,'Operação exclusiva do Admin.');};
 router.get('/',(req,res)=>res.sendFile(path.join(__dirname,'financeiro.html')));
 router.post('/api/login',run(async(req,res)=>{
  const key=req.ip;const a=attempts.get(key);if(a&&a.lock>Date.now())throw fail(429,'Muitas tentativas. Aguarde 15 minutos.');
  const usuario=texto(req.body.usuario,100).toLowerCase(), senha=texto(req.body.senha,200);
  const r=await pool.query('SELECT id,nome,nivel FROM usuarios WHERE usuario=$1 AND senha=$2',[usuario,senha]);
  if(!r.rows[0]){const n=a&&a.until>Date.now()?a.n+1:1;attempts.set(key,{n,until:Date.now()+900000,lock:n>=5?Date.now()+900000:0});throw fail(401,'Usuário ou senha inválidos.');}
  const u=r.rows[0];if(D.normalizarPerfil(u.nivel)!=='admin'&&!(await pool.query('SELECT 1 FROM fin_acessos WHERE usuario_id=$1 AND ativo=TRUE LIMIT 1',[u.id])).rowCount)throw fail(403,'Acesso financeiro não concedido.');
  attempts.delete(key);const token=criarSessao(u.id);
  for(const [k,v] of sessions)if(v.expires<Date.now())sessions.delete(k);
  for(const [k,v] of attempts)if(v.until<Date.now()&&v.lock<Date.now())attempts.delete(k);
  res.set('Cache-Control','no-store');res.json({token,usuario:{...u,admin:D.normalizarPerfil(u.nivel)==='admin'}});
 }));
 router.use('/api',autenticar,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 router.post('/api/logout',run(async(req,res)=>{sessions.delete(String(req.headers.authorization||'').replace(/^Bearer /,''));res.json({ok:true});}));
 router.get('/api/cadastros',run(async(req,res)=>{
  const allowed=await alcance(req,'consultar');
  const unidades=await pool.query('SELECT * FROM fin_unidades WHERE ativo=TRUE AND ($1::int[] IS NULL OR id=ANY($1::int[])) ORDER BY nome',[allowed]);
  const contas=await pool.query('SELECT c.*, c.saldo_inicial+COALESCE(SUM(CASE WHEN k.tipo=\'receber\' THEN l.efetivo ELSE -l.efetivo END) FILTER(WHERE l.estornado_em IS NULL),0) AS saldo FROM fin_contas c LEFT JOIN fin_liquidacoes l ON l.conta_id=c.id LEFT JOIN fin_titulos t ON t.id=l.titulo_id LEFT JOIN fin_contratos k ON k.id=t.contrato_id WHERE c.ativo=TRUE AND ($1::int[] IS NULL OR c.unidade_id=ANY($1::int[])) GROUP BY c.id ORDER BY c.nome',[allowed]);
  res.json({usuario:req.user,unidades:unidades.rows,contas:contas.rows,categorias:(await pool.query('SELECT * FROM fin_categorias ORDER BY nome')).rows,fornecedores:(await pool.query('SELECT * FROM fin_fornecedores ORDER BY nome')).rows,permissoes:{lancar:await alcance(req,'lancar'),liquidar:await alcance(req,'liquidar'),estornar:await alcance(req,'estornar')}});
 }));
 router.post('/api/unidades',run(async(req,res)=>{admin(req);const b=req.body;const nome=texto(b.nome),tipo=b.tipo;if(!['igreja','campus','rede'].includes(tipo))throw fail(400,'Tipo de unidade inválido.');const pai=b.pai_id?id(b.pai_id):null;
  if(tipo!=='igreja'&&!pai)throw fail(400,'Informe a unidade superior.');
  if(tipo==='igreja'&&pai)throw fail(400,'Igreja deve ser a unidade principal.');
  const r=await tx(async c=>{if(pai){const parent=(await c.query('SELECT tipo FROM fin_unidades WHERE id=$1 AND ativo=TRUE',[pai])).rows[0];if(!parent||!(tipo==='campus'&&parent.tipo==='igreja'||tipo==='rede'&&parent.tipo==='campus'))throw fail(400,'Campus deve pertencer a igreja e rede a campus.');}const r=await c.query('INSERT INTO fin_unidades(nome,tipo,pai_id) VALUES($1,$2,$3) RETURNING *',[nome,tipo,pai]);await auditoria(c,req.user,'criar','unidade',r.rows[0].id);return r.rows[0];});res.status(201).json(r);
 }));
 router.post('/api/contas',run(async(req,res)=>{admin(req);const b=req.body;if(!['banco','caixa'].includes(b.tipo))throw fail(400,'Tipo de conta inválido.');const data=D.dataValida(b.data_saldo);if(data>D.hoje())throw fail(400,'Data do saldo inicial não pode ser futura.');const saldo=D.valorCentavos(b.saldo_inicial||'0',true)*(b.negativo===true?-1:1);
  const r=await tx(async c=>{const r=await c.query('INSERT INTO fin_contas(nome,tipo,unidade_id,saldo_inicial,data_saldo) VALUES($1,$2,$3,$4,$5) RETURNING *',[texto(b.nome),b.tipo,id(b.unidade_id),saldo,data]);await auditoria(c,req.user,'criar','conta',r.rows[0].id,{saldo_inicial:saldo});return r.rows[0];});res.status(201).json(r);
 }));
 router.post('/api/categorias',run(async(req,res)=>{admin(req);if(!['pagar','receber'].includes(req.body.tipo))throw fail(400,'Tipo inválido.');const r=await tx(async c=>{const r=await c.query('INSERT INTO fin_categorias(nome,tipo) VALUES($1,$2) RETURNING *',[texto(req.body.nome),req.body.tipo]);await auditoria(c,req.user,'criar','categoria',r.rows[0].id);return r.rows[0];});res.status(201).json(r);}));
 router.post('/api/fornecedores',run(async(req,res)=>{if(!req.user.admin&&(await alcance(req,'lancar'))?.length===0)throw fail(403,'Sem permissão de lançamento.');const b=req.body;const r=await tx(async c=>{const r=await c.query('INSERT INTO fin_fornecedores(nome,documento,telefone) VALUES($1,$2,$3) RETURNING *',[texto(b.nome),optional(b.documento,30),optional(b.telefone,30)]);await auditoria(c,req.user,'criar','fornecedor',r.rows[0].id);return r.rows[0];});res.status(201).json(r);}));
 router.get('/api/usuarios',run(async(req,res)=>{admin(req);res.json((await pool.query('SELECT id,nome,nivel FROM usuarios ORDER BY nome')).rows);}));
 router.get('/api/acessos',run(async(req,res)=>{admin(req);res.json((await pool.query('SELECT a.*,u.nome FROM fin_acessos a JOIN usuarios u ON u.id=a.usuario_id ORDER BY a.id')).rows);}));
 router.post('/api/acessos',run(async(req,res)=>{admin(req);const b=req.body;if(!['pastor_presidente','pastor_governo','pastor_rede','tesoureiro','consulta'].includes(b.perfil))throw fail(400,'Perfil inválido.');const unidade=b.unidade_id?id(b.unidade_id):null;
  if(['pastor_governo','pastor_rede'].includes(b.perfil)&&!unidade)throw fail(400,'Selecione o alcance do perfil pastoral.');
  const r=await tx(async c=>{if(unidade&&['pastor_governo','pastor_rede'].includes(b.perfil)){const u=(await c.query('SELECT tipo FROM fin_unidades WHERE id=$1',[unidade])).rows[0];if(!u||u.tipo!==(b.perfil==='pastor_governo'?'igreja':'rede'))throw fail(400,'Selecione igreja para Governo ou rede para Pastor de Rede.');}const r=await c.query('INSERT INTO fin_acessos(usuario_id,unidade_id,perfil,consultar,lancar,liquidar,estornar) VALUES($1,$2,$3,TRUE,$4,$5,$6) RETURNING *',[id(b.usuario_id),unidade,b.perfil,b.lancar===true,b.liquidar===true,b.estornar===true]);await auditoria(c,req.user,'conceder','acesso',r.rows[0].id,b);return r.rows[0];});res.status(201).json(r);
 }));
 router.post('/api/acessos/:id/revogar',run(async(req,res)=>{admin(req);await tx(async c=>{const r=await c.query('UPDATE fin_acessos SET ativo=FALSE WHERE id=$1 RETURNING id',[id(req.params.id)]);if(!r.rowCount)throw fail(404,'Acesso não encontrado.');await auditoria(c,req.user,'revogar','acesso',r.rows[0].id);});res.json({ok:true});}));
 router.post('/api/titulos',run(async(req,res)=>{const b=req.body;await permitir(req,'lancar',id(b.unidade_id));if(!['pagar','receber'].includes(b.tipo)||!uuid(b.chave))throw fail(400,'Tipo ou chave de lançamento inválido.');const total=D.valorCentavos(b.valor),schedule=D.parcelas(total,Number(b.parcelas),b.vencimento);const competencia=D.dataValida(b.competencia);
  const out=await tx(async c=>{const old=(await c.query('SELECT id FROM fin_contratos WHERE chave=$1',[b.chave])).rows[0];if(old)throw fail(409,'Este lançamento já foi registrado. Atualize a lista.');const cat=(await c.query('SELECT tipo FROM fin_categorias WHERE id=$1',[id(b.categoria_id)])).rows[0];if(!cat||cat.tipo!==b.tipo)throw fail(400,'Categoria incompatível com a conta.');const r=await c.query('INSERT INTO fin_contratos(descricao,tipo,unidade_id,categoria_id,fornecedor_id,total,parcelas,competencia,observacao,criado_por,chave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[texto(b.descricao),b.tipo,id(b.unidade_id),id(b.categoria_id),b.fornecedor_id?id(b.fornecedor_id):null,total,schedule.length,competencia,optional(b.observacao),req.user.id,b.chave]);for(const p of schedule)await c.query('INSERT INTO fin_titulos(contrato_id,numero,vencimento,valor) VALUES($1,$2,$3,$4)',[r.rows[0].id,p.numero,p.vencimento,p.valor]);await auditoria(c,req.user,'criar','contrato',r.rows[0].id,{total,parcelas:schedule.length});return r.rows[0];});res.status(201).json(out);
 }));
 router.get('/api/titulos',run(async(req,res)=>{const allowed=await alcance(req,'consultar');const de=req.query.de?D.dataValida(req.query.de):null,ate=req.query.ate?D.dataValida(req.query.ate):null;if(de&&ate&&de>ate)throw fail(400,'Período inválido.');const r=await pool.query("SELECT t.*,TO_CHAR(t.vencimento,'YYYY-MM-DD') AS vencimento,k.descricao,k.tipo,k.unidade_id,k.parcelas,c.nome AS categoria,f.nome AS fornecedor,u.nome AS unidade,t.valor-COALESCE(SUM(l.principal) FILTER(WHERE l.estornado_em IS NULL),0) AS saldo FROM fin_titulos t JOIN fin_contratos k ON k.id=t.contrato_id JOIN fin_categorias c ON c.id=k.categoria_id JOIN fin_unidades u ON u.id=k.unidade_id LEFT JOIN fin_fornecedores f ON f.id=k.fornecedor_id LEFT JOIN fin_liquidacoes l ON l.titulo_id=t.id WHERE ($1::int[] IS NULL OR k.unidade_id=ANY($1::int[])) AND ($2::date IS NULL OR t.vencimento >= $2::date) AND ($3::date IS NULL OR t.vencimento <= $3::date) GROUP BY t.id,k.id,c.nome,f.nome,u.nome ORDER BY t.vencimento,t.id LIMIT 1001",[allowed,de,ate]);res.json({registros:r.rows.slice(0,1000),limite:r.rows.length>1000});}));
 router.get('/api/titulos/:id/liquidacoes',run(async(req,res)=>{const t=(await pool.query('SELECT k.unidade_id FROM fin_titulos t JOIN fin_contratos k ON k.id=t.contrato_id WHERE t.id=$1',[id(req.params.id)])).rows[0];if(!t)throw fail(404,'Conta não encontrada.');await permitir(req,'consultar',t.unidade_id);res.json((await pool.query('SELECT l.*,TO_CHAR(l.data,\'YYYY-MM-DD\') AS data,c.nome AS conta FROM fin_liquidacoes l JOIN fin_contas c ON c.id=l.conta_id WHERE titulo_id=$1 ORDER BY l.id',[id(req.params.id)])).rows);}));
 router.post('/api/titulos/:id/liquidar',run(async(req,res)=>{const b=req.body;if(!uuid(b.chave))throw fail(400,'Chave inválida.');const data=D.dataValida(b.data);if(data>D.hoje())throw fail(400,'Recebimento ou pagamento não pode ter data futura.');if(!['dinheiro','pix','deposito','boleto','debito','cartao','outro'].includes(b.meio))throw fail(400,'Meio inválido.');
  const out=await tx(async c=>{const t=(await c.query('SELECT t.*,k.unidade_id FROM fin_titulos t JOIN fin_contratos k ON k.id=t.contrato_id WHERE t.id=$1 FOR UPDATE OF t',[id(req.params.id)])).rows[0];if(!t)throw fail(404,'Conta não encontrada.');await permitir(req,'liquidar',t.unidade_id);const conta=(await c.query('SELECT * FROM fin_contas WHERE id=$1 AND ativo=TRUE',[id(b.conta_id)])).rows[0];if(!conta)throw fail(400,'Conta financeira inválida.');await permitir(req,'liquidar',conta.unidade_id);if(data<String(conta.data_saldo).slice(0,10)&&!(conta.data_saldo instanceof Date))throw fail(400,'Data anterior ao saldo inicial da conta.');const corte=conta.data_saldo instanceof Date?conta.data_saldo.toISOString().slice(0,10):String(conta.data_saldo).slice(0,10);if(data<corte)throw fail(400,'Data anterior ao saldo inicial da conta.');const paid=(await c.query('SELECT COALESCE(SUM(principal),0) AS pago FROM fin_liquidacoes WHERE titulo_id=$1 AND estornado_em IS NULL',[t.id])).rows[0];const principal=D.valorCentavos(b.principal),juros=D.valorCentavos(b.juros||'0',true),multa=D.valorCentavos(b.multa||'0',true),desconto=D.valorCentavos(b.desconto||'0',true);const result=D.pagamento(Number(t.valor)-Number(paid.pago),principal,juros,multa,desconto);const r=await c.query('INSERT INTO fin_liquidacoes(titulo_id,conta_id,data,principal,juros,multa,desconto,efetivo,meio,comprovante,observacao,criado_por,chave) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *',[t.id,conta.id,data,principal,juros,multa,desconto,result.movimento,b.meio,optional(b.comprovante,500),optional(b.observacao),req.user.id,b.chave]);await auditoria(c,req.user,'liquidar','titulo',t.id,{liquidacao:r.rows[0].id,...result});return r.rows[0];});res.status(201).json(out);
 }));
 router.post('/api/liquidacoes/:id/estornar',run(async(req,res)=>{const motivo=texto(req.body.motivo,500);await tx(async c=>{const l=(await c.query('SELECT l.*,k.unidade_id FROM fin_liquidacoes l JOIN fin_titulos t ON t.id=l.titulo_id JOIN fin_contratos k ON k.id=t.contrato_id WHERE l.id=$1',[id(req.params.id)])).rows[0];if(!l)throw fail(404,'Liquidação não encontrada.');await permitir(req,'estornar',l.unidade_id);const conta=(await c.query('SELECT unidade_id FROM fin_contas WHERE id=$1',[l.conta_id])).rows[0];await permitir(req,'estornar',conta.unidade_id);await c.query('SELECT id FROM fin_titulos WHERE id=$1 FOR UPDATE',[l.titulo_id]);const r=await c.query('UPDATE fin_liquidacoes SET estornado_em=NOW(),estornado_por=$1,motivo_estorno=$2 WHERE id=$3 AND estornado_em IS NULL RETURNING id',[req.user.id,motivo,l.id]);if(!r.rowCount)throw fail(409,'Esta liquidação já foi estornada.');await auditoria(c,req.user,'estornar','liquidacao',l.id,{motivo});});res.json({ok:true});}));
 router.use((req,res)=>res.status(404).json({erro:'Recurso financeiro não encontrado.'}));
 router.use((e,req,res,next)=>{if(e.code==='23505')return res.status(409).json({erro:'Registro já existente. Atualize a lista antes de repetir.'});if(e.code==='23503')return res.status(400).json({erro:'Cadastro vinculado não encontrado.'});const status=e.status||(e.message&&/inválid|Informe|Preencha|Valor|Parcelamento|Liquidação/.test(e.message)?400:500);if(status===500)console.error('Financeiro:',e.message);res.status(status).json({erro:status===500?'Erro interno no financeiro.':e.message});});
 return {router,criarSessao,iniciar:()=>pool.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'))};
}
module.exports={criarFinanceiro};
