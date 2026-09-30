'use strict';
function valorCentavos(valor, permiteZero = false) {
  if (typeof valor !== 'string' || !/^\d{1,10}(?:[.,]\d{1,2})?$/.test(valor.trim())) throw new Error('Informe um valor válido com até duas casas decimais.');
  const [inteiro, decimal = ''] = valor.trim().replace(',', '.').split('.');
  const n = Number(inteiro) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(n) || n < (permiteZero ? 0 : 1)) throw new Error('Valor fora do intervalo permitido.');
  return n;
}
function dataValida(data) {
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Data inválida.');
  const d = new Date(data + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== data) throw new Error('Data inválida.');
  return data;
}
function hoje() { return new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function vencimentoMes(data, deslocamento) {
  dataValida(data);
  const [ano, mes, dia] = data.split('-').map(Number);
  const base = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(dia, ultimo));
  return base.toISOString().slice(0, 10);
}
function parcelas(total, quantidade, primeiraData) {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 120 || total < quantidade) throw new Error('Parcelamento inválido. Use de 1 a 120 parcelas, com ao menos um centavo por parcela.');
  dataValida(primeiraData);
  const base = Math.floor(total / quantidade), resto = total % quantidade;
  return Array.from({length:quantidade}, (_, i) => ({numero:i+1,valor:base+(i<resto?1:0),vencimento:vencimentoMes(primeiraData,i)}));
}
function pagamento(saldo, principal, juros, multa, desconto) {
  if (![saldo, principal, juros, multa, desconto].every(Number.isSafeInteger) || principal <= 0 || principal > saldo || juros < 0 || multa < 0 || desconto < 0 || desconto > principal) throw new Error('Liquidação inválida. Principal e desconto não podem ultrapassar a obrigação.');
  return {saldo:saldo-principal, movimento:principal+juros+multa-desconto};
}
function normalizarPerfil(nivel) { return String(nivel||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,''); }
module.exports = {valorCentavos,dataValida,hoje,vencimentoMes,parcelas,pagamento,normalizarPerfil};
