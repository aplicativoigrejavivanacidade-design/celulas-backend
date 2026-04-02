const express = require("express");
const cors = require("cors");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

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

function montarNomeCelulaExibicao(valor) {
  const base = normalizarTexto(valor).replace(/^CELULA\s*/i, "").trim();
  return base ? `CÉLULA ${base}` : "";
}

/* ================================
   ADMIN
================================ */
async function criarAdmin() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome TEXT,
        usuario TEXT UNIQUE,
        senha TEXT,
        nivel TEXT
      )
    `);

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
  } catch (erro) {
    console.error("Erro ao criar admin:", erro.message);
  }
}

/* ================================
   RAIZ / STATUS
================================ */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/status", (req, res) => {
  res.json({
    ok: true,
    sistema: "+Células Backend V11",
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
      "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2",
      [usuario, senha]
    );

    if (result.rows.length > 0) {
      return res.json({
        sucesso: true,
        usuario: result.rows[0]
      });
    }

    return res.status(401).json({
      sucesso: false,
      erro: "Usuário ou senha inválidos"
    });
  } catch (erro) {
    console.error("Erro no login:", erro.message);
    return res.status(500).json({
      sucesso: false,
      erro: "Erro no login"
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
    res.status(500).json({ erro: "Erro ao buscar usuários" });
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
    res.status(500).json({ erro: "Erro ao buscar membros" });
  }
});

app.post("/membros", async (req, res) => {
  try {
    const {
      nome, telefone, celula, nascimento, status,
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
      telefone || "",
      celula ? montarNomeCelulaExibicao(celula) : "",
      nascimento || "",
      normalizarTexto(status),
      cep || "",
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
    res.status(500).json({ erro: "Erro ao salvar membro" });
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
    res.status(500).json({ erro: "Erro ao buscar células" });
  }
});

app.post("/celulas", async (req, res) => {
  try {
    const {
      nomeCelula,
      diaSemana,
      horaReuniao,
      anfitriao,
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

    const result = await pool.query(`
      INSERT INTO celulas (
        nome, nome_normalizado, dia_semana, hora, anfitriao,
        cep, rua, numero, complemento, bairro, cidade, estado, geolocalizacao
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `, [
      nomeExibicao,
      nomeNormalizado,
      normalizarTexto(diaSemana),
      horaReuniao || "",
      anfitriao || "",
      cep || "",
      normalizarTexto(rua),
      normalizarTexto(numero),
      normalizarTexto(complemento),
      normalizarTexto(bairro),
      normalizarTexto(cidade),
      normalizarTexto(estado),
      geolocalizacao || ""
    ]);

    if (Array.isArray(membrosSelecionados)) {
      for (const membroId of membrosSelecionados) {
        await pool.query(
          "UPDATE membros SET celula=$1 WHERE id=$2",
          [nomeExibicao, membroId]
        );
      }
    }

    res.json({ ok: true, celulaId: result.rows[0].id });
  } catch (erro) {
    res.status(500).json({ erro: "Erro ao salvar célula" });
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
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});

/* ================================
   BACKUP
================================ */
app.get("/backup", async (req, res) => {
  try {
    const membros = await pool.query("SELECT * FROM membros");
    const usuarios = await pool.query("SELECT * FROM usuarios");
    const celulas = await pool.query("SELECT * FROM celulas");
    const presencas = await pool.query("SELECT * FROM presencas");

    res.json({
      exportadoEm: new Date().toISOString(),
      membros: membros.rows,
      usuarios: usuarios.rows,
      celulas: celulas.rows,
      presencas: presencas.rows
    });
  } catch (erro) {
    res.status(500).json({ erro: "Erro ao gerar backup" });
  }
});

/* ================================
   START
================================ */
async function iniciarServidor() {
  try {
    await criarAdmin();

    app.listen(PORT, () => {
      console.log(`+Células Backend V11 rodando na porta ${PORT}`);
    });
  } catch (erro) {
    console.error("Erro ao iniciar:", erro.message);
  }
}

iniciarServidor();