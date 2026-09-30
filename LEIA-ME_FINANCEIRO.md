# Módulo financeiro do Mais Células

Entrega inicial v0.1 — 30/09/2026. Código para desenvolvimento e validação. Não substituir a produção por este pacote nesta etapa.

## O que está implementado

- Tela própria em /financeiro/, com acesso usando as credenciais existentes e sessão financeira de uma hora.
- Admin com acesso total ao módulo.
- Cadastro da árvore igreja → campus → rede.
- Concessão e revogação de acesso financeiro por usuário, perfil, alcance e ação.
- Perfis Pastor Presidente, Pastor de Governo, Pastor de Rede, tesoureiro e consulta. Os níveis pastorais têm alcance atribuído explicitamente; não são inferidos do nome do usuário.
- Cadastros de bancos e caixas, saldo inicial, categorias e fornecedores.
- Contas a pagar e receber à vista ou parceladas mensalmente.
- Distribuição dos centavos entre parcelas e preservação do dia de vencimento após meses curtos.
- Liquidações parciais com principal, juros, multa, desconto, conta e meio de pagamento.
- Estorno com motivo, autoria e histórico.
- Saldo por conta e listagem por vencimento, com saldo aberto e identificação de atraso.
- Bloqueio de pagamento acima do saldo, datas realizadas futuras e data anterior ao saldo inicial.
- Chave única de envio para evitar duplicidade por repetição do mesmo pedido.
- Transação de banco e bloqueio da parcela durante pagamento e estorno.

O fluxo de liquidação não executa pagamento bancário. Registra pagamentos e recebimentos já realizados. Comprovante nesta etapa é uma referência textual, sem upload de arquivo.

## O que permanece nas próximas etapas

Arrecadação opcional na Presença, contagem de cultos e conferência de repasses; vínculo histórico entre célula e rede; recorrências; transferências entre contas; importação de extratos e conciliação; migração conferida da planilha; relatórios completos e exportações. A hierarquia financeira desta entrega não substitui ainda a hierarquia geral dos controles de células.

O resumo atual totaliza as parcelas exibidas, não um fluxo de caixa mensal completo. A consulta tem limite de 1.000 parcelas e avisa quando o período deve ser reduzido.

## Preparar o ambiente de testes

1. Criar uma branch de desenvolvimento a partir da versão-base recebida. Não enviar este pacote à main, pois o Render atual publica automaticamente.
2. Preparar um banco PostgreSQL separado. Não usar o DATABASE_URL da produção. O startup legado contém migrações e atualizações históricas, por isso executar o aplicativo inteiro exige uma cópia controlada de desenvolvimento.
3. Manter os arquivos atuais do projeto. Substituir apenas index.js e adicionar financeiro/ e test/ deste pacote. package.json e package-lock.json são cópias da base, sem novas dependências.
4. Instalar as dependências existentes com npm ci.
5. Definir DATABASE_URL do banco de desenvolvimento e FINANCEIRO_ATIVO=true. Sem essa variável, a rota financeira fica desativada e suas tabelas não são criadas.
6. Executar npm start e abrir /financeiro/. A criação das tabelas financeiras ocorre após a inicialização das tabelas legadas.
7. Entrar como Admin, cadastrar igreja, campus e rede, contas e categorias. Conferir o saldo inicial antes de lançar liquidações.
8. Conceder alcance aos tesoureiros e aos pastores pelo cadastro Hierarquia e acessos. Governo deve receber uma igreja e Pastor de Rede uma rede. Presidente e tesoureiros podem receber alcance global ou atribuído.
9. Testar contas parceladas, pagamentos parciais, estornos e acesso com usuários distintos.

Sessões são mantidas em memória nesta versão: reiniciar o serviço exige novo login. A chave de envio é gerada pela tela; uma repetição que retorne conflito exige conferir a lista antes de tentar novamente.

## Validação executada

Comando: node --test test/financeiro*.test.js

Nove testes passaram: valores e centavos, parcelas e calendário, pagamentos parciais e limites, datas, sessão obrigatória, logout, permissões verificadas no servidor, revogação e limitação de tentativas de login.

Os testes de API usam um banco simulado para verificar respostas e autorização. Não comprovam execução do SQL, concorrência ou migração em PostgreSQL real. As consultas e migrações ainda devem ser executadas no banco de desenvolvimento. A sintaxe do servidor e do JavaScript da tela foi verificada; a tela ainda exige teste visual e funcional em navegador.

Presença, painel, login, membros, usuários e relatórios foram comparados com a base do ZIP e permanecem idênticos byte a byte. index.js recebeu somente a montagem do módulo e sua inicialização condicional.

## Requisito antes de publicar

As rotas antigas da base enviada ainda aceitam operações sem a mesma autenticação no servidor; o login legado trabalha com senha em texto e o static serve o diretório raiz. Como a tabela de usuários é compartilhada, proteger somente as rotas financeiras não resolve o acesso do sistema inteiro.

Antes de ativar na produção: integrar sessão e autorização ao aplicativo legado, retirar senhas das respostas e backups expostos, migrar senhas para hash, restringir arquivos públicos, validar alcance por célula/igreja/rede e testar todos os fluxos homologados. Essa adaptação não foi aplicada automaticamente às telas antigas nesta primeira entrega.

Não conceder acesso financeiro ao nível pastoral apenas por nome ou texto enviado pela tela. O Admin administra vínculos e permissões no servidor. Cadastro de igreja/campus/rede nesta entrega é exclusivo do Admin; tesoureiros podem cadastrar fornecedores e lançar/liquidar conforme os acessos concedidos.

## Arquivos do pacote

index.js: base com montagem condicional do módulo.

financeiro/schema.sql: novas tabelas e índices, sem alterações nas tabelas de Presença.

financeiro/router.js: sessão, permissões e operações financeiras.

financeiro/domain.js: valores, datas, parcelas e liquidações.

financeiro/financeiro.html: tela financeira independente.

test/: testes do núcleo e da API.

Dados locais de membros/usuários/presenças, arquivos antigos e node_modules não estão incluídos. O pacote é incremental e deve ser aplicado sobre a base enviada.
