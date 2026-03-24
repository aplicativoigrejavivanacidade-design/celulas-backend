const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const arquivoMembros = path.join(__dirname, 'membros.json');
const arquivoPresencas = path.join(__dirname, 'presencas.json');
const arquivoUsuarios = path.join(__dirname, 'usuarios.json');

function garantirArquivo(arquivo, valorInicial = []) {
  try {
    if (!fs.existsSync(arquivo)) {
      fs.writeFileSync(arquivo, JSON.stringify(valorInicial, null, 2));
    }
  } catch (error) {
    console.error(`Erro ao garantir arquivo ${arquivo}:`, error);
  }
}

function lerJson(arquivo, valorInicial = []) {
  try {
    garantirArquivo(arquivo, valorInicial);
    const dados = fs.readFileSync(arquivo, 'utf8');
    return JSON.parse(dados);
  } catch (error) {
    console.error(`Erro ao ler ${arquivo}:`, error);
    return valorInicial;
  }
}

function salvarJson(arquivo, dados) {
  try {
    fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));
  } catch (error) {
    console.error(`Erro ao salvar ${arquivo}:`, error);
  }
}

function proximoId(lista) {
  return lista.length > 0 ? Math.max(...lista.map(item => item.id || 0)) + 1 : 1;
}

function textoMaiusculo(valor) {
  if (valor === undefined || valor === null) return '';
  return String(valor).trim().toUpperCase();
}

function normalizarMembro(dados = {}, membroAtual = null) {
  return {
    id: membroAtual ? membroAtual.id : undefined,
    nome: textoMaiusculo(dados.nome || (membroAtual && membroAtual.nome)),
    telefone: textoMaiusculo(dados.telefone || (membroAtual && membroAtual.telefone)),
    celula: textoMaiusculo(dados.celula || (membroAtual && membroAtual.celula)),
    nascimento: dados.nascimento !== undefined
      ? dados.nascimento
      : (membroAtual ? membroAtual.nascimento || '' : ''),
    status: textoMaiusculo(dados.status || (membroAtual && membroAtual.status) || 'ATIVO'),
    observacoes: textoMaiusculo(dados.observacoes || (membroAtual && membroAtual.observacoes)),

    cep: textoMaiusculo(dados.cep || (membroAtual && membroAtual.cep)),
    rua: textoMaiusculo(dados.rua || (membroAtual && membroAtual.rua)),
    numero: textoMaiusculo(dados.numero || (membroAtual && membroAtual.numero)),
    complemento: textoMaiusculo(dados.complemento || (membroAtual && membroAtual.complemento)),
    bairro: textoMaiusculo(dados.bairro || (membroAtual && membroAtual.bairro)),
    cidade: textoMaiusculo(dados.cidade || (membroAtual && membroAtual.cidade)),
    estado: textoMaiusculo(dados.estado || (membroAtual && membroAtual.estado))
  };
}

function garantirAdminPadrao() {
  const usuarios = lerJson(arquivoUsuarios, []);
  const existeAdmin = usuarios.some((u) => u.usuario === 'admin');

  if (!existeAdmin) {
    usuarios.push({
      id: 1,
      nome: 'Administrador',
      usuario: 'admin',
      senha: '1234',
      nivel: 'admin'
    });
    salvarJson(arquivoUsuarios, usuarios);
  }
}

garantirAdminPadrao();

app.get('/', (req, res) => {
  res.send('API +Células funcionando 🚀');
});

/* LOGIN */

app.post('/login', (req, res) => {
  const { usuario, senha } = req.body;
  const usuarios = lerJson(arquivoUsuarios, []);

  const encontrado = usuarios.find(
    (u) => u.usuario === usuario && u.senha === senha
  );

  if (!encontrado) {
    return res.status(401).json({ erro: 'Usuário ou senha inválidos' });
  }

  res.json({
    sucesso: true,
    usuario: {
      id: encontrado.id,
      nome: encontrado.nome,
      usuario: encontrado.usuario,
      nivel: encontrado.nivel
    }
  });
});

/* USUÁRIOS */

app.get('/usuarios', (req, res) => {
  const usuarios = lerJson(arquivoUsuarios, []);
  const semSenha = usuarios.map(({ senha, ...resto }) => resto);
  res.json(semSenha);
});

app.post('/usuarios', (req, res) => {
  const usuarios = lerJson(arquivoUsuarios, []);
  const { nome, usuario, senha, nivel } = req.body;

  if (!nome || !usuario || !senha || !nivel) {
    return res.status(400).json({ erro: 'Preencha todos os campos' });
  }

  const existe = usuarios.some((u) => u.usuario === usuario);
  if (existe) {
    return res.status(400).json({ erro: 'Nome de usuário já existe' });
  }

  const novo = {
    id: proximoId(usuarios),
    nome,
    usuario,
    senha,
    nivel
  };

  usuarios.push(novo);
  salvarJson(arquivoUsuarios, usuarios);

  const { senha: _, ...retorno } = novo;
  res.json(retorno);
});

app.put('/usuarios/:id', (req, res) => {
  const usuarios = lerJson(arquivoUsuarios, []);
  const id = Number(req.params.id);
  const indice = usuarios.findIndex((u) => u.id === id);

  if (indice === -1) {
    return res.status(404).json({ erro: 'Usuário não encontrado' });
  }

  const atual = usuarios[indice];
  const atualizado = {
    ...atual,
    ...req.body,
    id: atual.id
  };

  const duplicado = usuarios.some(
    (u) => u.usuario === atualizado.usuario && u.id !== id
  );

  if (duplicado) {
    return res.status(400).json({ erro: 'Nome de usuário já existe' });
  }

  usuarios[indice] = atualizado;
  salvarJson(arquivoUsuarios, usuarios);

  const { senha, ...retorno } = atualizado;
  res.json(retorno);
});

app.delete('/usuarios/:id', (req, res) => {
  const usuarios = lerJson(arquivoUsuarios, []);
  const id = Number(req.params.id);

  const usuario = usuarios.find((u) => u.id === id);
  if (!usuario) {
    return res.status(404).json({ erro: 'Usuário não encontrado' });
  }

  if (usuario.usuario === 'admin') {
    return res.status(400).json({ erro: 'Não é permitido excluir o admin principal' });
  }

  const filtrados = usuarios.filter((u) => u.id !== id);
  salvarJson(arquivoUsuarios, filtrados);

  res.json({ sucesso: true });
});

/* MEMBROS */

app.get('/membros', (req, res) => {
  const membros = lerJson(arquivoMembros, []);
  res.json(membros);
});

app.post('/membros', (req, res) => {
  const membros = lerJson(arquivoMembros, []);

  if (!req.body.nome || String(req.body.nome).trim() === '') {
    return res.status(400).json({ erro: 'Nome do membro é obrigatório' });
  }

  const novo = normalizarMembro(req.body);
  novo.id = proximoId(membros);

  membros.push(novo);
  salvarJson(arquivoMembros, membros);
  res.json(novo);
});

app.put('/membros/:id', (req, res) => {
  const membros = lerJson(arquivoMembros, []);
  const id = Number(req.params.id);

  const indice = membros.findIndex((membro) => membro.id === id);

  if (indice === -1) {
    return res.status(404).json({ erro: 'Membro não encontrado' });
  }

  const atual = membros[indice];
  const atualizado = normalizarMembro(req.body, atual);
  atualizado.id = id;

  if (!atualizado.nome || atualizado.nome.trim() === '') {
    return res.status(400).json({ erro: 'Nome do membro é obrigatório' });
  }

  membros[indice] = atualizado;

  salvarJson(arquivoMembros, membros);
  res.json(membros[indice]);
});

app.delete('/membros/:id', (req, res) => {
  const membros = lerJson(arquivoMembros, []);
  const id = Number(req.params.id);

  const existe = membros.some((membro) => membro.id === id);
  if (!existe) {
    return res.status(404).json({ erro: 'Membro não encontrado' });
  }

  const filtrados = membros.filter((membro) => membro.id !== id);
  salvarJson(arquivoMembros, filtrados);

  res.json({ sucesso: true });
});

/* PRESENÇAS */

app.get('/presencas', (req, res) => {
  const presencas = lerJson(arquivoPresencas, []);
  res.json(presencas);
});

app.get('/presencas/:data', (req, res) => {
  const presencas = lerJson(arquivoPresencas, []);
  const data = req.params.data;

  const filtradas = presencas.filter((item) => item.data === data);
  res.json(filtradas);
});

app.post('/presencas', (req, res) => {
  const presencas = lerJson(arquivoPresencas, []);
  const membros = lerJson(arquivoMembros, []);

  const { data, registros } = req.body;

  if (!data || !Array.isArray(registros)) {
    return res.status(400).json({ erro: 'Dados inválidos' });
  }

  const outrasDatas = presencas.filter((item) => item.data !== data);

  const novosRegistros = registros.map((registro, index) => {
    const membro = membros.find((m) => m.id === registro.membroId);

    return {
      id: Date.now() + index,
      data,
      membroId: registro.membroId,
      nome: membro ? membro.nome : 'Desconhecido',
      status: registro.status
    };
  });

  const atualizadas = [...outrasDatas, ...novosRegistros];
  salvarJson(arquivoPresencas, atualizadas);

  res.json({ sucesso: true, total: novosRegistros.length });
});

app.listen(3000, () => {
  console.log('Servidor rodando em http://localhost:3000');
});
