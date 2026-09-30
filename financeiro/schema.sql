-- Aplicar somente no banco de desenvolvimento nesta primeira entrega.
CREATE TABLE IF NOT EXISTS fin_unidades (
 id SERIAL PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('igreja','campus','rede')),
 pai_id INTEGER REFERENCES fin_unidades(id), ativo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS fin_acessos (
 id SERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), unidade_id INTEGER REFERENCES fin_unidades(id),
 perfil TEXT NOT NULL CHECK(perfil IN ('pastor_presidente','pastor_governo','pastor_rede','tesoureiro','consulta')),
 consultar BOOLEAN NOT NULL DEFAULT TRUE, lancar BOOLEAN NOT NULL DEFAULT FALSE,
 liquidar BOOLEAN NOT NULL DEFAULT FALSE, estornar BOOLEAN NOT NULL DEFAULT FALSE,
 ativo BOOLEAN NOT NULL DEFAULT TRUE
);
-- unidade_id nula representa alcance global, concedido explicitamente pelo Admin.
CREATE TABLE IF NOT EXISTS fin_contas (
 id SERIAL PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('banco','caixa')),
 unidade_id INTEGER NOT NULL REFERENCES fin_unidades(id), saldo_inicial BIGINT NOT NULL DEFAULT 0,
 data_saldo DATE NOT NULL, ativo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS fin_categorias (
 id SERIAL PRIMARY KEY, nome TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('pagar','receber')), UNIQUE(nome,tipo)
);
CREATE TABLE IF NOT EXISTS fin_fornecedores (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, documento TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS fin_contratos (
 id SERIAL PRIMARY KEY, descricao TEXT NOT NULL, tipo TEXT NOT NULL CHECK(tipo IN ('pagar','receber')),
 unidade_id INTEGER NOT NULL REFERENCES fin_unidades(id), categoria_id INTEGER NOT NULL REFERENCES fin_categorias(id),
 fornecedor_id INTEGER REFERENCES fin_fornecedores(id), total BIGINT NOT NULL CHECK(total>0), parcelas INTEGER NOT NULL CHECK(parcelas BETWEEN 1 AND 120),
 competencia DATE NOT NULL, observacao TEXT NOT NULL DEFAULT '', criado_por INTEGER NOT NULL REFERENCES usuarios(id),
 criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(), chave UUID NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS fin_titulos (
 id SERIAL PRIMARY KEY, contrato_id INTEGER NOT NULL REFERENCES fin_contratos(id), numero INTEGER NOT NULL,
 vencimento DATE NOT NULL, valor BIGINT NOT NULL CHECK(valor>0), UNIQUE(contrato_id,numero)
);
CREATE TABLE IF NOT EXISTS fin_liquidacoes (
 id SERIAL PRIMARY KEY, titulo_id INTEGER NOT NULL REFERENCES fin_titulos(id), conta_id INTEGER NOT NULL REFERENCES fin_contas(id),
 data DATE NOT NULL, principal BIGINT NOT NULL CHECK(principal>0), juros BIGINT NOT NULL CHECK(juros>=0),
 multa BIGINT NOT NULL CHECK(multa>=0), desconto BIGINT NOT NULL CHECK(desconto>=0 AND desconto<=principal),
 efetivo BIGINT NOT NULL CHECK(efetivo>=0), meio TEXT NOT NULL CHECK(meio IN ('dinheiro','pix','deposito','boleto','debito','cartao','outro')),
 comprovante TEXT NOT NULL DEFAULT '', observacao TEXT NOT NULL DEFAULT '',
 criado_por INTEGER NOT NULL REFERENCES usuarios(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 estornado_em TIMESTAMPTZ, estornado_por INTEGER REFERENCES usuarios(id), motivo_estorno TEXT,
 chave UUID NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS fin_auditoria (
 id BIGSERIAL PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), acao TEXT NOT NULL,
 entidade TEXT NOT NULL, entidade_id INTEGER NOT NULL, detalhes JSONB NOT NULL DEFAULT '{}', data TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS fin_titulos_vencimento ON fin_titulos(vencimento);
CREATE INDEX IF NOT EXISTS fin_contratos_unidade ON fin_contratos(unidade_id);
CREATE INDEX IF NOT EXISTS fin_liquidacoes_titulo ON fin_liquidacoes(titulo_id);
CREATE INDEX IF NOT EXISTS fin_liquidacoes_conta ON fin_liquidacoes(conta_id,data);
