const fs = require("node:fs");
const { carregarConfig } = require("./config");

function lerCheckpoint() {
  const { checkpointFile } = carregarConfig();
  if (!fs.existsSync(checkpointFile)) {
    return { ultimoIdProcessado: 0, ultimaAtualizacaoEstoque: null, ultimoIdEstoque: 0 };
  }
  const conteudo = JSON.parse(fs.readFileSync(checkpointFile, "utf-8"));
  return {
    ultimoIdProcessado: conteudo.ultimoIdProcessado ?? 0,
    ultimaAtualizacaoEstoque: conteudo.ultimaAtualizacaoEstoque ?? null,
    ultimoIdEstoque: conteudo.ultimoIdEstoque ?? 0,
  };
}

function escreverCheckpoint(atualizacoes) {
  const { checkpointFile } = carregarConfig();
  const atual = lerCheckpoint();
  const novo = { ...atual, ...atualizacoes };
  fs.writeFileSync(checkpointFile, JSON.stringify(novo, null, 2));
}

function lerUltimoIdProcessado() {
  return lerCheckpoint().ultimoIdProcessado;
}

function salvarUltimoIdProcessado(id) {
  escreverCheckpoint({ ultimoIdProcessado: id });
}

/**
 * Cursor composto (timestamp, id): contagem de inventário ou entrada de
 * mercadoria em lote grava várias linhas de log com o MESMO timestamp
 * exato — usar só o timestamp faria quem empata no instante do checkpoint
 * ficar de fora pra sempre (comparação "maior que" exclui o próprio
 * instante do último já processado). O par nunca empata de verdade.
 */
function lerCursorEstoque() {
  const checkpoint = lerCheckpoint();
  return {
    // "Época 0" na primeira execução: traz o estoque inteiro na primeira rodada.
    // Formato de texto puro (sem Date/ISOString) de propósito — ver nota em
    // sourceDb.js sobre por que timestamps são tratados como string bruta.
    ultimaAtualizacaoEstoque: checkpoint.ultimaAtualizacaoEstoque ?? "1970-01-01 00:00:00",
    ultimoIdEstoque: checkpoint.ultimoIdEstoque,
  };
}

function salvarCursorEstoque(dataHora, id) {
  escreverCheckpoint({ ultimaAtualizacaoEstoque: dataHora, ultimoIdEstoque: id });
}

module.exports = {
  lerUltimoIdProcessado,
  salvarUltimoIdProcessado,
  lerCursorEstoque,
  salvarCursorEstoque,
};
