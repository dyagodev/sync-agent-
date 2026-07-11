const { exec } = require("node:child_process");
const { carregarConfig, estaConfigurado, itensFaltando } = require("./config");
const { lerUltimoIdProcessado, salvarUltimoIdProcessado } = require("./checkpoint");
const { autenticar, garantirProduto, sincronizarVendas } = require("./ferroCianorteApi");
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

  // Sequencial (não Promise.all) de propósito: cadastro automático de
  // produto novo precisa que a venda anterior já tenha atualizado o mapa
  // em memória antes da próxima rodar, senão duas vendas com o mesmo
  // produto novo tentariam cadastrar o mesmo código interno em paralelo.
  const vendasTransformadas = [];
  for (const venda of vendasExternas) {
    const transformada = await transformarVenda(venda, garantirProduto, log);
    if (transformada) vendasTransformadas.push(transformada);
  }

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

let sincronizacaoIniciada = false;

/**
 * Chamada tanto na subida do processo quanto logo depois de salvar a
 * configuração pela janela do navegador — assim salvar já basta pra começar
 * a sincronizar, sem precisar fechar e abrir o agente de novo (isso já
 * causou confusão, parecia que a configuração "não salvava").
 */
async function tentarIniciarSincronizacao() {
  if (sincronizacaoIniciada) return;
  if (!estaConfigurado(carregarConfig())) return;

  sincronizacaoIniciada = true;
  try {
    await iniciarSincronizacao();
  } catch (erro) {
    sincronizacaoIniciada = false;
    log("Não foi possível iniciar a sincronização:", erro.message);
  }
}

async function iniciar() {
  const { configUiPort } = carregarConfig();
  iniciarWebUi(log, () => tentarIniciarSincronizacao());

  const configAtual = carregarConfig();
  if (estaConfigurado(configAtual)) {
    await tentarIniciarSincronizacao();
  } else {
    log("Configuração incompleta. Falta:");
    for (const item of itensFaltando(configAtual)) log(`  - ${item}`);
    log("A sincronização começa sozinha assim que a configuração for salva completa.");
    abrirNavegador(`http://localhost:${configUiPort}`);
  }
}

iniciar().catch((erro) => {
  console.error("Falha fatal ao iniciar o agente:", erro);
  process.exit(1);
});
