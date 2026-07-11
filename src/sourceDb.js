const pg = require("pg");
const { carregarConfig } = require("./config");

// node-postgres, por padrão, interpreta colunas "timestamp without time zone"
// como se fossem hora LOCAL da máquina que roda o agente, convertendo para um
// Date/UTC errado se o agente rodar num fuso diferente do banco de origem.
// Como só usamos esses timestamps como marcador de "já processei até aqui"
// (nunca fazemos aritmética de data com eles), tratamos como string bruta —
// evita completamente esse tipo de bug de fuso horário.
pg.types.setTypeParser(1114, (valor) => valor); // timestamp
pg.types.setTypeParser(1184, (valor) => valor); // timestamptz

let pool = null;

function obterPool() {
  if (!pool) {
    const { source } = carregarConfig();
    pool = new pg.Pool({
      host: source.host,
      port: source.port,
      database: source.database,
      user: source.user,
      password: source.password,
      ssl: source.ssl ? { rejectUnauthorized: false } : false,
    });
  }
  return pool;
}

/**
 * Busca o próximo lote de vendas novas (id > ultimoIdProcessado) e já traz
 * itens e pagamentos agrupados por venda.
 */
async function buscarVendasNovas(ultimoIdProcessado) {
  const { queries, syncDesde } = carregarConfig();
  const { rows: vendas } = await obterPool().query(queries.vendas, [ultimoIdProcessado, syncDesde]);

  if (vendas.length === 0) {
    return [];
  }

  const idsVendas = vendas.map((v) => v.id);

  const [{ rows: itens }, { rows: pagamentos }] = await Promise.all([
    obterPool().query(queries.itens, [idsVendas]),
    obterPool().query(queries.pagamentos, [idsVendas]),
  ]);

  return vendas.map((venda) => ({
    id: venda.id,
    dataHora: venda.data_hora,
    valorTotal: venda.valor_total,
    lojaExterna: venda.loja_externa,
    itens: itens.filter((item) => item.venda_id === venda.id),
    pagamentos: pagamentos.filter((pagamento) => pagamento.venda_id === venda.id),
  }));
}

/**
 * Busca registros de estoque atualizados desde a última verificação — pega
 * ajustes feitos sem venda (contagem manual, balança, entrada de mercadoria
 * lançada direto no Link Pro). Retorna [] se a query estoque.sql não existir
 * (recurso opcional).
 */
async function buscarEstoqueAtualizado(desde, ultimoId) {
  const { queries } = carregarConfig();
  if (!queries.estoque) {
    return [];
  }

  const { rows } = await obterPool().query(queries.estoque, [desde, ultimoId]);
  return rows;
}

/**
 * Testa uma conexão avulsa com os dados informados (usado pela janela de
 * configuração), sem afetar o pool principal do agente.
 */
async function testarConexao(dadosConexao) {
  const client = new pg.Client({
    host: dadosConexao.host,
    port: Number(dadosConexao.port),
    database: dadosConexao.database,
    user: dadosConexao.user,
    password: dadosConexao.password,
    ssl: dadosConexao.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query("select 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Busca as lojas conhecidas no Link Pro, pra facilitar preencher o
 * mapeamento de lojas na janela de configuração sem precisar abrir o Link
 * Pro pra descobrir nome/código de cada uma.
 *
 * Confirmado direto na tela "Dados da Empresa → Lojas" do Link Pro: essa
 * tela lista, na grade, as OUTRAS lojas conhecidas por esta (tabela
 * dados_empresa_loja, com Código/Loja/Servidor/Porta) — a loja ATUAL (a
 * dona desta conexão) fica separada, em "Informações desta loja", que
 * corresponde à tabela dados_empresa (1 linha, campo codigo_loja).
 *
 * Por isso buscamos as duas: "esta loja" (dados_empresa, sempre marcada
 * como a loja da conexão atual) e as demais (dados_empresa_loja, só
 * referência — não são a loja desta conexão).
 */
async function buscarLojasLinkPro(dadosConexao) {
  const client = new pg.Client({
    host: dadosConexao.host,
    port: Number(dadosConexao.port),
    database: dadosConexao.database,
    user: dadosConexao.user,
    password: dadosConexao.password,
    ssl: dadosConexao.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8000,
  });

  await client.connect();

  const lojas = [];

  try {
    const { rows } = await client.query(
      "select codigo_loja, descricao_loja, nome_fantasia, razao_social from dados_empresa limit 1",
    );
    const atual = rows[0];
    if (atual && atual.codigo_loja != null) {
      lojas.push({
        id: String(atual.codigo_loja),
        nome: `${atual.descricao_loja || atual.nome_fantasia || atual.razao_social || "Esta loja"} (esta conexão)`,
        provavelEsta: true,
      });
    }
  } catch {
    // dados_empresa não existe nessa instalação — segue sem "esta loja".
  }

  try {
    const { rows } = await client.query(
      "select codigo, descricao, nome_fantasia from dados_empresa_loja order by codigo",
    );
    for (const loja of rows) {
      lojas.push({
        id: String(loja.codigo),
        nome: loja.nome_fantasia || loja.descricao || `Loja ${loja.codigo}`,
        provavelEsta: false,
      });
    }
  } catch {
    // dados_empresa_loja não existe nessa instalação — segue só com "esta loja".
  }

  await client.end().catch(() => undefined);

  return lojas;
}

/**
 * Lista os valores de forma de pagamento que aparecem de verdade em
 * negociacao_parcela (com quantas parcelas usam cada um), pra preencher o
 * mapeamento de formas de pagamento da janela de configuração sem precisar
 * adivinhar ou abrir o Link Pro — mostra exatamente o texto bruto salvo lá
 * (ex.: "Dinheiro", "Pix", "Cartao"), que é o valor esperado em cada campo
 * "código de origem" da seção "Formas de pagamento".
 */
async function buscarFormasPagamentoLinkPro(dadosConexao) {
  const client = new pg.Client({
    host: dadosConexao.host,
    port: Number(dadosConexao.port),
    database: dadosConexao.database,
    user: dadosConexao.user,
    password: dadosConexao.password,
    ssl: dadosConexao.ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 8000,
  });

  await client.connect();

  try {
    const { rows } = await client.query(
      "select forma_pagamento, count(*) as qtd from negociacao_parcela group by 1 order by 2 desc limit 20",
    );
    return rows.map((row) => ({ formaPagamento: row.forma_pagamento, quantidade: Number(row.qtd) }));
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function encerrarConexao() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  buscarVendasNovas,
  buscarEstoqueAtualizado,
  testarConexao,
  buscarLojasLinkPro,
  buscarFormasPagamentoLinkPro,
  encerrarConexao,
};
