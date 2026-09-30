const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../financeiro/domain');
test('valores brasileiros e decimais sem perda de centavos',()=>{
 assert.equal(D.valorCentavos('1,01'),101);assert.equal(D.valorCentavos('10000.99'),1000099);
 assert.equal(D.valorCentavos('0',true),0);
 for(const v of ['-1','1.234','1,234','NaN','1e3','',null,2,'1.000,00'])assert.throws(()=>D.valorCentavos(v));
});
test('parcelas somam exatamente o total e preservam o dia original',()=>{
 const p=D.parcelas(10000,3,'2026-01-31');assert.deepEqual(p.map(x=>x.valor),[3334,3333,3333]);
 assert.deepEqual(p.map(x=>x.vencimento),['2026-01-31','2026-02-28','2026-03-31']);
 assert.equal(D.parcelas(500,2,'2028-01-31')[1].vencimento,'2028-02-29');
 for(let q=1;q<=120;q++)assert.equal(D.parcelas(999999,q,'2026-11-30').reduce((a,p)=>a+p.valor,0),999999);
 assert.throws(()=>D.parcelas(2,3,'2026-01-01'));assert.throws(()=>D.parcelas(100,0,'2026-01-01'));
});
test('pagamento parcial separa caixa e saldo da obrigação',()=>{
 assert.deepEqual(D.pagamento(10000,4000,100,20,50),{saldo:6000,movimento:4070});
 assert.deepEqual(D.pagamento(6000,6000,0,0,100),{saldo:0,movimento:5900});
 assert.throws(()=>D.pagamento(6000,6001,0,0,0));assert.throws(()=>D.pagamento(6000,5000,0,0,5001));
 assert.throws(()=>D.pagamento(6000,0,0,0,0));
});
test('datas inexistentes e perfis normalizados',()=>{
 assert.throws(()=>D.dataValida('2026-02-29'));assert.throws(()=>D.dataValida('2026-13-01'));
 assert.equal(D.dataValida('2028-02-29'),'2028-02-29');assert.equal(D.normalizarPerfil('ADMIN'),'admin');
});
