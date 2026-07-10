# Agente de sincronização — Link Pro → Ferro Cianorte

Roda continuamente na máquina onde fica o Postgres do sistema Link Pro (Cervantes
Tecnologia — **multiloja**), monitora vendas novas e replica cada uma no Ferro
Cianorte via `POST /api/vendas/sync` — o mesmo endpoint que o app desktop usa
pra sincronizar vendas feitas offline. Isso já garante: idempotência (não
duplica venda), decremento de estoque na loja certa, e histórico normal na
tela de vendas/relatórios.

## Como funciona

1. A cada `POLL_INTERVAL_MS`, consulta `queries/vendas.sql` pedindo vendas com
   `id` maior que o último processado (guardado em `checkpoint.json`) **e**
   com data maior ou igual a `SYNC_DESDE` (configurável na janela do agente;
   por padrão, o dia em que a configuração foi salva pela primeira vez) —
   sem esse corte, a primeira execução tentaria replicar todo o histórico de
   vendas do Link Pro, decrementando de novo um estoque que já reflete essas
   vendas antigas. Essa query já traz qual loja do Link Pro gerou cada venda,
   e o `data_hora` real da venda (preservado até o fim — o Ferro Cianorte usa
   essa data no lugar da data da sincronização, senão relatório por período
   ficaria errado).
2. Para as vendas encontradas, busca os itens (`queries/itens.sql`) e as
   formas de pagamento (`queries/pagamentos.sql`).
3. Traduz a loja de origem pra uma loja do Ferro Cianorte usando o
   **mapeamento de lojas** da janela de configuração — venda de loja sem
   mapeamento é ignorada e logada, não trava as demais.
4. Resolve cada item pelo **código interno** (a etiqueta que a própria loja
   gera e cola no produto — `produto.produto_codigo` no Link Pro) contra o
   catálogo já cadastrado no Ferro Cianorte (produto sem correspondência é
   ignorado e logado, não trava a venda toda). Não usamos mais o código de
   barras de fábrica (`produto.cean`) pra isso, porque muita peça solta de
   ferragem não tem um válido.
5. Envia o lote pro Ferro Cianorte e atualiza o checkpoint.
6. Também verifica `queries/estoque.sql` (opcional) atrás de qualquer estoque
   atualizado desde a última checagem — **inclusive ajustes feitos sem venda**
   (contagem manual, balança, correção, entrada de mercadoria lançada direto
   no Link Pro) — e sobrescreve a quantidade correspondente no Ferro Cianorte,
   pra nunca ficar com furo entre os dois sistemas.

## ✅ Schema do Link Pro confirmado (banco "InkDB")

Em 2026-07-09 rodamos o **"Gerar log da estrutura do banco"** contra o
Postgres real do Link Pro (banco chamado `InkDB`, 380 tabelas). As queries em
`queries/vendas.sql`, `itens.sql`, `pagamentos.sql` e `estoque.sql` já estão
escritas pra esse schema real (não são mais `.sql.example` chutados) — ficam
fora do git (`.gitignore`) por conterem nomes específicos dessa instalação,
mas o texto de cada uma documenta as tabelas/colunas usadas. Resumo do que
foi descoberto:

- **`negociacao`** é a tabela de vendas (`venda = true` filtra venda de
  orçamento). **`negociacao_item_vendido`** são os itens vendidos, ligados por
  `id_negociacao`. **`negociacao_parcela`** são as formas de pagamento, com
  `forma_pagamento` já em texto (`"Dinheiro"`, `"Pix"`, `"Cartao"`...).
- **`produto.produto_codigo`** é o código interno do Link Pro (a etiqueta que
  a própria loja gera) — é ele que usamos pra casar produto, não
  `produto.cean` (código de barras de fábrica, que muita peça solta de
  ferragem não tem).
- **`log_produto_qtd_estoque`** é um histórico de toda mudança de estoque
  (venda ou ajuste manual/balanço) com timestamp — é o que `estoque.sql` usa
  pra sincronização incremental.

### ✅ Confirmado: um Postgres por loja, código real da loja em `dados_empresa`

Não existe coluna de loja/filial em `negociacao`, `produto`, `cliente` nem
`caixa`. Isso foi confirmado direto na tela **"Dados da Empresa → Lojas"** do
próprio Link Pro: cada loja roda seu **próprio banco Postgres**, com host e
porta próprios, e essa tela é literalmente a tabela `dados_empresa_loja` —
mas ela lista as **outras** lojas conhecidas por esta (via *foreign data
wrapper*, pra consulta remota entre filiais), não a loja da conexão atual.
O código da loja atual (o que aparece em "Informações desta loja" na tela)
fica em `dados_empresa.codigo_loja` — é esse valor que `vendas.sql` e
`estoque.sql` usam de verdade:

```sql
(select codigo_loja::text from dados_empresa limit 1) as loja_externa
```

Ou seja: **uma instância do agente por loja** (cada uma configurada com o
`SOURCE_PG_HOST`/porta daquela loja), e cada instância já traz sozinha o
código real dessa loja — sem precisar inventar nem digitar nada na query.

### Se precisar readaptar (outra instalação, versão diferente do Link Pro)

1. Rode **"Gerar log da estrutura do banco"** na janela de configuração — sem
   precisar salvar a config antes nem ter acesso direto ao banco por fora.
   O resultado aparece na tela e fica salvo em
   `logs/estrutura-banco-<data>.txt` (+ `.json`), com tabelas relevantes
   marcadas com ★ e uma seção de amostra de dados (lojas cadastradas, formas
   de pagamento reais usadas) pra tirar dúvidas que a estrutura sozinha não
   responde.
2. Copie `queries/*.sql.example` para `.sql` (sem `.example`) e ajuste nomes
   de tabela/coluna com base no log, mantendo os apelidos exigidos (`as id`,
   `as loja_externa`, `as venda_id`...). `vendas.sql`, `itens.sql` e
   `pagamentos.sql` são obrigatórios; `estoque.sql` é opcional.

## Instalação no Windows (recomendado — máquina do Link Pro)

Não precisa instalar Node.js nem editar arquivo nenhum na máquina do Link Pro
— existe um instalador pronto que empacota tudo num `.exe` único.

**Gerando o instalador** (feito uma vez, numa máquina de desenvolvimento):

```bash
cd sync-agent
npm install
npm run build:win
```

Isso gera a pasta `dist/win/` com:

- `agente.exe` — o agente inteiro, sem precisar de Node.js instalado
- `queries/*.sql.example` — os modelos de query pra adaptar ao schema real
- `INSTALAR.bat` — instalador
- `LEIA-ME.txt` — instruções rápidas

**Instalando na máquina do Link Pro:**

1. Copie a pasta `dist/win` inteira pra máquina do Link Pro (pendrive, rede, etc.).
2. Abra `queries/`, copie os 3 arquivos `.sql.example` removendo o `.example`,
   e ajuste as consultas ao schema real do Postgres do Link Pro (veja a seção
   abaixo sobre o schema).
3. Dê **dois cliques em `INSTALAR.bat`**. Isso:
   - copia o `agente.exe` e as queries pra `%LOCALAPPDATA%\FerroCianorteSyncAgent`
   - cria um atalho na pasta de Inicialização do Windows, pra o agente **subir
     sozinho sempre que alguém logar na máquina** (não precisa abrir nada manualmente)
   - abre o agente pela primeira vez, que já mostra a janela de configuração
     no navegador
4. Preencha a janela de configuração (veja abaixo) e salve.
5. Feche o agente (ele roda numa janela de terminal) e abra de novo — ou
   simplesmente reinicie o computador — pra sincronização começar valendo.

Pra reconfigurar depois (trocar senha, adicionar uma loja nova, etc.), é só
abrir `http://localhost:4848` a qualquer momento enquanto o agente estiver
rodando (ele já fica sempre ativo em segundo plano).

## Setup manual (Linux/macOS, ou para desenvolvimento)

```bash
cd sync-agent
npm install
cp queries/vendas.sql.example queries/vendas.sql
cp queries/itens.sql.example queries/itens.sql
cp queries/pagamentos.sql.example queries/pagamentos.sql
npm start
```

Não precisa criar `.env` na mão: na primeira vez que rodar, o agente já sobe
uma **janela de configuração no navegador** em `http://localhost:4848` (a
sincronização em si só começa depois que a config for salva e o agente
reiniciado uma vez). Nesse caso, mantenha o processo rodando com um supervisor
(pm2, systemd, launchd) — não incluído aqui de propósito, escolha o que já for
padrão nessa máquina.

### Janela de configuração

Abra `http://localhost:4848` e preencha:

- **Postgres de origem**: host, porta, banco, usuário, senha — tem um botão
  "Testar conexão" que confirma se os dados batem antes de salvar.
- **API do Ferro Cianorte**: URL da API, e-mail/senha do usuário de integração
  (veja abaixo). A página mostra a lista das suas lojas cadastradas como
  referência assim que essas credenciais estiverem salvas.
- **Comportamento**: intervalo entre verificações e a porta desta própria
  janela.
- **Mapeamento de lojas**: uma linha por loja do Link Pro, ligando o código
  real dessa loja (vindo de `dados_empresa.codigo_loja`) a uma das nossas
  lojas. O lado "Ferro Cianorte" já vem como uma lista pra escolher (nada de
  decorar id) — e o botão **"Buscar lojas no Link Pro"** já traz a loja desta
  conexão pronta (marcada com ★, exatamente igual à tela "Dados da Empresa →
  Lojas" do Link Pro) mais as outras lojas conhecidas, como botões prontos
  pra clicar e adicionar. Venda de uma loja sem linha correspondente aqui é
  ignorada (e logada) em vez de cair na loja errada.
- **Formas de pagamento**: qual código o Link Pro usa pra cada forma nossa
  (ex.: "D" para Dinheiro), baseado nos atalhos vistos na tela do Link Pro.

Ao salvar, os dados vão para um `.env` (gerado automaticamente, não versionado)
e é só reiniciar o agente (`Ctrl+C` e `npm start` de novo) pra sincronização
começar valendo a nova configuração.

### Criando o usuário de integração

No admin do Ferro Cianorte (`/admin/funcionarios`), crie um funcionário com
papel **Admin** (não Vendedor). Precisa ser admin porque o Link Pro é
multiloja: cada venda sincronizada pode pertencer a uma loja nossa diferente,
e só uma conta admin pode informar explicitamente em qual loja registrar cada
venda — um vendedor fica preso à própria loja. Use o e-mail/senha desse
usuário na janela de configuração.

