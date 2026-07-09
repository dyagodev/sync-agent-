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
 * Diz se já dá pra rodar a sincronização de verdade (todos os campos
 * obrigatórios preenchidos e as 3 queries presentes).
 */
function estaConfigurado(config) {
  return Boolean(
    config.source.host &&
      config.source.database &&
      config.source.user &&
      config.api.baseUrl &&
      config.api.email &&
      config.api.password &&
      Object.keys(config.mapaLojas).length > 0 &&
      config.queries.vendas &&
      config.queries.itens &&
      config.queries.pagamentos,
  );
}

module.exports = { carregarConfig, estaConfigurado };
