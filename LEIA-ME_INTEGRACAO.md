# +Células: módulos e submenus v0.3 para testes

Pacote incremental destinado exclusivamente à branch financeiro-teste do celulas-backend e ao serviço celulas-financeiro-teste. Não enviar ao main nem ao celulas-site de produção.

Inclui as oito telas atuais do celulas-site (base 46324f5), menu compartilhado, backend de testes e módulo financeiro. As telas usam o backend do mesmo endereço: nenhuma chamada deve chegar ao banco de produção. FINANCEIRO_ATIVO permanece true. Nenhuma alteração de banco é necessária além das tabelas financeiras já existentes.

Entrada: /login.html. Um login gera a sessão do Financeiro, válida por uma hora. Navegar pelo menu não exige uma segunda senha. Após expiração ou reinício do servidor, entrar novamente. Sair encerra a sessão financeira. Dados de presença, membros e células preservados na base enviada; alterações apenas no endereço das APIs e inclusão do menu. Presença permanece v1.17.

Módulos: Acessos, Cadastros, Células, Financeiro, Painel e Relatórios. Seções de igrejas/campus/redes, fornecedores, bancos/caixas e tipos de contas reaproveitam os formulários financeiros existentes. Pagamentos e recebimentos filtram a consulta por tipo, com opção de novo lançamento. Relatórios novos e permissões dos demais módulos aparecem como Em desenvolvimento. Relatórios de células existentes continuam disponíveis.

Limites: este pacote não conclui a arquitetura de permissões do sistema inteiro. O servidor continua verificando todas as permissões financeiras; as rotas antigas de usuários/células/membros ainda precisam da revisão de autenticação e autorização antes de uso financeiro real. Não utilizar valores ou dados reais nesta fase. Não há importação de extratos nem arrecadação na Presença ainda. Hierarquia financeira segue as regras da versão anterior.

Teste: abrir /login.html, entrar, abrir/fechar cada módulo, navegar Células/Presença/Financeiro, verificar que não é pedida segunda senha. Conferir bancos, tipos de contas, pagamentos e recebimentos com dados fictícios. Sair e tentar acessar /financeiro/ diretamente: deve voltar ao login.
