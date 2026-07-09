const path = require("node:path");
const { obterDiretorioBase } = require("./baseDir");

const ENV_PATH = path.join(obterDiretorioBase(), ".env");

module.exports = { ENV_PATH };
