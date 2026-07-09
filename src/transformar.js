const { v5: uuidv5 } = require("uuid");
const { carregarConfig } = require("./config");

// Namespace fixo só pra gerar UUIDs determinísticos a partir do id da venda de
// origem: rodar o agente de novo sobre a mesma venda sempre gera o mesmo uuid,
// e a API do Ferro Cianorte já ignora uuids repetidos (idempotência).
const NAMESPACE_LINKPRO = "5f2f2f5e-3d0a-4a8a-9b8a-2f6a4c6f9f10";

/**
 * Converte uma venda lida do Postgres externo (com itens/pagamentos brutos)
 * no formato esperado por POST /api/vendas/sync. Retorna null se a loja de
 * origem não tiver mapeamento, ou se nenhum item pôde ser resolvido (produto
 * sem correspondência por código de barras).
 */
function transformarVenda(vendaExterna, mapaProdutosPorCodigoBarras, aviso) {
  const config = carregarConfig();

  const lojaId = config.mapaLojas[String(vendaExterna.lojaExterna)];
  if (!lojaId) {
    aviso(
      `Venda externa #${vendaExterna.id}: loja "${vendaExterna.lojaExterna}" sem mapeamento em MAPA_LOJAS, venda ignorada. Adicione essa loja na janela de configuração.`,
    );
    return null;
  }

  const itens = [];

  for (const item of vendaExterna.itens) {
    const produtoId = mapaProdutosPorCodigoBarras.get(item.codigo_barras);

    if (!produtoId) {
      aviso(
        `Venda externa #${vendaExterna.id}: produto com código de barras "${item.codigo_barras}" não encontrado no Ferro Cianorte, item ignorado.`,
      );
      continue;
    }

    itens.push({
      produto_id: produtoId,
      quantidade: Number(item.quantidade),
      preco_unitario: Number(item.preco_unitario),
    });
  }

  if (itens.length === 0) {
    aviso(`Venda externa #${vendaExterna.id}: nenhum item pôde ser mapeado, venda ignorada.`);
    return null;
  }

  const pagamentos = vendaExterna.pagamentos.map((pagamento) => {
    const forma = config.mapaFormasPagamento[pagamento.forma_pagamento];
    if (!forma) {
      aviso(
        `Venda externa #${vendaExterna.id}: forma de pagamento "${pagamento.forma_pagamento}" sem mapeamento em MAPA_FORMAS_PAGAMENTO, usando "dinheiro" como fallback.`,
      );
    }
    return {
      forma_pagamento: forma ?? "dinheiro",
      valor: Number(pagamento.valor),
    };
  });

  if (pagamentos.length === 0) {
    // Sem forma de pagamento explícita na origem: assume à vista em dinheiro
    // pelo valor total dos itens, só pra não perder a venda.
    const total = itens.reduce((soma, item) => soma + item.quantidade * item.preco_unitario, 0);
    pagamentos.push({ forma_pagamento: "dinheiro", valor: total });
  }

  return {
    uuid: uuidv5(String(vendaExterna.id), NAMESPACE_LINKPRO),
    loja_id: lojaId,
    itens,
    pagamentos,
  };
}

module.exports = { transformarVenda };
