const { carregarConfig } = require("./config");

const TTL_MAPA_PRODUTOS_MS = 5 * 60 * 1000;

let token = null;
let mapaProdutosPorCodigoInterno = null;
let mapaProdutosCarregadoEm = 0;

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
 * Carrega o catálogo de produtos e monta um mapa código interno -> produto_id,
 * usado para traduzir os itens vindos do Postgres externo. O código interno
 * (etiqueta que a própria loja gera) é mais confiável que o código de
 * barras de fábrica, que muita peça solta de ferragem não tem. Não filtra
 * por loja: o cadastro de produto é único no Ferro Cianorte, só o estoque é
 * por loja.
 *
 * Fica em cache por até TTL_MAPA_PRODUTOS_MS — sem isso, produto cadastrado
 * ou editado no Ferro Cianorte depois que o agente subiu nunca era
 * encontrado, já que o processo roda dias/semanas sem reiniciar (causava
 * "alguns produtos não atualizam o estoque").
 */
async function carregarMapaProdutos({ forcar = false } = {}) {
  const expirado = Date.now() - mapaProdutosCarregadoEm > TTL_MAPA_PRODUTOS_MS;
  if (mapaProdutosPorCodigoInterno && !forcar && !expirado) {
    return mapaProdutosPorCodigoInterno;
  }

  const produtos = await chamar("produtos");
  mapaProdutosPorCodigoInterno = new Map(
    produtos.filter((produto) => produto.codigo_interno).map((produto) => [produto.codigo_interno, produto.id]),
  );
  mapaProdutosCarregadoEm = Date.now();
  return mapaProdutosPorCodigoInterno;
}

/**
 * Cria um produto novo no Ferro Cianorte e já adiciona no mapa em memória
 * (evita esperar o próximo refresh do cache só pra achar o produto que
 * acabou de criar).
 */
async function criarProduto(dados) {
  const produto = await chamar("produtos", {
    method: "POST",
    body: JSON.stringify(dados),
  });

  if (mapaProdutosPorCodigoInterno && produto.codigo_interno) {
    mapaProdutosPorCodigoInterno.set(produto.codigo_interno, produto.id);
  }

  return produto;
}

/**
 * Resolve o produto_id de um código interno — se não existir ainda no
 * Ferro Cianorte, cadastra automaticamente com os dados vindos do Link Pro
 * (descrição, preço, unidade), em vez de só ignorar o item/ajuste de
 * estoque. Sem descrição não tem como cadastrar (campo obrigatório), nesse
 * caso continua ignorando e avisando.
 */
async function garantirProduto(codigoInterno, dadosOrigem, aviso) {
  const mapa = await carregarMapaProdutos();
  const existente = mapa.get(codigoInterno);
  if (existente) return existente;

  const descricao = String(dadosOrigem.descricao ?? "").trim();
  if (!descricao) {
    aviso(`Produto com código interno "${codigoInterno}" não encontrado e sem descrição pra cadastrar automaticamente.`);
    return null;
  }

  try {
    const precoCusto = Number(dadosOrigem.preco_custo) || 0;
    const precoVenda = Number(dadosOrigem.preco_venda_cadastro) || 0;
    const margem = precoCusto > 0 ? Math.round(((precoVenda - precoCusto) / precoCusto) * 10000) / 100 : 0;

    const produto = await criarProduto({
      codigo_interno: codigoInterno,
      codigo_barras: dadosOrigem.codigo_barras || null,
      descricao,
      unidade: dadosOrigem.unidade || "UN",
      preco_custo: precoCusto,
      margem_percentual: margem,
      preco_venda: precoVenda,
    });

    aviso(`Produto "${descricao}" (código interno "${codigoInterno}") cadastrado automaticamente no Ferro Cianorte.`);
    return produto.id;
  } catch (erro) {
    aviso(`Não foi possível cadastrar automaticamente o produto "${codigoInterno}": ${erro.message}`);
    return null;
  }
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

module.exports = {
  autenticar,
  carregarMapaProdutos,
  criarProduto,
  garantirProduto,
  listarLojas,
  sincronizarVendas,
  definirEstoque,
};
