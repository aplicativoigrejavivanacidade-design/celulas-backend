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

async function criarAdmin() {
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE usuario = 'admin'");

    if (result.rows.length === 0) {
      await pool.query(
        "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1, $2, $3, $4)",
        ["Administrador", "admin", "1234", "admin"]
      );
      console.log("Admin criado");
    }
  } catch (err) {
    console.error("Erro ao criar admin:", err.message);
  }
}

criarAdmin();

app.post("/login", async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    const result = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = $1 AND senha = $2",
      [usuario, senha]
    );

    if (result.rows.length > 0) {
      res.json({ usuario: result.rows[0] });
    } else {
      res.status(401).json({ erro: "Usuário ou senha inválidos" });
    }
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM usuarios ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, usuario, senha, nivel } = req.body;

    await pool.query(
      "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1, $2, $3, $4)",
      [nome, usuario, senha, nivel]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.get("/membros", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM membros ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.post("/membros", async (req, res) => {
  try {
    const {
      nome, telefone, celula, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    } = req.body;

    await pool.query(
      `INSERT INTO membros
      (nome, telefone, celula, nascimento, status, cep, rua, numero, complemento, bairro, cidade, estado, observacoes)
      VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [nome, telefone, celula, nascimento, status, cep, rua, numero, complemento, bairro, cidade, estado, observacoes]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
