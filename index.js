const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

/* ================================
   🔥 CONEXÃO COM SUPABASE
================================ */

const pool = new Pool({
  connectionString: "postgresql://postgres.ltrkuqikzkulppwaivis:SUA_SENHA_AQUI@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
  ssl: { rejectUnauthorized: false }
});

/* ================================
   🔐 CRIAR ADMIN AUTOMÁTICO
================================ */

async function criarAdmin() {
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE usuario = 'admin'");

    if (result.rows.length === 0) {
      await pool.query(
        "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
        ["Administrador", "admin", "1234", "admin"]
      );
      console.log("Admin criado");
    }
  } catch (err) {
    console.error("Erro ao criar admin:", err);
  }
}

criarAdmin();

/* ================================
   🔐 LOGIN
================================ */

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
    res.status(500).json({ erro: "Erro no servidor" });
  }
});

/* ================================
   👤 USUÁRIOS
================================ */

app.get("/usuarios", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM usuarios");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar usuários" });
  }
});

app.post("/usuarios", async (req, res) => {
  try {
    const { nome, usuario, senha, nivel } = req.body;

    await pool.query(
      "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
      [nome, usuario, senha, nivel]
    );

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: "Erro ao criar usuário" });
  }
});

/* ================================
   👥 MEMBROS
================================ */

app.get("/membros", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM membros ORDER BY id DESC");
    res.json(result.rows);
  } catch (err) {
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
      nome, telefone, celula, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    ]);

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ erro: "Erro ao cadastrar membro" });
  }
});

/* ================================
   ✏️ EDITAR MEMBRO
================================ */

app.put("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nome, telefone, celula, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes
    } = req.body;

    await pool.query(`
      UPDATE membros SET
        nome=$1, telefone=$2, celula=$3, nascimento=$4, status=$5,
        cep=$6, rua=$7, numero=$8, complemento=$9, bairro=$10,
        cidade=$11, estado=$12, observacoes=$13
      WHERE id=$14
    `, [
      nome, telefone, celula, nascimento, status,
      cep, rua, numero, complemento, bairro,
      cidade, estado, observacoes, id
    ]);

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ erro: "Erro ao atualizar membro" });
  }
});

/* ================================
   🗑️ EXCLUIR MEMBRO
================================ */

app.delete("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query("DELETE FROM membros WHERE id=$1", [id]);

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ erro: "Erro ao excluir membro" });
  }
});

/* ================================
   📊 PRESENÇA
================================ */

app.get("/presencas", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM presencas");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});

app.post("/presencas", async (req, res) => {
  try {
    const { membro_id, data, status } = req.body;

    await pool.query(
      "INSERT INTO presencas (membro_id, data, status) VALUES ($1,$2,$3)",
      [membro_id, data, status]
    );

    res.json({ ok: true });

  } catch (err) {
    res.status(500).json({ erro: "Erro ao salvar presença" });
  }
});

/* ================================
   🚀 START
================================ */

app.listen(3000, () => {
  console.log("Servidor rodando na porta 3000");
});
