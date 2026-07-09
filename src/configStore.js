const fs = require("node:fs");
const { ENV_PATH } = require("./envPath");

// Ordem em que os campos são escritos no .env (só estética/legibilidade do arquivo).
const CAMPOS = [
  "SOURCE_PG_HOST",
  "SOURCE_PG_PORT",
  "SOURCE_PG_DATABASE",
  "SOURCE_PG_USER",
  "SOURCE_PG_PASSWORD",
  "SOURCE_PG_SSL",
  "FERRO_CIANORTE_API_URL",
  "FERRO_CIANORTE_EMAIL",
  "FERRO_CIANORTE_PASSWORD",
  "POLL_INTERVAL_MS",
  "CHECKPOINT_FILE",
  "MAPA_FORMAS_PAGAMENTO",
  "MAPA_LOJAS",
  "CONFIG_UI_PORT",
];

/**
 * Lê o .env atual como um objeto simples { CHAVE: "valor" }. Não usa a lib
 * dotenv aqui de propósito: precisamos reescrever o arquivo inteiro quando o
 * usuário salva pela janela de configuração.
 */
function lerEnvSalvo() {
  if (!fs.existsSync(ENV_PATH)) {
    return {};
  }

  const valores = {};
  const conteudo = fs.readFileSync(ENV_PATH, "utf-8");

  for (const linha of conteudo.split("\n")) {
    const match = linha.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      valores[match[1]] = match[2];
    }
  }

  return valores;
}

/**
 * Mescla os novos valores com o que já existia no .env, reescreve o arquivo
 * e atualiza process.env em memória (pro carregarConfig() já pegar os novos
 * valores sem precisar reiniciar o processo pra reler o arquivo).
 */
function salvarEnv(novosValores) {
  const atual = lerEnvSalvo();
  const combinado = { ...atual, ...novosValores };

  const linhas = CAMPOS.filter((campo) => combinado[campo] !== undefined && combinado[campo] !== "").map(
    (campo) => `${campo}=${combinado[campo]}`,
  );

  fs.writeFileSync(ENV_PATH, linhas.join("\n") + "\n");

  for (const [chave, valor] of Object.entries(combinado)) {
    process.env[chave] = valor;
  }
}

module.exports = { lerEnvSalvo, salvarEnv };
