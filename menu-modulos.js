
'use strict';
(function(){
 const menu=document.querySelector('.sidebar .menu');if(!menu)return;
 const financeiro=location.pathname.startsWith('/financeiro');
 const token=sessionStorage.getItem('celulasSessao');
 let cached={};try{cached=JSON.parse(sessionStorage.getItem('celulasMenu')||'{}');}catch(e){}
 const legacyAdmin=localStorage.getItem('nivelUsuario')==='admin';
 let permitido=!!token&&(legacyAdmin||financeiro||(cached.token===token&&cached.permitido===true));
 let admin=!!token&&(legacyAdmin||(cached.token===token&&cached.admin===true));
 function render(){
 // O menu apenas organiza a navegação. Toda ação financeira continua validada pelo servidor.
 const groups=[];
 if(admin||legacyAdmin)groups.push(['Acessos', [['Usuários','/usuarios.html'],['Permissões financeiras',permitido?'/financeiro/?view=acessos':null],['Permissões dos demais módulos',null]]]);
 groups.push(['Cadastros',[['Igrejas e campus',admin?'/financeiro/?view=igrejas':null],['Membros','/cadastro.html'],['Fornecedores',permitido?'/financeiro/?view=fornecedores':null],['Relatórios cadastrais',null]]]);
 groups.push(['Células',[['Células','/celulas.html'],['Presença','/presenca.html'],['Relatórios','/relatorios.html']]]);
 if(permitido)groups.push(['Financeiro',[['Resumo e saldos','/financeiro/?view=resumo'],['Bancos e caixas',admin?'/financeiro/?view=bancos':null],['Tipos de contas',admin?'/financeiro/?view=tipos':null],['Pagamentos','/financeiro/?view=pagamentos'],['Recebimentos','/financeiro/?view=recebimentos'],['Relatórios',null]]]);
 groups.push(['Painel',[['Visão geral','/painel.html']]]);
 groups.push(['Relatórios',[['Células e presença','/relatorios.html'],['Financeiro',null]]]);
 menu.replaceChildren();menu.dataset.modulos='true';menu.hidden=false;menu.setAttribute('aria-label','Módulos do +Células');
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
 }
 render();
 function update(value){
  sessionStorage.setItem('celulasMenu',JSON.stringify({token,permitido:value.permitido,admin:value.admin}));
  if(permitido!==value.permitido||admin!==value.admin){permitido=value.permitido;admin=value.admin;render();}
 }
 document.addEventListener('celulas:financeiro',e=>update({permitido:true,admin:e.detail.admin===true}));
 if(token&&!financeiro)fetch('/financeiro/api/sessao',{headers:{Authorization:'Bearer '+token}}).then(async r=>{
  if(r.ok){const c=await r.json();update({permitido:true,admin:c.usuario.admin===true});}
  else if(r.status===401||r.status===403)update({permitido:false,admin:false});
 }).catch(()=>{});
 document.addEventListener('click',e=>{
  if(!e.target.closest('#btnSair,#logout'))return;
  sessionStorage.removeItem('celulasSessao');sessionStorage.removeItem('celulasMenu');
  if(!financeiro&&token)fetch('/financeiro/api/logout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:'{}'}).catch(()=>{});
 },true);
})();
