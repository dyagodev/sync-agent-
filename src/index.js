const { exec } = require("node:child_process");
const { carregarConfig, estaConfigurado } = require("./config");
const { lerUltimoIdProcessado, salvarUltimoIdProcessado } = require("./checkpoint");
const { autenticar, carregarMapaProdutos, sincronizarVendas } = require("./ferroCianorteApi");
const { buscarVendasNovas } = require("./sourceDb");
const { transformarVenda } = require("./transformar");
const { sincronizarEstoque } = require("./estoqueSync");
const { iniciarWebUi } = require("./webUi");

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function abrirNavegador(url) {
  const comando = { win32: `start "" "${url}"`, darwin: `open "${url}"` }[process.platform] ?? `xdg-open "${url}"`;
  exec(comando, () => undefined);
}

async function processarLote() {
  const ultimoIdProcessado = lerUltimoIdProcessado();
  const vendasExternas = await buscarVendasNovas(ultimoIdProcessado);

  if (vendasExternas.length === 0) {
    log("Nenhuma venda nova.");
    return;
  }

  log(`${vendasExternas.length} venda(s) nova(s) encontrada(s), sincronizando...`);

  const mapaProdutos = await carregarMapaProdutos();
  const vendasTransformadas = vendasExternas
    .map((venda) => transformarVenda(venda, mapaProdutos, log))
    .filter((venda) => venda !== null);

  const resultado = await sincronizarVendas(vendasTransformadas);

  for (const item of resultado.resultados ?? []) {
    log(`  venda uuid=${item.uuid} -> ${item.status} (id local #${item.id})`);
  }

  const maiorIdDoLote = Math.max(...vendasExternas.map((v) => v.id));
  salvarUltimoIdProcessado(maiorIdDoLote);
  log(`Checkpoint atualizado para o id ${maiorIdDoLote}.`);
}

async function loopPrincipal() {
  try {
    await processarLote();
  } catch (erro) {
    log("Erro ao processar vendas:", erro.message);
  }

  try {
    await sincronizarEstoque(log);
  } catch (erro) {
    log("Erro ao sincronizar estoque:", erro.message);
  }

  setTimeout(loopPrincipal, carregarConfig().pollIntervalMs);
}

async function iniciarSincronizacao() {
  log("Autenticando no Ferro Cianorte...");
  await autenticar();
  const { mapaLojas, pollIntervalMs } = carregarConfig();
  const lojasMapeadas = Object.entries(mapaLojas)
    .map(([origem, destino]) => `${origem}→${destino}`)
    .join(", ");
  log(`Sincronização iniciada. Lojas mapeadas: ${lojasMapeadas}. Intervalo: ${pollIntervalMs}ms.`);
  await loopPrincipal();
}

async function iniciar() {
  const { configUiPort } = carregarConfig();
  iniciarWebUi(log);

  const config = carregarConfig();
  if (estaConfigurado(config)) {
    await iniciarSincronizacao();
  } else {
    log("Configuração incompleta. Abrindo a janela de configuração no navegador...");
    log("Depois de salvar, reinicie o agente (feche esta janela e abra o atalho de novo) para iniciar a sincronização.");
    abrirNavegador(`http://localhost:${configUiPort}`);
  }
}

iniciar().catch((erro) => {
  console.error("Falha fatal ao iniciar o agente:", erro);
  process.exit(1);
});
