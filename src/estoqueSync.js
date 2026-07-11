const { carregarConfig } = require("./config");
const { lerCursorEstoque, salvarCursorEstoque } = require("./checkpoint");
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

  const { ultimaAtualizacaoEstoque: desde, ultimoIdEstoque } = lerCursorEstoque();
  const registros = await buscarEstoqueAtualizado(desde, ultimoIdEstoque);

  if (registros.length === 0) {
    return;
  }

  log(`${registros.length} registro(s) de estoque atualizado(s) no Link Pro, aplicando...`);

  const mapaProdutos = await carregarMapaProdutos();

  for (const registro of registros) {
    const lojaId = mapaLojas[String(registro.loja_externa)];
    if (!lojaId) {
      log(
        `  Estoque: loja "${registro.loja_externa}" sem mapeamento em MAPA_LOJAS, ajuste ignorado (produto ${registro.codigo_interno}).`,
      );
      continue;
    }

    const produtoId = mapaProdutos.get(registro.codigo_interno);
    if (!produtoId) {
      log(
        `  Estoque: produto com código interno "${registro.codigo_interno}" não encontrado no Ferro Cianorte, ajuste ignorado.`,
      );
      continue;
    }

    // Mantém a quantidade exatamente como está no Link Pro, fração incluída
    // (produto vendido por peso/metro) — o Ferro Cianorte guarda estoque
    // como decimal.
    const quantidade = Number(registro.quantidade);
    await definirEstoque(produtoId, lojaId, quantidade);
    log(`  Estoque atualizado: produto ${registro.codigo_interno} na loja ${lojaId} -> ${quantidade}`);
  }

  // A query já devolve ordenado por (atualizado_em, id) crescente, então o
  // último registro do lote é o cursor mais alto processado até agora.
  const ultimoRegistro = registros[registros.length - 1];
  salvarCursorEstoque(ultimoRegistro.atualizado_em, ultimoRegistro.id);
}

module.exports = { sincronizarEstoque };
