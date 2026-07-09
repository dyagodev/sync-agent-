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
  const { queries } = carregarConfig();
  const { rows: vendas } = await obterPool().query(queries.vendas, [ultimoIdProcessado]);

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
async function buscarEstoqueAtualizado(desde) {
  const { queries } = carregarConfig();
  if (!queries.estoque) {
    return [];
  }

  const { rows } = await obterPool().query(queries.estoque, [desde]);
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

async function encerrarConexao() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { buscarVendasNovas, buscarEstoqueAtualizado, testarConexao, encerrarConexao };
