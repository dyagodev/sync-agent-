const { carregarConfig } = require("./config");
const { lerUltimaAtualizacaoEstoque, salvarUltimaAtualizacaoEstoque } = require("./checkpoint");
const { carregarMapaProdutos, definirEstoque } = require("./ferroCianorteApi");
const { buscarEstoqueAtualizado } = require("./sourceDb");

/**
 * Verifica se algum estoque mudou no Link Pro desde a última checagem (venda
 * OU ajuste manual, tanto faz — a query já traz o valor atual) e sobrescreve
 * a quantidade correspondente no Ferro Cianorte, produto a produto, pra nunca
 * ficar com furo entre os dois sistemas.
 */
async function sincronizarEstoque(log) {
  const { queries, mapaLojas } = carregarConfig();
  if (!queries.estoque) {
    return;
  }

  const desde = lerUltimaAtualizacaoEstoque();
  const registros = await buscarEstoqueAtualizado(desde);

  if (registros.length === 0) {
    return;
  }

  log(`${registros.length} registro(s) de estoque atualizado(s) no Link Pro, aplicando...`);

  const mapaProdutos = await carregarMapaProdutos();

  for (const registro of registros) {
    const lojaId = mapaLojas[String(registro.loja_externa)];
    if (!lojaId) {
      log(
        `  Estoque: loja "${registro.loja_externa}" sem mapeamento em MAPA_LOJAS, ajuste ignorado (produto ${registro.codigo_barras}).`,
      );
      continue;
    }

    const produtoId = mapaProdutos.get(registro.codigo_barras);
    if (!produtoId) {
      log(
        `  Estoque: produto com código de barras "${registro.codigo_barras}" não encontrado no Ferro Cianorte, ajuste ignorado.`,
      );
      continue;
    }

    await definirEstoque(produtoId, lojaId, Number(registro.quantidade));
    log(`  Estoque atualizado: produto ${registro.codigo_barras} na loja ${lojaId} -> ${registro.quantidade}`);
  }

  // Comparação de string funciona porque o Postgres sempre devolve
  // timestamp em formato "YYYY-MM-DD HH:MI:SS[.ffffff]" (data e hora com
  // largura fixa) — ver nota em sourceDb.js sobre tratar isso como texto puro.
  const maiorData = registros.reduce(
    (maior, registro) => (registro.atualizado_em > maior ? registro.atualizado_em : maior),
    desde,
  );
  salvarUltimaAtualizacaoEstoque(maiorData);
}

module.exports = { sincronizarEstoque };
