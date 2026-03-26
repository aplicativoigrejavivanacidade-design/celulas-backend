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
  try {
    const result = await pool.query("SELECT * FROM usuarios WHERE usuario = 'admin'");
    if (result.rows.length === 0) {
      await pool.query(
        "INSERT INTO usuarios (nome, usuario, senha, nivel) VALUES ($1,$2,$3,$4)",
        ["Administrador", "admin", "1234", "admin"]
      );
    }
  } catch (erro) {
    console.error("Erro ao criar admin:", erro.message);
  }
}
criarAdmin();

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
      res.json({ usuario: result.rows[0] });
    } else {
      res.status(401).json({ erro: "Login inválido" });
    }
  } catch (erro) {
    console.error("Erro no login:", erro.message);
    res.status(500).json({ erro: "Erro no login" });
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
  } catch (erro) {
    console.error("Erro ao salvar membro:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar membro" });
  }
});

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
  } catch (erro) {
    console.error("Erro ao atualizar membro:", erro.message);
    res.status(500).json({ erro: "Erro ao atualizar membro" });
  }
});

app.delete("/membros/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM membros WHERE id=$1", [id]);
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

    const existe = await pool.query(
      "SELECT * FROM celulas WHERE nome=$1",
      [nomeCelula]
    );

    if (existe.rows.length > 0) {
      return res.status(400).json({ erro: "Célula já existe" });
    }

    const result = await pool.query(`
      INSERT INTO celulas (
        nome, dia_semana, hora, anfitriao,
        cep, rua, numero, complemento,
        bairro, cidade, estado, geolocalizacao
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING id
    `, [
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
      geolocalizacao
    ]);

    if (Array.isArray(membrosSelecionados)) {
      for (const membroId of membrosSelecionados) {
        await pool.query(
          "UPDATE membros SET celula=$1 WHERE id=$2",
          [nomeCelula, membroId]
        );
      }
    }

    res.json({ ok: true, celulaId: result.rows[0].id });
  } catch (erro) {
    console.error("Erro ao salvar célula:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar célula" });
  }
});

/* ================================
   PRESENÇA
================================ */
app.get("/presencas/:data", async (req, res) => {
  try {
    const { data } = req.params;

    const result = await pool.query(
      "SELECT membro_id as \"membroId\", status FROM presencas WHERE data=$1",
      [data]
    );

    res.json(result.rows);
  } catch (erro) {
    console.error("Erro ao buscar presenças:", erro.message);
    res.status(500).json({ erro: "Erro ao buscar presenças" });
  }
});

app.post("/presencas", async (req, res) => {
  try {
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
  } catch (erro) {
    console.error("Erro ao salvar presenças:", erro.message);
    res.status(500).json({ erro: "Erro ao salvar presenças" });
  }
});

/* ================================
   START
================================ */
app.listen(3000, () => {
  console.log("Servidor rodando");
});
