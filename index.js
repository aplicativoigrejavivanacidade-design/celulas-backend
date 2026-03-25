const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================================
   ADMIN
================================ */
async function criarAdmin() {
  const result = await pool.query("SELECT * FROM usuarios WHERE usuario = 'admin'");
  if (result.rows.length === 0) {
    await pool.query(
      "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
      ["Administrador", "admin", "1234", "admin"]
    );
  }
}
criarAdmin();

/* ================================
   LOGIN
================================ */
app.post("/login", async (req, res) => {
  const { usuario, senha } = req.body;
  const result = await pool.query(
    "SELECT * FROM usuarios WHERE usuario=$1 AND senha=$2",
    [usuario, senha]
  );

  if (result.rows.length > 0) {
    res.json({ usuario: result.rows[0] });
  } else {
    res.status(401).json({ erro: "Login inválido" });
  }
});

/* ================================
   MEMBROS
================================ */
app.get("/membros", async (req, res) => {
  const result = await pool.query("SELECT * FROM membros ORDER BY id DESC");
  res.json(result.rows);
});

app.post("/membros", async (req, res) => {
  const dados = req.body;

  await pool.query(`
    INSERT INTO membros (
      nome, telefone, celula, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    )
  `, Object.values(dados));

  res.json({ ok: true });
});

/* ================================
   PRESENÇA
================================ */

// BUSCAR POR DATA
app.get("/presencas/:data", async (req, res) => {
  const { data } = req.params;

  const result = await pool.query(
    "SELECT membro_id as \"membroId\", status FROM presencas WHERE data=$1",
    [data]
  );

  res.json(result.rows);
});

// SALVAR/ATUALIZAR EM LOTE
app.post("/presencas", async (req, res) => {
  const { data, registros } = req.body;

  for (const item of registros) {
    const { membroId, status } = item;

    const existe = await pool.query(
      "SELECT * FROM presencas WHERE membro_id=$1 AND data=$2",
      [membroId, data]
    );

    if (existe.rows.length > 0) {
      await pool.query(
        "UPDATE presencas SET status=$1 WHERE membro_id=$2 AND data=$3",
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
});

/* ================================
   START
================================ */
app.listen(3000, () => {
  console.log("Servidor rodando");
});
