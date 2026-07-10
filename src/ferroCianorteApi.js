const { carregarConfig } = require("./config");

let token = null;
let mapaProdutosPorCodigoInterno = null;

async function chamar(caminho, options = {}) {
  const { api } = carregarConfig();
  const resposta = await fetch(`${api.baseUrl}/${caminho}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!resposta.ok) {
    const corpo = await resposta.text();
    throw new Error(`${options.method ?? "GET"} ${caminho} falhou (${resposta.status}): ${corpo}`);
  }

  return resposta.json();
}

async function autenticar() {
  const { api } = carregarConfig();
  const data = await chamar("login", {
    method: "POST",
    body: JSON.stringify({
      email: api.email,
      password: api.password,
      device_name: "sync-agent-linkpro",
    }),
  });
  token = data.token;
}

/**
 * Carrega (uma vez) o catálogo de produtos e monta um mapa código interno -> produto_id,
 * usado para traduzir os itens vindos do Postgres externo. O código interno
 * (etiqueta que a própria loja gera) é mais confiável que o código de
 * barras de fábrica, que muita peça solta de ferragem não tem. Não filtra
 * por loja: o cadastro de produto é único no Ferro Cianorte, só o estoque é
 * por loja.
 */
async function carregarMapaProdutos({ forcar = false } = {}) {
  if (mapaProdutosPorCodigoInterno && !forcar) {
    return mapaProdutosPorCodigoInterno;
  }

  const produtos = await chamar("produtos");
  mapaProdutosPorCodigoInterno = new Map(
    produtos.filter((produto) => produto.codigo_interno).map((produto) => [produto.codigo_interno, produto.id]),
  );
  return mapaProdutosPorCodigoInterno;
}

/**
 * Lista as lojas cadastradas no Ferro Cianorte — usado só pela janela de
 * configuração, como referência pra preencher o mapeamento de lojas.
 * Exige que o usuário de integração seja admin (rota restrita a admin).
 */
async function listarLojas() {
  if (!token) {
    await autenticar();
  }
  return chamar("lojas");
}

async function sincronizarVendas(vendas) {
  if (vendas.length === 0) return { resultados: [] };
  return chamar("vendas/sync", {
    method: "POST",
    body: JSON.stringify({ vendas }),
  });
}

/**
 * Define (sobrescreve) a quantidade em estoque de um produto numa loja —
 * usado pra corrigir ajustes feitos sem venda no Link Pro (contagem manual,
 * balança, entrada de mercadoria), evitando furo entre os dois sistemas.
 */
async function definirEstoque(produtoId, lojaId, quantidade) {
  return chamar(`produtos/${produtoId}/estoque`, {
    method: "POST",
    body: JSON.stringify({ loja_id: lojaId, quantidade }),
  });
}

module.exports = { autenticar, carregarMapaProdutos, listarLojas, sincronizarVendas, definirEstoque };
