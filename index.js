const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const PDFDocument = require("pdfkit");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false
});

/* ================================
   HEALTH CHECK
================================ */
app.get("/", (req, res) => {
  res.json({
    ok: true,
    sistema: "+Células Backend V9",
    status: "ONLINE"
  });
});

/* ================================
   MEMBROS
================================ */
app.get("/membros", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM membros ORDER BY id DESC");
    res.json(result.rows);
  } catch {
    res.status(500).json({ erro: "Erro ao buscar membros" });
  }
});

/* ================================
   BACKUP JSON
================================ */
app.get("/backup", async (req, res) => {
  try {
    const membros = await pool.query("SELECT * FROM membros ORDER BY id DESC");
    const usuarios = await pool.query("SELECT * FROM usuarios ORDER BY id DESC");
    const celulas = await pool.query("SELECT * FROM celulas ORDER BY id DESC");
    const presencas = await pool.query("SELECT * FROM presencas ORDER BY data DESC");

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=backup-celulas.json"
    );
    res.setHeader("Content-Type", "application/json");

    res.send(JSON.stringify({
      exportadoEm: new Date().toISOString(),
      membros: membros.rows,
      usuarios: usuarios.rows,
      celulas: celulas.rows,
      presencas: presencas.rows
    }, null, 2));

  } catch {
    res.status(500).json({ erro: "Erro ao gerar backup" });
  }
});

/* ================================
   RELATÓRIO PDF
================================ */
app.get("/relatorio-pdf", async (req, res) => {
  try {
    const membros = await pool.query("SELECT * FROM membros ORDER BY nome ASC");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=relatorio-celulas.pdf"
    );

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(22).text("+Células - Relatório Geral");
    doc.moveDown();
    doc.fontSize(12).text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`);
    doc.moveDown();

    doc.fontSize(16).text(`Total de membros: ${membros.rows.length}`);
    doc.moveDown();

    membros.rows.forEach((m, i) => {
      doc
        .fontSize(12)
        .text(`${i + 1}. ${m.nome}`)
        .text(`Telefone: ${m.telefone || "-"}`)
        .text(`Célula: ${m.celula || "SEM CÉLULA"}`)
        .text(`Status: ${m.status || "-"}`)
        .moveDown();
    });

    doc.end();

  } catch {
    res.status(500).json({ erro: "Erro ao gerar PDF" });
  }
});

app.listen(PORT, () => {
  console.log("+Células backend V9 online");
});