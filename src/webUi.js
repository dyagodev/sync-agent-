const http = require("node:http");
const { carregarConfig, estaConfigurado, itensFaltando } = require("./config");
const { lerEnvSalvo, salvarEnv } = require("./configStore");
const { listarLojas } = require("./ferroCianorteApi");
const { testarConexao, buscarLojasLinkPro, buscarFormasPagamentoLinkPro } = require("./sourceDb");
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
  const nomePorLojaId = Object.fromEntries(lojasFerroCianorte.map((l) => [String(l.id), l.nome]));

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

  ${salvo ? '<div class="status ok">Configuração salva — se estiver completa, a sincronização já começou sozinha (sem precisar reiniciar).</div>' : ""}
  ${
    !configurado
      ? `<div class="status alerta">Configuração incompleta — a sincronização ainda não está rodando. Falta:<ul style="margin: 6px 0 0; padding-left: 20px;">${itensFaltando(config)
          .map((item) => `<li>${escaparHtml(item)}</li>`)
          .join("")}</ul></div>`
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
      ${campo("Sincronizar vendas a partir de", "SYNC_DESDE", env.SYNC_DESDE || new Date().toISOString().slice(0, 10), { tipo: "date", ajuda: "Vendas mais antigas que essa data nunca são trazidas do Link Pro (evita reimportar histórico antigo)." })}
    </div>

    <h2>Mapeamento de lojas</h2>
    <small>
      Fixo: loja 1 do Link Pro → loja 1 do Ferro Cianorte${nomePorLojaId["1"] ? ` (${escaparHtml(nomePorLojaId["1"])})` : ""},
      loja 2 → loja 2${nomePorLojaId["2"] ? ` (${escaparHtml(nomePorLojaId["2"])})` : ""},
      loja 3 → loja 3${nomePorLojaId["3"] ? ` (${escaparHtml(nomePorLojaId["3"])})` : ""}.
      Cada instância do agente já sabe sozinha qual é a loja desta conexão
      (via <code>dados_empresa.codigo_loja</code>) — use o botão abaixo só pra conferir.
    </small>
    <br /><br />
    <button type="button" class="secundario" onclick="buscarLojasLinkPro()">Conferir loja desta conexão no Link Pro</button>
    <div id="resultado-lojas-linkpro"></div>
    <div id="lojas-linkpro-encontradas"></div>

    <h2>Formas de pagamento</h2>
    <small>Qual código o Link Pro usa para cada forma de pagamento nossa (deixe em branco se não existir).</small><br /><br />
    ${FORMAS_PAGAMENTO_FERRO_CIANORTE.map(
      (forma) => `
      <div class="linha-pagamento">
        <span>${forma.rotulo}</span>
        <input type="text" name="forma_${forma.valor}" value="${escaparHtml(codigoPorForma[forma.valor] ?? "")}" placeholder="ex: D" />
      </div>`,
    ).join("")}
    <button type="button" class="secundario" onclick="buscarFormasPagamentoLinkPro()">Ver formas de pagamento usadas no Link Pro</button>
    <div id="resultado-formas-pagamento"></div>
    <div id="formas-pagamento-encontradas"></div>

    <button type="submit">Salvar configuração</button>
  </form>

  <script>
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
          resultado.textContent = "Não achei a tabela de lojas nesse Link Pro (ou ela está vazia).";
          resultado.style.color = "#854d0e";
          return;
        }

        resultado.textContent = corpo.lojas.length + " loja(s) encontrada(s) nesta conexão (★ = a loja desta conexão, deve bater com o número fixo configurado acima):";
        resultado.style.color = "#166534";

        for (const loja of corpo.lojas) {
          const badge = document.createElement("span");
          badge.className = "adicionar";
          badge.style.marginRight = "6px";
          badge.style.display = "inline-block";
          badge.textContent = (loja.provavelEsta ? "★ " : "") + loja.nome + " (id " + loja.id + ")";
          areaEncontradas.appendChild(badge);
        }
      } catch (erro) {
        resultado.textContent = "✗ " + erro.message;
        resultado.style.color = "#b91c1c";
      }
    }

    async function buscarFormasPagamentoLinkPro() {
      const form = document.querySelector("form");
      const dados = Object.fromEntries(new FormData(form).entries());
      const resultado = document.getElementById("resultado-formas-pagamento");
      const areaEncontradas = document.getElementById("formas-pagamento-encontradas");
      resultado.textContent = "Buscando formas de pagamento usadas no Link Pro...";
      resultado.style.color = "#475569";
      areaEncontradas.innerHTML = "";

      try {
        const resposta = await fetch("/formas-pagamento-link-pro", {
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

        if (corpo.formas.length === 0) {
          resultado.textContent = "Não achei nenhuma parcela registrada ainda nesse Link Pro (a tabela existe, mas está vazia).";
          resultado.style.color = "#854d0e";
          return;
        }

        resultado.textContent = "Valores encontrados em negociacao_parcela.forma_pagamento — use exatamente esse texto nos campos acima:";
        resultado.style.color = "#166534";

        for (const forma of corpo.formas) {
          const badge = document.createElement("span");
          badge.className = "adicionar";
          badge.style.marginRight = "6px";
          badge.style.display = "inline-block";
          badge.textContent = '"' + forma.formaPagamento + '" (' + forma.quantidade + "x)";
          areaEncontradas.appendChild(badge);
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

// Mapeamento fixo: loja 1/2/3 do Link Pro (uma instância do agente por loja,
// identificada por dados_empresa.codigo_loja) casa direto com a loja 1/2/3
// do Ferro Cianorte — não depende mais do formulário dinâmico de mapeamento
// (que tinha se mostrado frágil pra salvar corretamente).
const MAPA_LOJAS_FIXO = { 1: 1, 2: 2, 3: 3 };

function montarMapaLojas() {
  return MAPA_LOJAS_FIXO;
}

function iniciarWebUi(log, aoSalvarConfig) {
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

      if (request.method === "POST" && request.url === "/formas-pagamento-link-pro") {
        const corpo = JSON.parse(await lerCorpo(request));
        try {
          const formas = await buscarFormasPagamentoLinkPro(corpo);
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ ok: true, formas }));
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
          // Se o campo vier vazio, trava em hoje (não recalcula a cada save,
          // senão um "salvar" de amanhã empurraria o corte pra frente de novo).
          SYNC_DESDE: params.get("SYNC_DESDE") || lerEnvSalvo().SYNC_DESDE || new Date().toISOString().slice(0, 10),
          MAPA_FORMAS_PAGAMENTO: JSON.stringify(montarMapaFormasPagamento(params)),
          MAPA_LOJAS: JSON.stringify(montarMapaLojas(params)),
        });

        log("Configuração salva pela janela de configuração.");
        // Tenta começar a sincronizar na hora — sem isso, salvar não tinha
        // efeito nenhum até reiniciar o processo manualmente, o que já
        // causou confusão (parecia que "não salvava").
        aoSalvarConfig?.();

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
