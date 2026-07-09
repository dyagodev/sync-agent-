const fs = require("node:fs");
const path = require("node:path");
const pg = require("pg");
const { obterDiretorioBase } = require("./baseDir");

// Palavras que ajudam a apontar quais tabelas provavelmente interessam pra
// escrever vendas.sql/itens.sql/pagamentos.sql/estoque.sql — é só uma dica
// visual no topo do log, não filtra nada.
const PALAVRAS_CHAVE = [
  "venda",
  "item",
  "pagto",
  "pagamento",
  "estoque",
  "produto",
  "cliente",
  "fornecedor",
  "loja",
  "filial",
];

/**
 * Conecta no Postgres de origem com os dados informados e lê a estrutura
 * inteira do schema "public": tabelas, colunas, tipos, e uma contagem
 * aproximada de linhas por tabela (via estatística do Postgres, rápido e não
 * trava em tabelas grandes).
 */
async function inspecionarEsquema(dadosConexao) {
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
    const { rows: colunas } = await client.query(`
      select table_name, column_name, data_type, is_nullable, column_default, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position
    `);

    const { rows: contagens } = await client.query(`
      select relname as table_name, greatest(reltuples::bigint, 0) as linhas_aprox
      from pg_class
      join pg_namespace on pg_namespace.oid = pg_class.relnamespace
      where pg_namespace.nspname = 'public' and pg_class.relkind = 'r'
    `);

    const linhasPorTabela = Object.fromEntries(contagens.map((c) => [c.table_name, c.linhas_aprox]));

    const tabelas = new Map();
    for (const coluna of colunas) {
      if (!tabelas.has(coluna.table_name)) {
        tabelas.set(coluna.table_name, {
          nome: coluna.table_name,
          linhasAprox: linhasPorTabela[coluna.table_name] ?? null,
          colunas: [],
        });
      }
      tabelas.get(coluna.table_name).colunas.push({
        nome: coluna.column_name,
        tipo: coluna.data_type,
        nullable: coluna.is_nullable === "YES",
        padrao: coluna.column_default,
      });
    }

    const amostras = await coletarAmostras(client);

    return { tabelas: [...tabelas.values()], amostras };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Roda algumas consultas pequenas e específicas em tabelas que costumam
 * responder perguntas que a estrutura sozinha não responde (ex: quais textos
 * de forma de pagamento existem de verdade, quantas "lojas" o banco conhece).
 * Cada uma é isolada e tolera a tabela/coluna não existir (schemas variam).
 */
async function coletarAmostras(client) {
  const amostras = {};

  async function tentar(chave, sql) {
    try {
      const { rows } = await client.query(sql);
      amostras[chave] = rows;
    } catch {
      // tabela/coluna não existe nesse banco — ignora, não é erro fatal.
    }
  }

  await tentar("dados_empresa_loja", "select * from dados_empresa_loja limit 20");
  await tentar(
    "forma_pagamento_negociacao_parcela",
    "select forma_pagamento, count(*) as qtd from negociacao_parcela group by 1 order by 2 desc limit 20",
  );
  await tentar("config_forma_pagamento", "select * from config_forma_pagamento limit 5");

  return amostras;
}

function tabelaParecerelevante(nomeTabela) {
  const nome = nomeTabela.toLowerCase();
  return PALAVRAS_CHAVE.some((palavra) => nome.includes(palavra));
}

function formatarLogTexto(tabelas, amostras, dadosConexao) {
  const linhas = [];
  const agora = new Date().toISOString();

  linhas.push(`Estrutura do banco "${dadosConexao.database}" (${dadosConexao.host}) — gerado em ${agora}`);
  linhas.push(`Total de tabelas encontradas: ${tabelas.length}`);
  linhas.push("(contagem de linhas é aproximada, baseada em estatística do Postgres — pode aparecer 0 em bancos recém-criados/sem ANALYZE recente)");
  linhas.push("");

  const relevantes = tabelas.filter((t) => tabelaParecerelevante(t.nome)).map((t) => t.nome);
  if (relevantes.length > 0) {
    linhas.push("Tabelas que provavelmente interessam (nome bate com venda/item/pagamento/estoque/produto/cliente/fornecedor/loja):");
    linhas.push(`  ${relevantes.join(", ")}`);
    linhas.push("");
  }

  if (Object.keys(amostras).length > 0) {
    linhas.push("--- Amostras de dados (contexto extra pra tirar dúvidas específicas) ---");
    for (const [chave, linhasAmostra] of Object.entries(amostras)) {
      linhas.push(`  ${chave}:`);
      if (linhasAmostra.length === 0) {
        linhas.push("    (nenhuma linha)");
      }
      for (const linha of linhasAmostra) {
        linhas.push(`    ${JSON.stringify(linha)}`);
      }
    }
    linhas.push("");
  }

  linhas.push("=".repeat(70));
  linhas.push("");

  for (const tabela of tabelas) {
    const marcador = tabelaParecerelevante(tabela.nome) ? " ★" : "";
    linhas.push(`Tabela: ${tabela.nome}${marcador} (≈${tabela.linhasAprox ?? "?"} linhas)`);
    for (const coluna of tabela.colunas) {
      const nulo = coluna.nullable ? "nullable" : "not null";
      const padrao = coluna.padrao ? `default ${coluna.padrao}` : "";
      linhas.push(`  ${coluna.nome.padEnd(30)} ${coluna.tipo.padEnd(20)} ${nulo.padEnd(10)} ${padrao}`.trimEnd());
    }
    linhas.push("");
  }

  return linhas.join("\n");
}

/**
 * Roda a introspecção e já salva o resultado em disco (texto legível + JSON
 * bruto), em <diretorio-do-agente>/logs/. Devolve o texto e o caminho salvo.
 */
async function gerarLogEstrutura(dadosConexao) {
  const { tabelas, amostras } = await inspecionarEsquema(dadosConexao);
  const texto = formatarLogTexto(tabelas, amostras, dadosConexao);

  const pastaLogs = path.join(obterDiretorioBase(), "logs");
  fs.mkdirSync(pastaLogs, { recursive: true });

  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const caminhoTexto = path.join(pastaLogs, `estrutura-banco-${carimbo}.txt`);
  const caminhoJson = path.join(pastaLogs, `estrutura-banco-${carimbo}.json`);

  fs.writeFileSync(caminhoTexto, texto);
  fs.writeFileSync(caminhoJson, JSON.stringify({ tabelas, amostras }, null, 2));

  return { texto, caminhoTexto, caminhoJson, totalTabelas: tabelas.length };
}

module.exports = { gerarLogEstrutura };
