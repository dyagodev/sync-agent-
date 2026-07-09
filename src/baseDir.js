const path = require("node:path");

/**
 * Diretório onde o agente deve ler/escrever arquivos externos (queries/,
 * .env, checkpoint.json). Quando empacotado como .exe (via pkg), __dirname
 * aponta pra dentro do snapshot virtual do executável, não pra disco de
 * verdade — por isso usamos a pasta do próprio .exe nesse caso. Rodando via
 * `node src/index.js` normalmente, usa a raiz do projeto (uma pasta acima de src/).
 */
function obterDiretorioBase() {
  if (process.pkg) {
    return path.dirname(process.execPath);
  }
  return path.join(__dirname, "..");
}

module.exports = { obterDiretorioBase };
