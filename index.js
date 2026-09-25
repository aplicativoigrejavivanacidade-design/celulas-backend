const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================================
   NORMALIZAÇÃO
================================ */
function normalizarTexto(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ç/gi, "c")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function normalizarNomeCelula(valor) {
  const texto = normalizarTexto(valor);
  if (!texto) return "";
  return texto.replace(/^CELULA\s*/i, "").trim();
}

function montarNomeCelulaExibicao(valor) {
  const base = normalizarNomeCelula(valor);
  return base ? `CÉLULA ${base}` : "";
}

function somenteDigitos(valor) {
  return String(valor || "").replace(/\D/g, "");
}

function normalizarTelefoneBR(valor) {
  let digitos = somenteDigitos(valor);
  if (digitos.startsWith("55") && digitos.length > 11) digitos = digitos.slice(2);
  if (![10, 11].includes(digitos.length)) return "";
  const ddd = digitos.slice(0, 2);
  const numero = digitos.slice(2);
  return numero.length === 9
    ? `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`
    : `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
}

function hojeISO() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,"0")}-${String(agora.getDate()).padStart(2,"0")}`;
}

function diasDesde(dataIso) {
  const a = new Date(`${dataIso}T12:00:00`);
  const b = new Date(`${hojeISO()}T12:00:00`);
  return Math.floor((b - a) / 86400000);
}
function normalizarListaIds(valor) {
  if (Array.isArray(valor)) {
    return valor
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  if (typeof valor === "string" && valor.trim()) {
    try {
      const parsed = JSON.parse(valor);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch (_) {
      return valor.split(",").map((item) => String(item || "").trim()).filter(Boolean);
    }
  }

  return [];
}

function serializarListaIds(valor) {
  return JSON.stringify(normalizarListaIds(valor));
}


function obterCelulaUsuarioPayload(body = {}) {
  return (
    body.celula ??
    body.celulaUsuario ??
    body.celulaVinculada ??
    body.celula_usuario ??
    ""
  );
}

function normalizarNivelUsuario(valor) {
  const nivel = normalizarTexto(valor || "lider");
  if (nivel === "ADMIN") return "admin";
  if (nivel === "SUPERVISOR") return "supervisor";
  return "lider";
}

/* ================================
   GARANTIR TABELAS
================================ */
async function garantirTabelas() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      usuario TEXT UNIQUE,
      senha TEXT,
      nivel TEXT,
      celula TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS membros (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      telefone TEXT,
      email TEXT,
      documento TEXT,
      celula TEXT,
      nascimento TEXT,
      status TEXT,
      cep TEXT,
      rua TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      observacoes TEXT,
      created_at DATE DEFAULT CURRENT_DATE
    )
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS email TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS documento TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS data_cadastro TEXT DEFAULT TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS origem_cadastro TEXT DEFAULT 'CADASTRO'
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS cadastro_completo BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS data_arquivamento TEXT DEFAULT NULL
  `);

  // corrigir defaults antigos de cadastro criados por versões intermediárias
  await pool.query(`
    UPDATE membros
    SET origem_cadastro = NULL
    WHERE origem_cadastro = 'CADASTRO'
      AND (documento IS NULL OR documento = '')
      AND (email IS NULL OR email = '')
  `);

  await pool.query(`
    ALTER TABLE membros
    ADD COLUMN IF NOT EXISTS created_at DATE DEFAULT CURRENT_DATE
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS celulas (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      nome_normalizado TEXT,
      dia_semana TEXT,
      hora TEXT,
      anfitriao TEXT,
      lider_celula TEXT,
      lideres_treinamento TEXT DEFAULT '',
      cep TEXT,
      rua TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      geolocalizacao TEXT,
      ativo BOOLEAN DEFAULT TRUE
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS presencas (
      id SERIAL PRIMARY KEY,
      membro_id INTEGER,
      data TEXT,
      status TEXT
    )
  `);

  // v1.11: a célula passa a fazer parte do registro histórico da presença.
  // Assim, arquivar/mover uma pessoa no cadastro não altera a reunião já gravada.
  await pool.query(`
    ALTER TABLE presencas
    ADD COLUMN IF NOT EXISTS celula TEXT DEFAULT NULL
  `);

  // Compatibilidade com registros antigos: captura a célula atual quando ainda
  // não existe snapshot no registro de presença. Novos lançamentos gravam a célula diretamente.
  await pool.query(`
    UPDATE presencas p
    SET celula = m.celula
    FROM membros m
    WHERE p.membro_id = m.id
      AND (p.celula IS NULL OR p.celula = '')
      AND m.celula IS NOT NULL
      AND m.celula <> ''
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_celulas_nome_normalizado
    ON celulas (nome_normalizado)
  `);

  await pool.query(`
    ALTER TABLE celulas
    ADD COLUMN IF NOT EXISTS lider_celula TEXT
  `);

  await pool.query(`
    ALTER TABLE celulas
    ADD COLUMN IF NOT EXISTS lideres_treinamento TEXT DEFAULT ''
  `);

  await pool.query(`
    ALTER TABLE celulas
    ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT TRUE
  `);

  await pool.query(`
    ALTER TABLE usuarios
    ADD COLUMN IF NOT EXISTS celula TEXT
  `);

  await pool.query(`
    UPDATE usuarios
    SET celula = ''
    WHERE celula IS NULL
  `);

  await pool.query(`
    UPDATE celulas
    SET ativo = TRUE
    WHERE ativo IS NULL
  `);
}

/* ================================
   ADMIN
================================ */
async function criarAdmin() {
  const result = await pool.query(
    "SELECT * FROM usuarios WHERE usuario = $1",
    ["admin"]
  );

  if (result.rows.length === 0) {
    await pool.query(
      "INSERT INTO usuarios (nome, usuario, senha, nivel, celula) VALUES ($1,$2,$3,$4,$5)",
      ["Administrador", "admin", "1234", "admin", ""]
    );
    console.log("Usuário admin criado com sucesso.");
  } else {
    await pool.query(
      "UPDATE usuarios SET nivel = $1, celula = '' WHERE usuario = $2",
      ["admin", "admin"]
    );
  }
}

/* ================================
   APOIOS DE VALIDAÇÃO
================================ */
async function obterCelulaPorId(id) {
  const result = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);
  return result.rows[0] || null;
}

async function obterMembroPorId(id) {
  const result = await pool.query("SELECT * FROM membros WHERE id = $1", [id]);
  return result.rows[0] || null;
}

async function validarExclusaoMembro(membroId) {
  const membro = await obterMembroPorId(membroId);

  if (!membro) {
    return { ok: false, status: 404, erro: "Membro não encontrado." };
  }

  if (String(membro.celula || "").trim()) {
    return {
      ok: false,
      status: 400,
      erro: `Este membro está vinculado à ${membro.celula}. Remova o vínculo na tela de Células antes de excluir.`
    };
  }

  const lider = await pool.query(
    "SELECT nome FROM celulas WHERE lider_celula = $1 LIMIT 1",
    [String(membroId)]
  );

  if (lider.rows.length > 0) {
    return {
      ok: false,
      status: 400,
      erro: `Este membro está vinculado como líder da ${lider.rows[0].nome}. Remova o vínculo antes de excluir.`
    };
  }

  const anfitriao = await pool.query(
    "SELECT nome FROM celulas WHERE anfitriao = $1 LIMIT 1",
    [String(membroId)]
  );

  if (anfitriao.rows.length > 0) {
    return {
      ok: false,
      status: 400,
      erro: `Este membro está vinculado como anfitrião da ${anfitriao.rows[0].nome}. Remova o vínculo antes de excluir.`
    };
  }

  const presencas = await pool.query(
    "SELECT COUNT(*)::int AS total FROM presencas WHERE membro_id = $1",
    [membroId]
  );

  if ((presencas.rows[0]?.total || 0) > 0) {
    return {
      ok: false,
      status: 400,
      erro: "Este membro possui registros de presença. Remova primeiro os vínculos de presença antes de excluir."
    };
  }

  return { ok: true, membro };
}

async function validarExclusaoCelula(celulaId) {
  const celula = await obterCelulaPorId(celulaId);

  if (!celula) {
    return { ok: false, status: 404, erro: "Célula não encontrada." };
  }

  const membrosVinculados = await pool.query(
    "SELECT COUNT(*)::int AS total FROM membros WHERE celula = $1",
    [celula.nome]
  );

  if ((membrosVinculados.rows[0]?.total || 0) > 0) {
    return {
      ok: false,
      status: 400,
      erro: `A ${celula.nome} possui membros vinculados. Remova os vínculos na tela de Células antes de excluir.`
    };
  }

  const presencasComCelula = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM presencas p
    INNER JOIN membros m ON m.id = p.membro_id
    WHERE m.celula = $1
    `,
    [celula.nome]
  );

  if ((presencasComCelula.rows[0]?.total || 0) > 0) {
    return {
      ok: false,
      status: 400,
      erro: `A ${celula.nome} possui histórico de presenças/relatórios. Não é possível excluir. Use a opção de inativar célula.`
    };
  }

  return { ok: true, celula };
}

/* ================================
   ROTAS BÁSICAS
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    sistema: "+Células Backend V33 Líderes Em Treinamento",
    status: "ONLINE"
  });
});

/* ================================
   LOGIN
================================ */
app.post("/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    const result = await pool.query(
      `
      SELECT
        id,
        nome,
        usuario,
        senha,
        nivel,
        COALESCE(celula, '') AS celula
      FROM usuarios
      WHERE usuario = $1 AND senha = $2
      `,
      [String(usuario || "").trim().toLowerCase(), String(senha || "").trim()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        sucesso: false,
        erro: "Usuário ou senha inválidos."
      });
    }

    return res.json({
      sucesso: true,
      usuario: result.rows[0]
    });
  } catch (erro) {
    console.error("Erro no login:", erro.message);
    return res.status(500).json({
      sucesso: false,
      erro: "Erro no login."
    });
  }
});

/* ================================
   GEOCODIFICAÇÃO
================================ */
app.post("/geolocalizacao", async (req, res) => {
  try {
    const {
      cep,
      rua,
      numero,
      bairro,
      cidade,
      estado
    } = req.body || {};

    const cepLimpo = String(cep || "").replace(/\D/g, "").trim();

    const tentativas = [];

    const principal = [
      String(numero || "").trim(),
      String(rua || "").trim(),
      String(bairro || "").trim(),
      String(cidade || "").trim(),
      String(estado || "").trim(),
      cepLimpo
    ].filter(Boolean).join(", ");

    if (principal) tentativas.push(principal);

    const semNumero = [
      String(rua || "").trim(),
      String(bairro || "").trim(),
      String(cidade || "").trim(),
      String(estado || "").trim(),
      cepLimpo
    ].filter(Boolean).join(", ");

    if (semNumero && semNumero !== principal) tentativas.push(semNumero);

    const soCepCidade = [
      cepLimpo,
      String(cidade || "").trim(),
      String(estado || "").trim(),
      "Brasil"
    ].filter(Boolean).join(", ");

    if (soCepCidade) tentativas.push(soCepCidade);

    for (const tentativa of tentativas) {
      const url = new URL("https://nominatim.openstreetmap.org/search");
      url.searchParams.set("format", "json");
      url.searchParams.set("limit", "1");
      url.searchParams.set("countrycodes", "br");
      url.searchParams.set("q", tentativa);

      const resposta = await fetch(url.toString(), {
        headers: {
          "User-Agent": "mais-celulas/1.0",
          "Accept-Language": "pt-BR"
        }
      });

      const dados = await resposta.json();

      if (Array.isArray(dados) && dados.length > 0) {
        const lat = Number(dados[0].lat).toFixed(6);
        const lon = Number(dados[0].lon).toFixed(6);

        return res.json({
          ok: true,
          geolocalizacao: `${lat}, ${lon}`
        });
      }
    }

    return res.status(404).json({
      ok: false,
      erro: "Não foi possível gerar a geolocalização."
    });
  } catch (erro) {
    console.error("Erro ao gerar geolocalização:", erro.message);
    return res.status(500).json({
      ok: false,
      erro: "Erro ao gerar geolocalização."
    });
  }
});

/* ================================
   DEBUG USUÁRIOS
================================ */
app.get("/debug/usuarios", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nome, usuario, nivel, COALESCE(celula, '') AS celula
      FROM usuarios
      ORDER BY nome ASC, id DESC
    `);

    res.json({
      ok: true,
      total: result.rows.length,
      usuarios: result.rows
    });
  } catch (erro) {
    console.error("Erro no debug de usuários:", erro.message);
    res.status(500).json({ ok: false, erro: "Erro no debug de usuários" });
  }
});

/* ================================
   USUÁRIOS
================================ */
app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        nome,
        usuario,
        senha,
        nivel,
        COALESCE(celula, '') AS celula
      FROM usuarios
      ORDER BY nome ASC, id DESC
    `);

    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar usuários:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

app.get("/usuarios/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `
      SELECT
        id,
        nome,
        usuario,
        senha,
        nivel,
        COALESCE(celula, '') AS celula
      FROM usuarios
      WHERE id = $1
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (erro) {
    console.error("Erro ao buscar usuário:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar usuário" });
  }
});

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, usuario, senha } = req.body;
    const nivelTratado = normalizarNivelUsuario(req.body.nivel);
    const celulaTratada = montarNomeCelulaExibicao(obterCelulaUsuarioPayload(req.body));
    const usuarioTratado = String(usuario || "").trim().toLowerCase();

    if (!String(nome || "").trim() || !usuarioTratado || !String(senha || "").trim()) {
      return res.status(400).json({ erro: "Preencha nome, usuário e senha." });
    }

    if (nivelTratado === "lider" && !celulaTratada) {
      return res.status(400).json({ erro: "Usuário líder precisa ter uma célula vinculada." });
    }

    const existe = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = $1",
      [usuarioTratado]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Usuário já existe" });
    }

    const salvo = await pool.query(
      `
      INSERT INTO usuarios (nome, usuario, senha, nivel, celula)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING id, nome, usuario, senha, nivel, COALESCE(celula, '') AS celula
      `,
      [
        normalizarTexto(nome),
        usuarioTratado,
        String(senha || "").trim(),
        nivelTratado,
        nivelTratado === "lider" ? celulaTratada : ""
      ]
    );

    res.json({ ok: true, usuario: salvo.rows[0] });
  } catch (erro) {
    console.error("Erro ao salvar usuário:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar usuário" });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, usuario, senha } = req.body;
    const nivelTratado = normalizarNivelUsuario(req.body.nivel);
    const celulaTratada = montarNomeCelulaExibicao(obterCelulaUsuarioPayload(req.body));
    const usuarioTratado = String(usuario || "").trim().toLowerCase();

    if (!String(nome || "").trim() || !usuarioTratado || !String(senha || "").trim()) {
      return res.status(400).json({ erro: "Preencha nome, usuário e senha." });
    }

    if (nivelTratado === "lider" && !celulaTratada) {
      return res.status(400).json({ erro: "Usuário líder precisa ter uma célula vinculada." });
    }

    const existe = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = $1 AND id <> $2",
      [usuarioTratado, id]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Já existe outro usuário com esse login" });
    }

    const atualizado = await pool.query(
      `
      UPDATE usuarios SET
        nome = $1,
        usuario = $2,
        senha = $3,
        nivel = $4,
        celula = $5
      WHERE id = $6
      RETURNING id, nome, usuario, senha, nivel, COALESCE(celula, '') AS celula
      `,
      [
        normalizarTexto(nome),
        usuarioTratado,
        String(senha || "").trim(),
        nivelTratado,
        nivelTratado === "lider" ? celulaTratada : "",
        id
      ]
    );

    if (atualizado.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    res.json({ ok: true, usuario: atualizado.rows[0] });
  } catch (erro) {
    console.error("Erro ao atualizar usuário:", erro.message);
    res.status(500).json({ erro: "Erro ao atualizar usuário" });
  }
});

app.delete("/usuarios/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const atual = await pool.query("SELECT * FROM usuarios WHERE id = $1", [id]);

    if (atual.rows.length === 0) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    if (String(atual.rows[0].usuario || "").toLowerCase() === "admin") {
      return res.status(400).json({ erro: "O usuário admin não pode ser excluído" });
    }

    await pool.query("DELETE FROM usuarios WHERE id = $1", [id]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao excluir usuário:", erro.message);
    res.status(500).json({ erro: "Erro ao excluir usuário" });
  }
});

app.get("/debug/usuarios", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, nome, usuario, nivel, COALESCE(celula, '') AS celula
      FROM usuarios
      ORDER BY nome ASC, id DESC
    `);

    res.json({ ok: true, usuarios: result.rows });
  } catch (erro) {
    res.status(500).json({ ok: false, erro: erro.message });
  }
});

/* ================================
   MEMBROS
================================ */
app.get("/membros", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM membros ORDER BY nome ASC, id DESC");
    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar membros:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar membros" });
  }
});

app.get("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM membros WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Membro não encontrado" });
    }

    res.json(result.rows[0]);
  } catch (erro) {
    console.error("Erro ao buscar membro:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar membro" });
  }
});



app.post("/membros/visitante/:id/arquivar", async (req, res) => {
  try {
    const { id } = req.params;
    const dataArquivamento = String(req.body?.dataArquivamento || hojeISO()).slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataArquivamento)) {
      return res.status(400).json({ erro: "Data de arquivamento inválida." });
    }

    const membroResult = await pool.query("SELECT * FROM membros WHERE id = $1", [id]);
    if (membroResult.rows.length === 0) return res.status(404).json({ erro: "Visitante não encontrado." });

    const membro = membroResult.rows[0];
    const origem = normalizarTexto(membro.origem_cadastro || "");
    const status = normalizarTexto(membro.status || "");
    if (origem !== "PRESENCA_VISITANTE" && status !== "VISITANTE" && status !== "VISITANTE ARQUIVADO") {
      return res.status(400).json({ erro: "Apenas visitantes podem ser arquivados por esta função." });
    }

    const dataCadastro = String(membro.data_cadastro || membro.created_at || "").slice(0, 10);
    if (dataCadastro && dataArquivamento < dataCadastro) {
      return res.status(400).json({ erro: "O arquivamento não pode ser anterior ao primeiro cadastro do visitante." });
    }

    await pool.query(`
      UPDATE membros
      SET status = 'VISITANTE ARQUIVADO', data_arquivamento = $2, cadastro_completo = false
      WHERE id = $1
    `, [id, dataArquivamento]);

    res.json({ ok: true, dataArquivamento, mensagem: `Visitante arquivado a partir de ${dataArquivamento.split("-").reverse().join("/")}. O histórico anterior permanece disponível.` });
  } catch (erro) {
    console.error("Erro ao arquivar visitante:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao arquivar visitante." });
  }
});


app.post("/membros/visitante", async (req, res) => {
  try {
    const { nome, telefone, celula, dataCadastro, observacoes } = req.body;
    const nomeTratado = normalizarTexto(nome);
    const telefoneTratado = normalizarTelefoneBR(telefone);
    const celulaTratada = montarNomeCelulaExibicao(celula || "");
    const dataCadastroTratada = String(dataCadastro || hojeISO()).slice(0, 10);

    if (!nomeTratado || !telefoneTratado || !celulaTratada) {
      return res.status(400).json({ erro: "Informe nome, telefone válido com DDD e célula para cadastrar o visitante." });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCadastroTratada) || dataCadastroTratada > hojeISO()) {
      return res.status(400).json({ erro: "A data de cadastro do visitante é inválida ou futura." });
    }

    const digitos = somenteDigitos(telefoneTratado);
    const duplicado = await pool.query(
      `SELECT id, nome FROM membros WHERE regexp_replace(COALESCE(telefone,''), '[^0-9]', '', 'g') = $1 LIMIT 1`,
      [digitos]
    );
    if (duplicado.rows.length) {
      return res.status(409).json({ erro: `Este telefone já está cadastrado para ${duplicado.rows[0].nome || "outra pessoa"}.` });
    }

    await pool.query(`
      INSERT INTO membros (
        nome, telefone, email, documento, celula, nascimento, status,
        cep, rua, numero, complemento, bairro, cidade, estado, observacoes,
        data_cadastro, origem_cadastro, cadastro_completo, data_arquivamento
      ) VALUES (
        $1,$2,'','',$3,'','VISITANTE',
        '','','','','','','',$4,
        $5,'PRESENCA_VISITANTE',false,NULL
      )
    `, [nomeTratado, telefoneTratado, celulaTratada, normalizarTexto(observacoes || `VISITANTE CADASTRADO PELA PRESENÇA EM ${dataCadastroTratada}`), dataCadastroTratada]);

    res.json({ ok: true, mensagem: "Visitante cadastrado com sucesso." });
  } catch (erro) {
    console.error("Erro ao cadastrar visitante:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao cadastrar visitante." });
  }
});


app.post("/membros", async (req, res) => {
  try {
    const {
      nome, telefone, email, documento, nascimento, status, celula,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes, origemCadastro,
      dataCadastro, cadastroCompleto
    } = req.body;

    const nomeTratado = normalizarTexto(nome);
    const telefoneTratado = String(telefone || "").trim();
    const emailTratado = String(email || "").trim().toLowerCase();
    const documentoTratado = String(documento || "").replace(/\D/g, "");
    const celulaTratada = montarNomeCelulaExibicao(celula || "");
    const origemTratada = normalizarTexto(origemCadastro || "CADASTRO");
    const visitanteIncompleto = origemTratada === "PRESENCA_VISITANTE" || cadastroCompleto === false;
    const dataCadastroTratada = String(dataCadastro || new Date().toISOString().slice(0, 10)).slice(0, 10);

    if (!visitanteIncompleto && (!nomeTratado || !telefoneTratado || !emailTratado || !documentoTratado || !String(nascimento || "").trim() ||
        !normalizarTexto(status) || !String(cep || "").trim() || !normalizarTexto(rua) ||
        !normalizarTexto(numero) || !normalizarTexto(bairro) || !normalizarTexto(cidade) || !normalizarTexto(estado))) {
      return res.status(400).json({
        erro: "Preencha todos os campos obrigatórios. Apenas complemento e observações são opcionais."
      });
    }

    if (visitanteIncompleto && (!nomeTratado || !telefoneTratado || !celulaTratada)) {
      return res.status(400).json({
        erro: "Informe nome, telefone e célula para cadastrar o visitante."
      });
    }

    if (!visitanteIncompleto) {
      const duplicado = await pool.query(
        `
        SELECT id, nome FROM membros
        WHERE
          REGEXP_REPLACE(COALESCE(documento,''), '\\D', '', 'g') = $1
          OR LOWER(COALESCE(email,'')) = $2
        LIMIT 1
        `,
        [documentoTratado, emailTratado]
      );

      if (duplicado.rows.length > 0) {
        return res.status(400).json({
          erro: `Já existe um membro cadastrado com este documento ou e-mail: ${duplicado.rows[0].nome}`
        });
      }
    }

    await pool.query(`
      INSERT INTO membros (
        nome, telefone, email, documento, celula, nascimento, status,
        cep, rua, numero, complemento, bairro,
        cidade, estado, observacoes,
        data_cadastro, origem_cadastro, cadastro_completo
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      )
    `, [
      nomeTratado,
      telefoneTratado,
      emailTratado,
      documentoTratado,
      celulaTratada,
      String(nascimento || "").trim(),
      normalizarTexto(status || "ATIVO"),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      normalizarTexto(observacoes),
      dataCadastroTratada,
      origemTratada,
      visitanteIncompleto ? false : true
    ]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao salvar membro:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao salvar membro" });
  }
});

app.put("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome, telefone, email, documento, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    } = req.body;

    const nomeTratado = normalizarTexto(nome);
    const telefoneTratado = String(telefone || "").trim();
    const emailTratado = String(email || "").trim().toLowerCase();
    const documentoTratado = String(documento || "").replace(/\D/g, "");

    if (!nomeTratado || !telefoneTratado || !emailTratado || !documentoTratado || !String(nascimento || "").trim() ||
        !normalizarTexto(status) || !String(cep || "").trim() || !normalizarTexto(rua) ||
        !normalizarTexto(numero) || !normalizarTexto(bairro) || !normalizarTexto(cidade) || !normalizarTexto(estado)) {
      return res.status(400).json({
        erro: "Preencha todos os campos obrigatórios. Apenas complemento e observações são opcionais."
      });
    }

    const atual = await pool.query("SELECT * FROM membros WHERE id = $1", [id]);

    if (atual.rows.length === 0) {
      return res.status(404).json({ erro: "Membro não encontrado" });
    }

    const duplicado = await pool.query(
      `
      SELECT id, nome FROM membros
      WHERE id <> $1
        AND (
          REGEXP_REPLACE(COALESCE(documento,''), '\\D', '', 'g') = $2
          OR LOWER(COALESCE(email,'')) = $3
        )
      LIMIT 1
      `,
      [id, documentoTratado, emailTratado]
    );

    if (duplicado.rows.length > 0) {
      return res.status(400).json({
        erro: `Já existe outro membro cadastrado com este documento ou e-mail: ${duplicado.rows[0].nome}`
      });
    }

    const celulaAtual = atual.rows[0].celula || "";

    await pool.query(`
      UPDATE membros SET
        nome = $1,
        telefone = $2,
        email = $3,
        documento = $4,
        celula = $5,
        nascimento = $6,
        status = $7,
        cep = $8,
        rua = $9,
        numero = $10,
        complemento = $11,
        bairro = $12,
        cidade = $13,
        estado = $14,
        observacoes = $15
      WHERE id = $16
    `, [
      nomeTratado,
      telefoneTratado,
      emailTratado,
      documentoTratado,
      celulaAtual,
      String(nascimento || "").trim(),
      normalizarTexto(status),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      normalizarTexto(observacoes),
      id
    ]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao atualizar membro:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao atualizar membro" });
  }
});

app.delete("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const validacao = await validarExclusaoMembro(id);

    if (!validacao.ok) {
      return res.status(validacao.status).json({ erro: validacao.erro });
    }

    await pool.query("DELETE FROM membros WHERE id = $1", [id]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao excluir membro:", erro.message);
    res.status(500).json({ erro: "Erro ao excluir membro" });
  }
});

/* ================================
   CÉLULAS
================================ */
app.get("/celulas", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM celulas ORDER BY nome ASC, id DESC");
    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar células:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar células" });
  }
});

app.get("/celulas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ erro: "Célula não encontrada" });
    }

    res.json(result.rows[0]);
  } catch (erro) {
    console.error("Erro ao buscar célula:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar célula" });
  }
});

app.post("/celulas", async (req, res) => {
  try {
    const {
      nomeCelula,
      diaSemana,
      horaReuniao,
      anfitriao,
      liderCelula,
      lideresTreinamento,
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      geolocalizacao,
      membrosSelecionados,
      membrosRemovidos
    } = req.body;

    const nomeExibicao = montarNomeCelulaExibicao(nomeCelula);
    const nomeNormalizado = normalizarTexto(nomeExibicao);

    const existe = await pool.query(
      "SELECT * FROM celulas WHERE nome_normalizado = $1",
      [nomeNormalizado]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Célula já existe" });
    }

    const result = await pool.query(`
      INSERT INTO celulas (
        nome, nome_normalizado, dia_semana, hora, anfitriao, lider_celula, lideres_treinamento,
        cep, rua, numero, complemento, bairro, cidade, estado, geolocalizacao, ativo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
    `, [
      nomeExibicao,
      nomeNormalizado,
      normalizarTexto(diaSemana),
      String(horaReuniao || "").trim(),
      String(anfitriao || "").trim(),
      String(liderCelula || "").trim(),
      serializarListaIds(lideresTreinamento),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      String(geolocalizacao || "").trim(),
      true
    ]);

    if (Array.isArray(membrosSelecionados) && membrosSelecionados.length > 0) {
      for (const membroId of membrosSelecionados) {
        await pool.query(
          `
          UPDATE membros
          SET celula = $1
          WHERE id = $2
            AND (celula IS NULL OR celula = '' OR celula = $1)
          `,
          [nomeExibicao, membroId]
        );
      }
    }

    res.json({ ok: true, celulaId: result.rows[0].id });
  } catch (erro) {
    console.error("Erro ao salvar célula:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar célula" });
  }
});

app.put("/celulas/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nomeCelula,
      diaSemana,
      horaReuniao,
      anfitriao,
      liderCelula,
      lideresTreinamento,
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      geolocalizacao,
      membrosSelecionados,
      membrosRemovidos
    } = req.body;

    const atual = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);

    if (atual.rows.length === 0) {
      return res.status(404).json({ erro: "Célula não encontrada" });
    }

    const nomeAntigo = atual.rows[0].nome;
    const nomeExibicao = montarNomeCelulaExibicao(nomeCelula);
    const nomeNormalizado = normalizarTexto(nomeExibicao);

    const duplicada = await pool.query(
      "SELECT * FROM celulas WHERE nome_normalizado = $1 AND id <> $2",
      [nomeNormalizado, id]
    );

    if (duplicada.rows.length > 0) {
      return res.status(400).json({ erro: "Já existe outra célula com esse nome" });
    }

    await pool.query(`
      UPDATE celulas SET
        nome = $1,
        nome_normalizado = $2,
        dia_semana = $3,
        hora = $4,
        anfitriao = $5,
        lider_celula = $6,
        lideres_treinamento = $7,
        cep = $8,
        rua = $9,
        numero = $10,
        complemento = $11,
        bairro = $12,
        cidade = $13,
        estado = $14,
        geolocalizacao = $15
      WHERE id = $16
    `, [
      nomeExibicao,
      nomeNormalizado,
      normalizarTexto(diaSemana),
      String(horaReuniao || "").trim(),
      String(anfitriao || "").trim(),
      String(liderCelula || "").trim(),
      serializarListaIds(lideresTreinamento),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      String(geolocalizacao || "").trim(),
      id
    ]);

    await pool.query(
      "UPDATE membros SET celula = $1 WHERE celula = $2",
      [nomeExibicao, nomeAntigo]
    );

    if (Array.isArray(membrosSelecionados) && membrosSelecionados.length > 0) {
      for (const membroId of membrosSelecionados) {
        await pool.query(
          `
          UPDATE membros
          SET celula = $1
          WHERE id = $2
            AND (celula IS NULL OR celula = '' OR celula = $1)
          `,
          [nomeExibicao, membroId]
        );
      }
    }
    const membrosRemovidosTratados = Array.isArray(membrosRemovidos)
      ? membrosRemovidos.map(Number).filter(Boolean)
      : [];

    if (membrosRemovidosTratados.length > 0) {
      await pool.query(
        "UPDATE membros SET celula = '' WHERE id = ANY($1::int[])",
        [membrosRemovidosTratados]
      );
      console.log("Membros removidos da célula:", membrosRemovidosTratados);
    }


    res.json({ ok: true, celulaId: id });
  } catch (erro) {
    console.error("Erro ao atualizar célula:", erro.message);
    res.status(500).json({ erro: "Erro ao atualizar célula" });
  }
});

app.post("/celulas/:id/inativar", async (req, res) => {
  try {
    const { id } = req.params;

    const celula = await obterCelulaPorId(id);
    if (!celula) {
      return res.status(404).json({ erro: "Célula não encontrada" });
    }

    await pool.query("UPDATE celulas SET ativo = FALSE WHERE id = $1", [id]);

    return res.json({
      ok: true,
      mensagem: `${celula.nome} foi inativada com sucesso.`
    });
  } catch (erro) {
    console.error("Erro ao inativar célula:", erro.message);
    return res.status(500).json({ erro: "Erro ao inativar célula" });
  }
});

app.post("/celulas/:id/ativar", async (req, res) => {
  try {
    const { id } = req.params;

    const celula = await obterCelulaPorId(id);
    if (!celula) {
      return res.status(404).json({ erro: "Célula não encontrada" });
    }

    await pool.query("UPDATE celulas SET ativo = TRUE WHERE id = $1", [id]);

    return res.json({
      ok: true,
      mensagem: `${celula.nome} foi ativada com sucesso.`
    });
  } catch (erro) {
    console.error("Erro ao ativar célula:", erro.message);
    return res.status(500).json({ erro: "Erro ao ativar célula" });
  }
});



app.post("/celulas/:id/remover-membros", async (req, res) => {
  try {
    const { id } = req.params;
    const { membrosRemovidos } = req.body;

    const celulaResult = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);
    if (celulaResult.rows.length === 0) {
      return res.status(404).json({ erro: "Célula não encontrada." });
    }

    const celula = celulaResult.rows[0];
    const removidos = Array.isArray(membrosRemovidos) ? membrosRemovidos.map(Number).filter(Boolean) : [];

    if (removidos.length === 0) {
      return res.json({ ok: true, mensagem: "Nenhum membro selecionado para remoção." });
    }

    const liderAtual = Number(celula.lider_celula || 0);
    const anfitriaoAtual = Number(celula.anfitriao || 0);

    if (removidos.includes(liderAtual)) {
      return res.status(400).json({ erro: "Não é possível remover o líder da célula sem definir outro líder antes." });
    }

    if (removidos.includes(anfitriaoAtual)) {
      return res.status(400).json({ erro: "Não é possível remover o anfitrião da célula sem definir outro anfitrião antes." });
    }

    await pool.query("UPDATE membros SET celula = '' WHERE id = ANY($1::int[])", [removidos]);

    res.json({ ok: true, mensagem: "Membro(s) removido(s) da célula com sucesso." });
  } catch (erro) {
    console.error("Erro ao remover membros da célula:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao remover membros da célula." });
  }
});

app.post("/celulas/:id/multiplicar", async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const {
      nomeCelula,
      diaSemana,
      horaReuniao,
      anfitriao,
      liderCelula,
      lideresTreinamento,
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      geolocalizacao,
      membrosSelecionados,
      membrosRemovidos
    } = req.body;

    const nomeTratado = montarNomeCelulaExibicao(nomeCelula);

    if (!nomeTratado) {
      return res.status(400).json({ erro: "Informe o nome da nova célula." });
    }

    const origem = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);

    if (origem.rows.length === 0) {
      return res.status(404).json({ erro: "Célula original não encontrada." });
    }

    const membrosParaMover = Array.isArray(membrosSelecionados)
      ? membrosSelecionados.map(Number).filter(Boolean)
      : [];

    if (membrosParaMover.length === 0) {
      return res.status(400).json({ erro: "Selecione ao menos um membro para multiplicar a célula." });
    }

    const existe = await pool.query(
      "SELECT * FROM celulas WHERE UPPER(nome) = UPPER($1)",
      [nomeTratado]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Já existe uma célula com esse nome." });
    }

    await client.query("BEGIN");

    const novaCelula = await client.query(
      `
      INSERT INTO celulas (
        nome,
        dia_semana,
        hora,
        anfitriao,
        lider_celula,
        lideres_treinamento,
        cep,
        rua,
        numero,
        complemento,
        bairro,
        cidade,
        estado,
        geolocalizacao,
        ativo
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)
      RETURNING *
      `,
      [
        nomeTratado,
        diaSemana || "",
        horaReuniao || "",
        anfitriao || "",
        liderCelula || "",
        JSON.stringify(Array.isArray(lideresTreinamento) ? lideresTreinamento : []),
        cep || "",
        rua || "",
        numero || "",
        complemento || "",
        bairro || "",
        cidade || "",
        estado || "",
        geolocalizacao || ""
      ]
    );

    await client.query(
      "UPDATE membros SET celula = $1 WHERE id = ANY($2::int[])",
      [nomeTratado, membrosParaMover]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      mensagem: "Célula multiplicada com sucesso.",
      celulaId: novaCelula.rows[0].id,
      celula: novaCelula.rows[0]
    });
  } catch (erro) {
    await client.query("ROLLBACK");
    console.error("Erro ao multiplicar célula:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao multiplicar célula." });
  } finally {
    client.release();
  }
});

app.delete("/celulas/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const validacao = await validarExclusaoCelula(id);

    if (!validacao.ok) {
      return res.status(validacao.status).json({ erro: validacao.erro });
    }

    await pool.query("DELETE FROM celulas WHERE id = $1", [id]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao excluir célula:", erro.message);
    res.status(500).json({ erro: "Erro ao excluir célula" });
  }
});

/* ================================
   PRESENÇAS
================================ */

app.post("/visitantes", async (req, res) => {
  try {
    const { nome, telefone, celula, dataCadastro } = req.body;

    const nomeTratado = normalizarTexto(nome);
    const telefoneTratado = String(telefone || "").trim();
    const celulaTratada = montarNomeCelulaExibicao(celula || "");
    const dataTratada = String(dataCadastro || "").slice(0, 10) || new Date().toISOString().slice(0, 10);

    if (!nomeTratado || !telefoneTratado || !celulaTratada) {
      return res.status(400).json({ erro: "Informe nome, telefone e célula do visitante." });
    }

    const documentoVisitante = `VISITANTE-${Date.now()}`;

    const resultado = await pool.query(`
      INSERT INTO membros (
        nome, telefone, email, documento, celula, nascimento, status,
        cep, rua, numero, complemento, bairro, cidade, estado, observacoes, created_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      RETURNING *
    `, [
      nomeTratado,
      telefoneTratado,
      "",
      documentoVisitante,
      celulaTratada,
      "",
      "VISITANTE",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "CADASTRADO PELA TELA DE PRESENÇA",
      dataTratada
    ]);

    res.json({ ok: true, membro: resultado.rows[0] });
  } catch (erro) {
    console.error("Erro ao cadastrar visitante:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao cadastrar visitante." });
  }
});

app.get("/presencas", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM presencas ORDER BY data DESC, id DESC"
    );
    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar presenças:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});


app.delete("/presencas/:data", async (req, res) => {
  try {
    const { data } = req.params;
    const nivel = normalizarNivelUsuario(req.body?.nivelUsuario || "lider");
    const ids = Array.isArray(req.body?.membroIds) ? req.body.membroIds.map(Number).filter(Boolean) : [];
    if (nivel !== "admin") return res.status(403).json({ erro: "Somente administrador pode excluir presença." });
    if (!data) return res.status(400).json({ erro: "Data da presença não informada." });
    if (data > hojeISO()) return res.status(400).json({ erro: "Não é permitido excluir presença em data futura." });

    let result;
    if (ids.length) result = await pool.query("DELETE FROM presencas WHERE data = $1 AND membro_id = ANY($2::int[]) RETURNING id", [data, ids]);
    else result = await pool.query("DELETE FROM presencas WHERE data = $1 RETURNING id", [data]);
    if (!result.rowCount) return res.status(404).json({ erro: "Nenhum registro de presença encontrado para esta reunião." });

    res.json({ ok: true, mensagem: "Presença excluída com sucesso. Relatórios e painel serão atualizados com a alteração histórica." });
  } catch (erro) {
    console.error("Erro ao excluir presença:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao excluir presença." });
  }
});


app.get("/presencas/:data", async (req, res) => {
  try {
    const { data } = req.params;

    // v1.10: devolve também um snapshot dos dados do participante.
    // Isso permite que a tela reconstrua visitantes de reuniões históricas mesmo
    // depois de eles terem sido arquivados, sem alterar/apagar a presença gravada.
    const result = await pool.query(`
      SELECT
        p.membro_id AS "membroId",
        p.status,
        p.celula AS "celulaPresenca",
        m.nome,
        m.telefone,
        m.celula,
        m.status AS "statusMembro",
        m.origem_cadastro AS "origemCadastro",
        m.cadastro_completo AS "cadastroCompleto",
        m.data_cadastro AS "dataCadastro",
        m.data_arquivamento AS "dataArquivamento"
      FROM presencas p
      LEFT JOIN membros m ON m.id = p.membro_id
      WHERE p.data = $1
      ORDER BY p.id ASC
    `, [data]);

    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar presenças por data:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});


app.post("/presencas/remover-data-membros", async (req, res) => {
  try {
    const { data, membroIds } = req.body;
    const ids = Array.isArray(membroIds) ? membroIds.map(Number).filter(Boolean) : [];

    if (!data || ids.length === 0) {
      return res.status(400).json({ erro: "Informe a data e os membros para remover a presença antiga." });
    }

    await pool.query(
      "DELETE FROM presencas WHERE data = $1 AND membro_id = ANY($2::int[])",
      [data, ids]
    );

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao remover presença antiga:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao remover presença antiga." });
  }
});

app.post("/presencas", async (req, res) => {
  try {
    const { data, registros, nivelUsuario, celula } = req.body;
    const nivel = normalizarNivelUsuario(nivelUsuario || "lider");
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return res.status(400).json({ erro: "Data da reunião inválida." });
    if (data > hojeISO()) return res.status(400).json({ erro: "Não é permitido lançar ou editar presença em data futura." });
    if (nivel !== "admin" && diasDesde(data) > 20) {
      return res.status(403).json({ erro: "O prazo de 20 dias para inclusão ou edição desta reunião foi encerrado. Solicite a correção a um administrador." });
    }

    for (const item of registros || []) {
      const { membroId, status } = item;
      const existe = await pool.query("SELECT * FROM presencas WHERE membro_id = $1 AND data = $2", [membroId, data]);
      if (existe.rows.length > 0) await pool.query("UPDATE presencas SET status = $1, celula = COALESCE(NULLIF($4, ''), celula) WHERE membro_id = $2 AND data = $3", [status, membroId, data, celula || ""]);
      else await pool.query("INSERT INTO presencas (membro_id, data, status, celula) VALUES ($1,$2,$3,$4)", [membroId, data, status, celula || null]);
    }
    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao salvar presenças:", erro.message);
    res.status(500).json({ erro: erro.message || "Erro ao salvar presenças" });
  }
});


/* ================================
   DIAGNÓSTICO TEMPORÁRIO — HISTÓRICO DE VISITANTE
   Remover após a investigação.
================================ */
app.get("/diagnostico/historico-visitante", async (req, res) => {
  try {
    const nomeAlvo = "TESTE HOJE240926";
    const dataAlvo = "2026-05-15";

    const membrosResult = await pool.query(`
      SELECT
        id,
        nome,
        status,
        origem_cadastro AS "origemCadastro",
        celula,
        data_cadastro AS "dataCadastro",
        data_arquivamento AS "dataArquivamento"
      FROM membros
      WHERE UPPER(TRIM(nome)) = UPPER($1)
      ORDER BY id ASC
    `, [nomeAlvo]);

    const ids = membrosResult.rows.map((m) => m.id);

    let historicoVisitante = [];
    if (ids.length) {
      const historicoResult = await pool.query(`
        SELECT id, membro_id AS "membroId", data, status, celula
        FROM presencas
        WHERE membro_id = ANY($1::int[])
        ORDER BY data ASC, id ASC
      `, [ids]);
      historicoVisitante = historicoResult.rows;
    }

    const reuniaoDataResult = await pool.query(`
      SELECT
        p.id AS "presencaId",
        p.membro_id AS "membroId",
        p.data,
        p.status AS "statusPresenca",
        p.celula AS "celulaPresenca",
        m.nome,
        m.status AS "statusMembro",
        m.origem_cadastro AS "origemCadastro",
        m.celula AS "celulaAtual",
        m.data_cadastro AS "dataCadastro",
        m.data_arquivamento AS "dataArquivamento"
      FROM presencas p
      LEFT JOIN membros m ON m.id = p.membro_id
      WHERE p.data = $1
      ORDER BY p.id ASC
    `, [dataAlvo]);

    res.json({
      diagnostico: "historico-visitante-v1",
      alvo: { nome: nomeAlvo, data: dataAlvo, celulaEsperada: "CÉLULA 02 - NOVA" },
      visitanteEncontrado: membrosResult.rows.length > 0,
      cadastrosDoVisitante: membrosResult.rows,
      presencasDoVisitante: historicoVisitante,
      todosOsRegistrosNaData: reuniaoDataResult.rows
    });
  } catch (erro) {
    console.error("Erro no diagnóstico histórico:", erro.message);
    res.status(500).json({
      erro: "Erro ao executar diagnóstico histórico.",
      detalhe: erro.message
    });
  }
});

/* ================================
   BACKUP
================================ */
app.get("/backup", async (req, res) => {
  try {
    const membros = await pool.query("SELECT * FROM membros ORDER BY nome ASC, id DESC");
    const usuarios = await pool.query("SELECT * FROM usuarios ORDER BY nome ASC, id DESC");
    const celulas = await pool.query("SELECT * FROM celulas ORDER BY nome ASC, id DESC");
    const presencas = await pool.query("SELECT * FROM presencas ORDER BY data DESC, id DESC");

    res.setHeader("Content-Disposition", "attachment; filename=backup-celulas.json");
    res.setHeader("Content-Type", "application/json");

    res.send(JSON.stringify({
      exportadoEm: new Date().toISOString(),
      membros: membros.rows,
      usuarios: usuarios.rows,
      celulas: celulas.rows,
      presencas: presencas.rows
    }, null, 2));
  } catch (erro) {
    console.error("Erro ao gerar backup:", erro.message);
    res.status(500).json({ erro: "Erro ao gerar backup" });
  }
});

/* ================================
   START
================================ */
async function iniciarServidor() {
  try {
    await garantirTabelas();
    await criarAdmin();

    app.listen(PORT, () => {
      console.log(`+Células Backend V33 Líderes Em Treinamento rodando na porta ${PORT}`);
    });
  } catch (erro) {
    console.error("Erro ao iniciar servidor:", erro.message);
  }
}

iniciarServidor();
