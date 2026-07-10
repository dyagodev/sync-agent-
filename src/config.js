require("dotenv").config({ path: require("./envPath").ENV_PATH });
const fs = require("node:fs");
const path = require("node:path");
const { obterDiretorioBase } = require("./baseDir");

function lerQuery(nomeArquivo) {
  const caminho = path.join(obterDiretorioBase(), "queries", nomeArquivo);
  if (!fs.existsSync(caminho)) {
    return null;
  }
  return fs.readFileSync(caminho, "utf-8");
}

/**
 * Monta a config a partir do process.env atual. Chamada de novo a cada uso
 * (não é um singleton fixo) pra refletir mudanças salvas pela janela de
 * configuração sem precisar reiniciar o processo pra reler o .env.
 */
function carregarConfig() {
  return {
    source: {
      host: process.env.SOURCE_PG_HOST ?? "",
      port: Number(process.env.SOURCE_PG_PORT ?? 5432),
      database: process.env.SOURCE_PG_DATABASE ?? "",
      user: process.env.SOURCE_PG_USER ?? "",
      password: process.env.SOURCE_PG_PASSWORD ?? "",
      ssl: process.env.SOURCE_PG_SSL === "true",
    },
    api: {
      baseUrl: process.env.FERRO_CIANORTE_API_URL ?? "",
      email: process.env.FERRO_CIANORTE_EMAIL ?? "",
      password: process.env.FERRO_CIANORTE_PASSWORD ?? "",
    },
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS ?? 15000),
    checkpointFile: process.env.CHECKPOINT_FILE ?? path.join(obterDiretorioBase(), "checkpoint.json"),
    mapaFormasPagamento: JSON.parse(process.env.MAPA_FORMAS_PAGAMENTO || "{}"),
    // Mapeia o identificador de loja do Link Pro (chave, sempre string) pro
    // id da nossa loja (valor, number) — o Link Pro é multiloja, então cada
    // venda externa precisa dizer de qual loja ela veio.
    mapaLojas: Object.fromEntries(
      Object.entries(JSON.parse(process.env.MAPA_LOJAS || "{}")).map(([origem, destino]) => [
        origem,
        Number(destino),
      ]),
    ),
    configUiPort: Number(process.env.CONFIG_UI_PORT ?? 4848),
    queries: {
      vendas: lerQuery("vendas.sql"),
      itens: lerQuery("itens.sql"),
      pagamentos: lerQuery("pagamentos.sql"),
      // Opcional: sem esse arquivo, o agente só sincroniza vendas, não ajustes
      // de estoque feitos sem venda.
      estoque: lerQuery("estoque.sql"),
    },
  };
}

/**
 * Lista o que falta preencher/copiar pra sincronização poder começar —
 * usado tanto pra decidir se já dá pra rodar quanto pra mostrar na janela de
 * configuração exatamente o que falta (evita o usuário achar que "salvar
 * não fez nada" quando na real falta, por exemplo, copiar as queries).
 */
function itensFaltando(config) {
  const faltando = [];

  if (!config.source.host) faltando.push("Postgres de origem: Host");
  if (!config.source.database) faltando.push("Postgres de origem: Banco de dados");
  if (!config.source.user) faltando.push("Postgres de origem: Usuário");
  if (!config.api.baseUrl) faltando.push("API do Ferro Cianorte: URL da API");
  if (!config.api.email) faltando.push("API do Ferro Cianorte: E-mail");
  if (!config.api.password) faltando.push("API do Ferro Cianorte: Senha");
  if (Object.keys(config.mapaLojas).length === 0) faltando.push("Mapeamento de lojas");
  if (!config.queries.vendas) faltando.push("queries/vendas.sql (copie de vendas.sql.example e ajuste ao schema real)");
  if (!config.queries.itens) faltando.push("queries/itens.sql (copie de itens.sql.example e ajuste ao schema real)");
  if (!config.queries.pagamentos) faltando.push("queries/pagamentos.sql (copie de pagamentos.sql.example e ajuste ao schema real)");

  return faltando;
}

/**
 * Diz se já dá pra rodar a sincronização de verdade (todos os campos
 * obrigatórios preenchidos e as 3 queries presentes).
 */
function estaConfigurado(config) {
  return itensFaltando(config).length === 0;
}

module.exports = { carregarConfig, estaConfigurado, itensFaltando };
