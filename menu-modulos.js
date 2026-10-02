
'use strict';
(async function(){
 const menu=document.querySelector('.sidebar .menu');if(!menu)return;
 const financeiro=location.pathname.startsWith('/financeiro');
 const token=sessionStorage.getItem('celulasSessao');
 let permitido=false,admin=false;
 if(token){try{const r=await fetch('/financeiro/api/cadastros',{headers:{Authorization:'Bearer '+token}});if(r.ok){const c=await r.json();permitido=true;admin=c.usuario.admin===true;}}catch(e){console.warn('Não foi possível consultar o acesso financeiro.');}}
 // O menu apenas organiza a navegação. Toda ação financeira continua validada pelo servidor.
 const legacyAdmin=localStorage.getItem('nivelUsuario')==='admin';
 const groups=[];
 if(admin||legacyAdmin)groups.push(['Acessos', [['Usuários','/usuarios.html'],['Permissões financeiras',permitido?'/financeiro/?view=acessos':null],['Permissões dos demais módulos',null]]]);
 groups.push(['Cadastros',[['Igrejas e campus',admin?'/financeiro/?view=igrejas':null],['Membros','/cadastro.html'],['Fornecedores',permitido?'/financeiro/?view=fornecedores':null],['Relatórios cadastrais',null]]]);
 groups.push(['Células',[['Células','/celulas.html'],['Presença','/presenca.html'],['Relatórios','/relatorios.html']]]);
 if(permitido)groups.push(['Financeiro',[['Resumo e saldos','/financeiro/?view=resumo'],['Bancos e caixas',admin?'/financeiro/?view=bancos':null],['Tipos de contas',admin?'/financeiro/?view=tipos':null],['Pagamentos','/financeiro/?view=pagamentos'],['Recebimentos','/financeiro/?view=recebimentos'],['Relatórios',null]]]);
 groups.push(['Painel',[['Visão geral','/painel.html']]]);
 groups.push(['Relatórios',[['Células e presença','/relatorios.html'],['Financeiro',null]]]);
 menu.replaceChildren();menu.hidden=false;menu.setAttribute('aria-label','Módulos do +Células');
 const view=new URLSearchParams(location.search).get('view')||'resumo';
 const current=financeiro?'/financeiro/?view='+view:location.pathname;
 let opened=false;
 for(const [name,items] of groups){
  const detail=document.createElement('details'),summary=document.createElement('summary');summary.textContent=name;detail.append(summary);
  for(const [label,href] of items){
   if(!href){const span=document.createElement('span');span.className='pendente';span.textContent=label;const small=document.createElement('small');small.textContent='Em desenvolvimento';span.append(small);detail.append(span);continue;}
   const a=document.createElement('a');a.href=href;a.textContent=label;
   if(href===current&&!opened){a.classList.add('ativo');a.setAttribute('aria-current','page');detail.open=true;opened=true;}
   detail.append(a);
  }
  menu.append(detail);
 }
 const sair=document.querySelector('#btnSair,#logout');
 if(sair)sair.addEventListener('click',()=>{sessionStorage.removeItem('celulasSessao');if(!financeiro&&token)fetch('/financeiro/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'}).catch(()=>{});},true);
})();
