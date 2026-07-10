const http = require("node:http");
const { carregarConfig, estaConfigurado } = require("./config");
const { lerEnvSalvo, salvarEnv } = require("./configStore");
const { listarLojas } = require("./ferroCianorteApi");
const { testarConexao, buscarLojasLinkPro } = require("./sourceDb");
const { gerarLogEstrutura } = require("./schemaInspector");

const FORMAS_PAGAMENTO_FERRO_CIANORTE = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "cartao", rotulo: "Cartão" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "boleto", rotulo: "Boleto" },
  { valor: "cheque", rotulo: "Cheque" },
  { valor: "crediario", rotulo: "Crediário" },
  { valor: "a_prazo", rotulo: "A Prazo" },
  { valor: "outros", rotulo: "Outros" },
];

function escaparHtml(valor = "") {
  return String(valor).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function campo(rotulo, name, valor, { tipo = "text", ajuda = "" } = {}) {
  return `
    <label>
      <span>${rotulo}</span>
      <input type="${tipo}" name="${name}" value="${escaparHtml(valor)}" />
      ${ajuda ? `<small>${ajuda}</small>` : ""}
    </label>`;
}

function opcoesLojasFerroCianorte(lojasFerroCianorte, selecionadoId) {
  const opcoesVazias = `<option value="">selecione a loja...</option>`;
  const opcoes = lojasFerroCianorte
    .map((loja) => `<option value="${loja.id}" ${String(loja.id) === String(selecionadoId) ? "selected" : ""}>${escaparHtml(loja.nome)}</option>`)
    .join("");
  return opcoesVazias + opcoes;
}

function linhaMapaLoja(origem = "", destino = "", lojasFerroCianorte = []) {
  return `
    <div class="linha-loja">
      <input type="text" name="loja_origem[]" value="${escaparHtml(origem)}" placeholder="código/id da loja no Link Pro" />
      <span>→</span>
      <select name="loja_destino[]">${opcoesLojasFerroCianorte(lojasFerroCianorte, destino)}</select>
      <button type="button" class="remover" onclick="this.parentElement.remove()">✕</button>
    </div>`;
}

async function referenciaLojas(lojasFerroCianorte) {
  if (lojasFerroCianorte.length === 0) {
    return '<small>Não foi possível carregar suas lojas agora (salve a API/credenciais e recarregue esta página) — o campo abaixo vai pedir o id manualmente.</small>';
  }
  return `<small>Suas lojas cadastradas: ${lojasFerroCianorte.map((l) => `#${l.id} ${escaparHtml(l.nome)}`).join(" · ")}</small>`;
}

async function paginaHtml({ salvo = false } = {}) {
  const env = lerEnvSalvo();
  const config = carregarConfig();
  const configurado = estaConfigurado(config);

  // MAPA_FORMAS_PAGAMENTO guarda { "codigoDoLinkPro": "nossoEnum" }; a UI
  // trabalha ao contrário (um input de código-fonte por forma nossa), então
  // invertemos aqui só pra popular os campos.
  const codigoPorForma = {};
  for (const [codigoOrigem, formaNossa] of Object.entries(config.mapaFormasPagamento)) {
    codigoPorForma[formaNossa] = codigoOrigem;
  }

  const lojasFerroCianorte = await listarLojas().catch(() => []);
  const linhasLojas = Object.entries(config.mapaLojas);

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Configuração — Agente Link Pro → Ferro Cianorte</title>
  <style>
    body { font-family: -apple-system, Arial, sans-serif; max-width: 720px; margin: 32px auto; padding: 0 16px; color: #1e293b; }
    h1 { font-size: 20px; }
    h2 { font-size: 15px; margin-top: 32px; color: #334155; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    label { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; font-size: 13px; color: #475569; }
    input, select { padding: 8px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14px; color: #0f172a; }
    small { color: #94a3b8; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 16px; }
    .linha-pagamento { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .linha-pagamento span { width: 90px; font-size: 13px; }
    .linha-pagamento input { flex: 1; }
    .linha-loja { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .linha-loja input { flex: 1; }
    .linha-loja span { color: #94a3b8; }
    .remover { background: none; color: #ef4444; padding: 4px 8px; margin-top: 0; font-size: 16px; line-height: 1; }
    button { background: #2563eb; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; cursor: pointer; margin-top: 20px; }
    button.secundario { background: #f1f5f9; color: #334155; margin-left: 8px; }
    button.adicionar { background: #f1f5f9; color: #334155; padding: 6px 12px; font-size: 13px; margin-top: 4px; }
    .status { padding: 10px 14px; border-radius: 6px; font-size: 14px; margin-bottom: 16px; }
    .status.ok { background: #dcfce7; color: #166534; }
    .status.alerta { background: #fef9c3; color: #854d0e; }
    #resultado-teste { font-size: 13px; margin-top: 8px; }
    #resultado-schema { font-size: 13px; margin-top: 8px; }
    #texto-schema { max-height: 320px; overflow: auto; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 6px; font-size: 12px; margin-top: 8px; white-space: pre; }
    button.copiar { background: #f1f5f9; color: #334155; padding: 4px 10px; font-size: 12px; margin: 8px 0 0; }
  </style>
</head>
<body>
  <h1>Agente de sincronização — Link Pro → Ferro Cianorte</h1>

  ${salvo ? '<div class="status ok">Configuração salva. Reinicie o agente (Ctrl+C e rode de novo) para aplicar.</div>' : ""}
  ${
    !configurado
      ? '<div class="status alerta">Configuração incompleta — a sincronização ainda não está rodando. Preencha os campos abaixo e salve.</div>'
      : ""
  }

  <form method="POST" action="/salvar">
    <h2>Postgres de origem (Link Pro)</h2>
    <div class="grid">
      ${campo("Host", "SOURCE_PG_HOST", env.SOURCE_PG_HOST)}
      ${campo("Porta", "SOURCE_PG_PORT", env.SOURCE_PG_PORT || "5432")}
      ${campo("Banco de dados", "SOURCE_PG_DATABASE", env.SOURCE_PG_DATABASE)}
      ${campo("Usuário", "SOURCE_PG_USER", env.SOURCE_PG_USER)}
      ${campo("Senha", "SOURCE_PG_PASSWORD", env.SOURCE_PG_PASSWORD, { tipo: "password" })}
      <label>
        <span>Usar SSL?</span>
        <select name="SOURCE_PG_SSL">
          <option value="false" ${env.SOURCE_PG_SSL !== "true" ? "selected" : ""}>Não</option>
          <option value="true" ${env.SOURCE_PG_SSL === "true" ? "selected" : ""}>Sim</option>
        </select>
      </label>
    </div>
    <button type="button" class="secundario" onclick="testarPostgres()">Testar conexão</button>
    <button type="button" class="secundario" onclick="gerarLogEstrutura()">Gerar log da estrutura do banco</button>
    <div id="resultado-teste"></div>
    <div id="resultado-schema"></div>
    <pre id="texto-schema" style="display:none;"></pre>

    <h2>API do Ferro Cianorte</h2>
    <div class="grid">
      ${campo("URL da API", "FERRO_CIANORTE_API_URL", env.FERRO_CIANORTE_API_URL || "http://127.0.0.1:8000/api")}
      ${campo("E-mail do usuário de integração", "FERRO_CIANORTE_EMAIL", env.FERRO_CIANORTE_EMAIL)}
      ${campo("Senha", "FERRO_CIANORTE_PASSWORD", env.FERRO_CIANORTE_PASSWORD, { tipo: "password" })}
    </div>
    <small>
      Crie esse usuário em Ferro Cianorte → Administrativo → Funcionários, como <strong>Admin</strong>
      (precisa ser admin porque o Link Pro é multiloja e cada venda pode ir pra uma loja diferente).
    </small>

    <h2>Comportamento</h2>
    <div class="grid">
      ${campo("Intervalo entre verificações (ms)", "POLL_INTERVAL_MS", env.POLL_INTERVAL_MS || "15000")}
      ${campo("Porta desta janela de configuração", "CONFIG_UI_PORT", env.CONFIG_UI_PORT || "4848")}
    </div>

    <h2>Mapeamento de lojas</h2>
    ${await referenciaLojas(lojasFerroCianorte)}
    <br /><br />
    <small>O Link Pro é multiloja: diga qual id/código de loja ele usa pra cada uma das nossas lojas.</small>
    <div id="linhas-lojas">
      ${linhasLojas.length > 0 ? linhasLojas.map(([origem, destino]) => linhaMapaLoja(origem, destino, lojasFerroCianorte)).join("") : linhaMapaLoja("", "", lojasFerroCianorte)}
    </div>
    <button type="button" class="adicionar" onclick="adicionarLinhaLoja()">+ adicionar loja</button>
    <button type="button" class="secundario" onclick="buscarLojasLinkPro()">Buscar lojas no Link Pro</button>
    <div id="resultado-lojas-linkpro"></div>
    <div id="lojas-linkpro-encontradas"></div>
    <small>
      Essa busca lê <code>dados_empresa</code> (a loja desta conexão, marcada com ★) e
      <code>dados_empresa_loja</code> (as outras lojas conhecidas) — exatamente o que aparece
      na tela "Dados da Empresa → Lojas" do próprio Link Pro. A loja marcada com ★ é o código
      real usado nas queries (<code>dados_empresa.codigo_loja</code>), então normalmente é só
      clicar nela e escolher a loja correspondente do Ferro Cianorte no select ao lado.
    </small>

    <h2>Formas de pagamento</h2>
    <small>Qual código o Link Pro usa para cada forma de pagamento nossa (deixe em branco se não existir).</small><br /><br />
    ${FORMAS_PAGAMENTO_FERRO_CIANORTE.map(
      (forma) => `
      <div class="linha-pagamento">
        <span>${forma.rotulo}</span>
        <input type="text" name="forma_${forma.valor}" value="${escaparHtml(codigoPorForma[forma.valor] ?? "")}" placeholder="ex: D" />
      </div>`,
    ).join("")}

    <button type="submit">Salvar configuração</button>
  </form>

  <script>
    const LOJAS_FERRO_CIANORTE = ${JSON.stringify(lojasFerroCianorte).replace(/</g, "\\u003c")};

    function opcoesLojasHtml(selecionadoId) {
      let html = '<option value="">selecione a loja...</option>';
      for (const loja of LOJAS_FERRO_CIANORTE) {
        const selecionado = String(loja.id) === String(selecionadoId) ? "selected" : "";
        html += '<option value="' + loja.id + '" ' + selecionado + '>' + loja.nome + '</option>';
      }
      return html;
    }

    function adicionarLinhaLoja(origemPreenchida) {
      const container = document.getElementById("linhas-lojas");
      const div = document.createElement("div");
      div.className = "linha-loja";
      div.innerHTML = '<input type="text" name="loja_origem[]" placeholder="código/id da loja no Link Pro" value="' + (origemPreenchida || "") + '" />' +
        '<span>→</span>' +
        '<select name="loja_destino[]">' + opcoesLojasHtml() + '</select>' +
        '<button type="button" class="remover" onclick="this.parentElement.remove()">✕</button>';
      container.appendChild(div);
      return div;
    }

    async function buscarLojasLinkPro() {
      const form = document.querySelector("form");
      const dados = Object.fromEntries(new FormData(form).entries());
      const resultado = document.getElementById("resultado-lojas-linkpro");
      const areaEncontradas = document.getElementById("lojas-linkpro-encontradas");
      resultado.textContent = "Buscando lojas no Link Pro...";
      resultado.style.color = "#475569";
      areaEncontradas.innerHTML = "";

      try {
        const resposta = await fetch("/lojas-link-pro", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: dados.SOURCE_PG_HOST,
            port: dados.SOURCE_PG_PORT,
            database: dados.SOURCE_PG_DATABASE,
            user: dados.SOURCE_PG_USER,
            password: dados.SOURCE_PG_PASSWORD,
            ssl: dados.SOURCE_PG_SSL === "true",
          }),
        });
        const corpo = await resposta.json();

        if (!corpo.ok) {
          resultado.textContent = "✗ " + corpo.erro;
          resultado.style.color = "#b91c1c";
          return;
        }

        if (corpo.lojas.length === 0) {
          resultado.textContent = "Não achei a tabela de lojas nesse Link Pro (ou ela está vazia) — preencha manualmente.";
          resultado.style.color = "#854d0e";
          return;
        }

        resultado.textContent = corpo.lojas.length + " loja(s) encontrada(s) (★ = a loja desta conexão). Clique pra adicionar ao mapeamento:";
        resultado.style.color = "#166534";

        for (const loja of corpo.lojas) {
          const botao = document.createElement("button");
          botao.type = "button";
          botao.className = "adicionar";
          botao.style.marginRight = "6px";
          botao.textContent = (loja.provavelEsta ? "★ " : "") + loja.nome + " (id " + loja.id + ")";
          botao.onclick = () => adicionarLinhaLoja(loja.id);
          areaEncontradas.appendChild(botao);
        }
      } catch (erro) {
        resultado.textContent = "✗ " + erro.message;
        resultado.style.color = "#b91c1c";
      }
    }

    async function testarPostgres() {
      const form = document.querySelector("form");
      const dados = Object.fromEntries(new FormData(form).entries());
      const resultado = document.getElementById("resultado-teste");
      resultado.textContent = "Testando...";
      resultado.style.color = "#475569";

      try {
        const resposta = await fetch("/testar-postgres", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: dados.SOURCE_PG_HOST,
            port: dados.SOURCE_PG_PORT,
            database: dados.SOURCE_PG_DATABASE,
            user: dados.SOURCE_PG_USER,
            password: dados.SOURCE_PG_PASSWORD,
            ssl: dados.SOURCE_PG_SSL === "true",
          }),
        });
        const corpo = await resposta.json();
        resultado.textContent = corpo.ok ? "✓ Conectou com sucesso." : "✗ " + corpo.erro;
        resultado.style.color = corpo.ok ? "#166534" : "#b91c1c";
      } catch (erro) {
        resultado.textContent = "✗ " + erro.message;
        resultado.style.color = "#b91c1c";
      }
    }

    async function gerarLogEstrutura() {
      const form = document.querySelector("form");
      const dados = Object.fromEntries(new FormData(form).entries());
      const resultado = document.getElementById("resultado-schema");
      const textoEl = document.getElementById("texto-schema");
      resultado.textContent = "Lendo a estrutura do banco (pode levar alguns segundos)...";
      resultado.style.color = "#475569";
      textoEl.style.display = "none";

      try {
        const resposta = await fetch("/inspecionar-banco", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            host: dados.SOURCE_PG_HOST,
            port: dados.SOURCE_PG_PORT,
            database: dados.SOURCE_PG_DATABASE,
            user: dados.SOURCE_PG_USER,
            password: dados.SOURCE_PG_PASSWORD,
            ssl: dados.SOURCE_PG_SSL === "true",
          }),
        });
        const corpo = await resposta.json();

        if (!corpo.ok) {
          resultado.textContent = "✗ " + corpo.erro;
          resultado.style.color = "#b91c1c";
          return;
        }

        resultado.innerHTML = "✓ " + corpo.totalTabelas + " tabela(s) encontrada(s). Log salvo em: <code>" +
          corpo.caminhoTexto + "</code> — mande esse arquivo pra quem for adaptar as queries.";
        resultado.style.color = "#166534";
        textoEl.textContent = corpo.texto;
        textoEl.style.display = "block";
      } catch (erro) {
        resultado.textContent = "✗ " + erro.message;
        resultado.style.color = "#b91c1c";
      }
    }
  </script>
</body>
</html>`;
}

function lerCorpo(request) {
  return new Promise((resolve, reject) => {
    let dados = "";
    request.on("data", (pedaco) => (dados += pedaco));
    request.on("end", () => resolve(dados));
    request.on("error", reject);
  });
}

function montarMapaFormasPagamento(params) {
  const mapa = {};
  for (const forma of FORMAS_PAGAMENTO_FERRO_CIANORTE) {
    const codigoOrigem = params.get(`forma_${forma.valor}`);
    if (codigoOrigem) {
      mapa[codigoOrigem.trim()] = forma.valor;
    }
  }
  return mapa;
}

function montarMapaLojas(params) {
  const origens = params.getAll("loja_origem[]");
  const destinos = params.getAll("loja_destino[]");
  const mapa = {};

  origens.forEach((origem, indice) => {
    const destino = destinos[indice];
    if (origem.trim() && destino) {
      mapa[origem.trim()] = destino.trim();
    }
  });

  return mapa;
}

function iniciarWebUi(log) {
  const servidor = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(await paginaHtml());
        return;
      }

      if (request.method === "POST" && request.url === "/testar-postgres") {
        const corpo = JSON.parse(await lerCorpo(request));
        try {
          await testarConexao(corpo);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true }));
        } catch (erro) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, erro: erro.message }));
        }
        return;
      }

      if (request.method === "POST" && request.url === "/inspecionar-banco") {
        const corpo = JSON.parse(await lerCorpo(request));
        try {
          const resultado = await gerarLogEstrutura(corpo);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
            JSON.stringify({
              ok: true,
              texto: resultado.texto,
              caminhoTexto: resultado.caminhoTexto,
              totalTabelas: resultado.totalTabelas,
            }),
          );
        } catch (erro) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, erro: erro.message }));
        }
        return;
      }

      if (request.method === "POST" && request.url === "/lojas-link-pro") {
        const corpo = JSON.parse(await lerCorpo(request));
        try {
          const lojas = await buscarLojasLinkPro(corpo);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, lojas }));
        } catch (erro) {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: false, erro: erro.message }));
        }
        return;
      }

      if (request.method === "POST" && request.url === "/salvar") {
        const params = new URLSearchParams(await lerCorpo(request));

        salvarEnv({
          SOURCE_PG_HOST: params.get("SOURCE_PG_HOST") ?? "",
          SOURCE_PG_PORT: params.get("SOURCE_PG_PORT") ?? "",
          SOURCE_PG_DATABASE: params.get("SOURCE_PG_DATABASE") ?? "",
          SOURCE_PG_USER: params.get("SOURCE_PG_USER") ?? "",
          SOURCE_PG_PASSWORD: params.get("SOURCE_PG_PASSWORD") ?? "",
          SOURCE_PG_SSL: params.get("SOURCE_PG_SSL") ?? "false",
          FERRO_CIANORTE_API_URL: params.get("FERRO_CIANORTE_API_URL") ?? "",
          FERRO_CIANORTE_EMAIL: params.get("FERRO_CIANORTE_EMAIL") ?? "",
          FERRO_CIANORTE_PASSWORD: params.get("FERRO_CIANORTE_PASSWORD") ?? "",
          POLL_INTERVAL_MS: params.get("POLL_INTERVAL_MS") ?? "15000",
          CONFIG_UI_PORT: params.get("CONFIG_UI_PORT") ?? "4848",
          MAPA_FORMAS_PAGAMENTO: JSON.stringify(montarMapaFormasPagamento(params)),
          MAPA_LOJAS: JSON.stringify(montarMapaLojas(params)),
        });

        log("Configuração salva pela janela de configuração.");

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(await paginaHtml({ salvo: true }));
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Não encontrado.");
    } catch (erro) {
      response.writeHead(500, { "Content-Type": "text/plain" });
      response.end(`Erro: ${erro.message}`);
    }
  });

  const { configUiPort } = carregarConfig();
  servidor.listen(configUiPort, () => {
    log(`Janela de configuração disponível em http://localhost:${configUiPort}`);
  });

  return servidor;
}

module.exports = { iniciarWebUi };
