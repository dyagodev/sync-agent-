const fs = require("node:fs");
const { carregarConfig } = require("./config");

function lerCheckpoint() {
  const { checkpointFile } = carregarConfig();
  if (!fs.existsSync(checkpointFile)) {
    return { ultimoIdProcessado: 0, ultimaAtualizacaoEstoque: null };
  }
  const conteudo = JSON.parse(fs.readFileSync(checkpointFile, "utf-8"));
  return {
    ultimoIdProcessado: conteudo.ultimoIdProcessado ?? 0,
    ultimaAtualizacaoEstoque: conteudo.ultimaAtualizacaoEstoque ?? null,
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

function lerUltimaAtualizacaoEstoque() {
  // "Época 0" na primeira execução: traz o estoque inteiro na primeira rodada.
  // Formato de texto puro (sem Date/ISOString) de propósito — ver nota em
  // sourceDb.js sobre por que timestamps são tratados como string bruta.
  return lerCheckpoint().ultimaAtualizacaoEstoque ?? "1970-01-01 00:00:00";
}

function salvarUltimaAtualizacaoEstoque(dataHora) {
  escreverCheckpoint({ ultimaAtualizacaoEstoque: dataHora });
}

module.exports = {
  lerUltimoIdProcessado,
  salvarUltimoIdProcessado,
  lerUltimaAtualizacaoEstoque,
  salvarUltimaAtualizacaoEstoque,
};
