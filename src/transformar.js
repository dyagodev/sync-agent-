const { v5: uuidv5 } = require("uuid");
const { carregarConfig } = require("./config");

// Namespace fixo só pra gerar UUIDs determinísticos a partir do id da venda de
// origem: rodar o agente de novo sobre a mesma venda sempre gera o mesmo uuid,
// e a API do Ferro Cianorte já ignora uuids repetidos (idempotência).
const NAMESPACE_LINKPRO = "5f2f2f5e-3d0a-4a8a-9b8a-2f6a4c6f9f10";

// Ignora maiúsculas/minúsculas, espaços nas pontas e acentuação — "Cartão",
// "cartao" e "CARTÃO" devem casar com a mesma entrada do mapeamento.
function normalizar(texto) {
  return String(texto ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Converte uma venda lida do Postgres externo (com itens/pagamentos brutos)
 * no formato esperado por POST /api/vendas/sync. Retorna null se a loja de
 * origem não tiver mapeamento, ou se nenhum item pôde ser resolvido (produto
 * sem correspondência por código interno.
 */
function transformarVenda(vendaExterna, mapaProdutosPorCodigoInterno, aviso) {
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
    const produtoId = mapaProdutosPorCodigoInterno.get(item.codigo_interno);

    if (!produtoId) {
      aviso(
        `Venda externa #${vendaExterna.id}: produto com código interno "${item.codigo_interno}" não encontrado no Ferro Cianorte, item ignorado.`,
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

  // Comparação sem diferenciar maiúsculas/minúsculas nem espaços nas pontas —
  // "Pix", "pix" e "PIX" devem casar com a mesma entrada do mapeamento,
  // já que o Link Pro não é consistente na capitalização desse texto.
  const mapaFormasPagamentoNormalizado = new Map(
    Object.entries(config.mapaFormasPagamento).map(([origem, destino]) => [normalizar(origem), destino]),
  );

  const pagamentos = vendaExterna.pagamentos.map((pagamento) => {
    const forma = mapaFormasPagamentoNormalizado.get(normalizar(pagamento.forma_pagamento));
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

  const subtotalItens = itens.reduce((soma, item) => soma + item.quantidade * item.preco_unitario, 0);

  // negociacao_item_vendido não reflete desconto dado na tela de fechamento
  // da venda (só desconto por item) — o desconto real é a diferença entre a
  // soma bruta dos itens e o valor final que o Link Pro realmente registrou
  // (negociacao.valor_total_venda). Sem isso, uma venda com desconto no
  // fechamento sincronizava pelo valor cheio dos itens, maior que o total
  // de verdade.
  const valorTotalOrigem = Number(vendaExterna.valorTotal);
  const temValorTotalOrigem = Number.isFinite(valorTotalOrigem) && valorTotalOrigem > 0;
  const desconto = temValorTotalOrigem ? Math.max(0, subtotalItens - valorTotalOrigem) : 0;

  if (pagamentos.length === 0) {
    // Sem forma de pagamento explícita na origem: assume à vista em dinheiro
    // pelo valor real da venda (já descontado), só pra não perder a venda.
    pagamentos.push({
      forma_pagamento: "dinheiro",
      valor: temValorTotalOrigem ? valorTotalOrigem : subtotalItens,
    });
  }

  return {
    uuid: uuidv5(String(vendaExterna.id), NAMESPACE_LINKPRO),
    loja_id: lojaId,
    data_hora: vendaExterna.dataHora,
    desconto,
    itens,
    pagamentos,
  };
}

module.exports = { transformarVenda };
