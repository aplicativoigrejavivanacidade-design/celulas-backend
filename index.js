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
      nivel TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS membros (
      id SERIAL PRIMARY KEY,
      nome TEXT,
      telefone TEXT,
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
      observacoes TEXT
    )
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
      cep TEXT,
      rua TEXT,
      numero TEXT,
      complemento TEXT,
      bairro TEXT,
      cidade TEXT,
      estado TEXT,
      geolocalizacao TEXT
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

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_celulas_nome_normalizado
    ON celulas (nome_normalizado)
  `);

  await pool.query(`
    ALTER TABLE celulas
    ADD COLUMN IF NOT EXISTS lider_celula TEXT
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
      "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
      ["Administrador", "admin", "1234", "admin"]
    );
    console.log("Usuário admin criado com sucesso.");
  }
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
    sistema: "+Células Backend V13",
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
      "SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2",
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

    const partes = [
      String(numero || "").trim(),
      String(rua || "").trim(),
      String(bairro || "").trim(),
      String(cidade || "").trim(),
      String(estado || "").trim(),
      String(cep || "").trim()
    ].filter(Boolean);

    if (partes.length < 4) {
      return res.status(400).json({
        ok: false,
        erro: "Endereço insuficiente para geolocalização."
      });
    }

    const query = encodeURIComponent(partes.join(", "));
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${query}`;

    const resposta = await fetch(url, {
      headers: {
        "User-Agent": "mais-celulas/1.0"
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
   USUÁRIOS
================================ */
app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM usuarios ORDER BY id DESC");
    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar usuários:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, usuario, senha, nivel } = req.body;

    const usuarioTratado = String(usuario || "").trim().toLowerCase();

    const existe = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = $1",
      [usuarioTratado]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Usuário já existe" });
    }

    await pool.query(
      "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
      [
        normalizarTexto(nome),
        usuarioTratado,
        String(senha || "").trim(),
        String(nivel || "lider").trim().toLowerCase()
      ]
    );

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao salvar usuário:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar usuário" });
  }
});

app.put("/usuarios/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, usuario, senha, nivel } = req.body;

    const usuarioTratado = String(usuario || "").trim().toLowerCase();

    const existe = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = $1 AND id <> $2",
      [usuarioTratado, id]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Já existe outro usuário com esse login" });
    }

    await pool.query(
      `UPDATE usuarios SET
        nome = $1,
        usuario = $2,
        senha = $3,
        nivel = $4
      WHERE id = $5`,
      [
        normalizarTexto(nome),
        usuarioTratado,
        String(senha || "").trim(),
        String(nivel || "lider").trim().toLowerCase(),
        id
      ]
    );

    res.json({ ok: true });
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

/* ================================
   MEMBROS
================================ */
app.get("/membros", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM membros ORDER BY id DESC");
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

app.post("/membros", async (req, res) => {
  try {
    const {
      nome, telefone, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    } = req.body;

    await pool.query(`
      INSERT INTO membros (
        nome, telefone, celula, nascimento, status,
        cep, rua, numero, complemento, bairro,
        cidade, estado, observacoes
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
      )
    `, [
      normalizarTexto(nome),
      String(telefone || "").trim(),
      "",
      String(nascimento || "").trim(),
      normalizarTexto(status),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      normalizarTexto(observacoes)
    ]);

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao salvar membro:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar membro" });
  }
});

app.put("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome, telefone, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    } = req.body;

    const atual = await pool.query("SELECT * FROM membros WHERE id = $1", [id]);

    if (atual.rows.length === 0) {
      return res.status(404).json({ erro: "Membro não encontrado" });
    }

    const celulaAtual = atual.rows[0].celula || "";

    await pool.query(`
      UPDATE membros SET
        nome = $1,
        telefone = $2,
        celula = $3,
        nascimento = $4,
        status = $5,
        cep = $6,
        rua = $7,
        numero = $8,
        complemento = $9,
        bairro = $10,
        cidade = $11,
        estado = $12,
        observacoes = $13
      WHERE id = $14
    `, [
      normalizarTexto(nome),
      String(telefone || "").trim(),
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
    res.status(500).json({ erro: "Erro ao atualizar membro" });
  }
});

app.delete("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
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
    const result = await pool.query("SELECT * FROM celulas ORDER BY id DESC");
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
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      geolocalizacao,
      membrosSelecionados
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
        nome, nome_normalizado, dia_semana, hora, anfitriao, lider_celula,
        cep, rua, numero, complemento, bairro, cidade, estado, geolocalizacao
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
    `, [
      nomeExibicao,
      nomeNormalizado,
      normalizarTexto(diaSemana),
      String(horaReuniao || "").trim(),
      String(anfitriao || "").trim(),
      String(liderCelula || "").trim(),
      String(cep || "").trim(),
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      String(geolocalizacao || "").trim()
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
      cep,
      rua,
      numero,
      complemento,
      bairro,
      cidade,
      estado,
      geolocalizacao,
      membrosSelecionados
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
        cep = $7,
        rua = $8,
        numero = $9,
        complemento = $10,
        bairro = $11,
        cidade = $12,
        estado = $13,
        geolocalizacao = $14
      WHERE id = $15
    `, [
      nomeExibicao,
      nomeNormalizado,
      normalizarTexto(diaSemana),
      String(horaReuniao || "").trim(),
      String(anfitriao || "").trim(),
      String(liderCelula || "").trim(),
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

    /* mantém os membros já vinculados à célula antiga, apenas atualizando o nome da célula */
    await pool.query(
      "UPDATE membros SET celula = $1 WHERE celula = $2",
      [nomeExibicao, nomeAntigo]
    );

    /* adiciona apenas novos membros disponíveis marcados */
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

    res.json({ ok: true, celulaId: id });
  } catch (erro) {
    console.error("Erro ao atualizar célula:", erro.message);
    res.status(500).json({ erro: "Erro ao atualizar célula" });
  }
});

app.delete("/celulas/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const atual = await pool.query("SELECT * FROM celulas WHERE id = $1", [id]);

    if (atual.rows.length === 0) {
      return res.status(404).json({ erro: "Célula não encontrada" });
    }

    const nomeCelula = atual.rows[0].nome;

    await pool.query("UPDATE membros SET celula = '' WHERE celula = $1", [nomeCelula]);
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

app.get("/presencas/:data", async (req, res) => {
  try {
    const { data } = req.params;

    const result = await pool.query(
      'SELECT membro_id as "membroId", status FROM presencas WHERE data = $1',
      [data]
    );

    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar presenças por data:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});

app.post("/presencas", async (req, res) => {
  try {
    const { data, registros } = req.body;

    for (const item of registros || []) {
      const { membroId, status } = item;

      const existe = await pool.query(
        "SELECT * FROM presencas WHERE membro_id = $1 AND data = $2",
        [membroId, data]
      );

      if (existe.rows.length > 0) {
        await pool.query(
          "UPDATE presencas SET status = $1 WHERE membro_id = $2 AND data = $3",
          [status, membroId, data]
        );
      } else {
        await pool.query(
          "INSERT INTO presencas (membro_id, data, status) VALUES ($1,$2,$3)",
          [membroId, data, status]
        );
      }
    }

    res.json({ ok: true });
  } catch (erro) {
    console.error("Erro ao salvar presenças:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar presenças" });
  }
});

/* ================================
   BACKUP
================================ */
app.get("/backup", async (req, res) => {
  try {
    const membros = await pool.query("SELECT * FROM membros ORDER BY id DESC");
    const usuarios = await pool.query("SELECT * FROM usuarios ORDER BY id DESC");
    const celulas = await pool.query("SELECT * FROM celulas ORDER BY id DESC");
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
      console.log(`+Células Backend V13 rodando na porta ${PORT}`);
    });
  } catch (erro) {
    console.error("Erro ao iniciar servidor:", erro.message);
  }
}

iniciarServidor();