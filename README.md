# Agente de sincronização — Link Pro → Ferro Cianorte

Roda continuamente na máquina onde fica o Postgres do sistema Link Pro (Cervantes
Tecnologia — **multiloja**), monitora vendas novas e replica cada uma no Ferro
Cianorte via `POST /api/vendas/sync` — o mesmo endpoint que o app desktop usa
pra sincronizar vendas feitas offline. Isso já garante: idempotência (não
duplica venda), decremento de estoque na loja certa, e histórico normal na
tela de vendas/relatórios.

## Como funciona

1. A cada `POLL_INTERVAL_MS`, consulta `queries/vendas.sql` pedindo vendas com
   `id` maior que o último processado (guardado em `checkpoint.json`). Essa
   query já traz qual loja do Link Pro gerou cada venda.
2. Para as vendas encontradas, busca os itens (`queries/itens.sql`) e as
   formas de pagamento (`queries/pagamentos.sql`).
3. Traduz a loja de origem pra uma loja do Ferro Cianorte usando o
   **mapeamento de lojas** da janela de configuração — venda de loja sem
   mapeamento é ignorada e logada, não trava as demais.
4. Resolve cada item pelo `codigo_barras` contra o catálogo já cadastrado no
   Ferro Cianorte (produto sem correspondência é ignorado e logado, não trava
   a venda toda).
5. Envia o lote pro Ferro Cianorte e atualiza o checkpoint.
6. Também verifica `queries/estoque.sql` (opcional) atrás de qualquer estoque
   atualizado desde a última checagem — **inclusive ajustes feitos sem venda**
   (contagem manual, balança, correção, entrada de mercadoria lançada direto
   no Link Pro) — e sobrescreve a quantidade correspondente no Ferro Cianorte,
   pra nunca ficar com furo entre os dois sistemas.

## ⚠️ O schema do Link Pro ainda não foi confirmado

As queries em `queries/*.sql.example` são um **chute razoável**, não o schema
real — o banco do Link Pro é privado, sem acesso direto de quem está
adaptando este agente. Pra resolver isso sem precisar de um DBA nem de acesso
remoto ao banco:

### Gerando o log da estrutura do banco

Na janela de configuração (`http://localhost:4848`), preencha os campos do
"Postgres de origem" e clique em **"Gerar log da estrutura do banco"**. Isso
conecta no Postgres do Link Pro (só leitura, via `information_schema`) e lista
todas as tabelas e colunas com tipo, obrigatoriedade e valor padrão — sem
precisar salvar a configuração antes. O resultado aparece na tela e também é
salvo em `logs/estrutura-banco-<data>.txt` (e um `.json` com os mesmos dados).
Tabelas cujo nome bate com palavras como "venda", "item", "pagamento",
"estoque", "produto", "cliente", "fornecedor" ou "loja" ficam marcadas com ★
no topo do log, pra facilitar achar as relevantes num banco com muitas tabelas.

Quem estiver na loja com acesso ao Postgres do Link Pro roda isso uma vez,
manda o arquivo `.txt` (ou cola o conteúdo) pra quem for adaptar as queries —
não precisa mais adivinhar nomes de tabela/coluna nem pedir acesso direto ao
banco.

1. Copie os arquivos `.sql.example` para `.sql` (sem o `.example`) e ajuste
   nomes de tabela/coluna com base no log gerado, mantendo os apelidos de
   coluna exigidos (documentados em cada arquivo, ex: `as id`, `as loja_externa`,
   `as venda_id`...).
   `vendas.sql`, `itens.sql` e `pagamentos.sql` são obrigatórios; `estoque.sql`
   é opcional (sem ele, o agente só sincroniza vendas, não ajustes manuais).
2. Os arquivos `.sql` (sem `.example`) ficam fora do git (`.gitignore`) porque
   são específicos de cada instalação do Link Pro.

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
- **Mapeamento de lojas**: uma linha por loja do Link Pro, ligando o
  código/id que ele usa pra cada uma das nossas lojas. Dá pra adicionar quantas
  linhas forem necessárias ("+ adicionar loja") — uma venda de uma loja sem
  linha correspondente aqui é ignorada (e logada) em vez de cair na loja errada.
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

