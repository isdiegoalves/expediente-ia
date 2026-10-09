# Plugins do Claude Code do Expediente

O repositório é também um marketplace de plugins do Claude Code: `.claude-plugin/marketplace.json` (na raiz)
lista o marketplace `expediente` com dois plugins, um em cada pasta daqui. As versões acompanham o `package.json`
(o teste `server/test/mod.test.ts` falha se divergirem).

Testado com o **Claude Code 2.1.293**. Mods (hooks em TypeScript carregados pelo próprio Claude Code) existem a
partir da 2.1.287; a API ainda é "early access" e pode mudar entre versões. A instalação (`npm run instalar`) está no README principal.

## `expediente` — o mod

`expediente/hooks/register.tsx`, um módulo só, sem build. Liga cada sessão ao escritório sem ler a conversa:

- **Uso do plano (5h e semanal):** no início da sessão e a cada `session.measure` (depois de cada turno e quando
  um limite anda um ponto) lê `$.session.usage().rateLimits` e grava `~/.expediente/host/uso/<conta>.json` (ou em
  `EXPEDIENTE_USAGE_DIR`) no mesmo formato do tap de statusline, mais `"source": "mod"`. O seu statusline fica intocado. A conta é a pasta de `CLAUDE_CONFIG_DIR` (o primeiro
  item) ou `~/.claude`. Valores iguais gravados há menos de 10 s não são regravados; falha ao gravar = silêncio.
- **"Precisa de você" embaixo do prompt:** a cada 5 s pergunta ao Expediente local
  (`GET http://127.0.0.1:<EXPEDIENTE_PORT ou 4848>/api/mod/summary`) quem está esperando, já sem esta sessão e os
  subagentes dela, e mostra `🏢 Valentina precisa de você em loja-virtual` ou
  `🏢 2 precisam de você: Valentina (loja-virtual), Elias (app-mobile)` (até 3 nomes, depois "e mais N").
  Ninguém esperando ou Expediente fora do ar: a linha some; fora do ar, as perguntas passam a ser a cada 30 s até
  ele voltar. Só em sessões que desenham (no `claude -p` não pergunta nada).
- **`/escritorio`:** as sessões por estado (precisa de você, trabalhando, esperando um comando, ociosas) com contexto,
  compactações e custo de cada uma, mais uma linha da sua própria sessão. Respondido pelo próprio mod (não chama o
  modelo, não gasta uso); o número exclui esta sessão e os subagentes dela:

  ```
  Expediente 0.4.0 em http://localhost:4848
  3 agentes · 1 trabalhando · 1 precisa de você
  Precisa de você (1)
    Valentina · loja-virtual · Subir o deploy · aprovar uma permissão (dá para responder pelo escritório)
      contexto 142,3 k de 1 M (14%) · compactou 1× · US$ 4,50 (estimado)
  Trabalhando (1)
    Bia · site
      US$ 2,00
  Esta sessão: contexto 50 k de 200 k (25%)
  ```

  Fora do ar: `O Expediente não respondeu em http://localhost:4848. Para subir: npm run docker:up na pasta do Expediente.`

  Onde a sessão desenha, o comando também abre o painel "Escritório" com o caminho de cada sessão, renovado a cada 30 s
  enquanto está aberto. Sessão do app: no terminal, o link `claude://code/continue?session=local_…` e o botão "Abrir"
  (`open`, só para URL da lista permitida); no app, o link `http://localhost:<porta>/api/agentes/<id>/ir?abrir=1&n=<nonce>`
  (o servidor confere o nonce e responde 302 para o app). Sessão de terminal viva: "Focar" (painel do zellij e WezTerm à
  frente; ramo genérico por tty para Terminal e iTerm2) quando o painel foi achado, e sempre a cópia
  `claude --resume <id> --fork-session` rotulada como cópia; `kind=bg`: `claude attach <id>`; encerrada:
  `cd -- '<cwd>' && claude --resume <id>`. No app o comando aparece num bloco para selecionar (ali não há como copiar).
  Para achar o painel, o mod lê do processo da sessão só `ZELLIJ_PANE_ID` e `ZELLIJ_SESSION_NAME`, filtrados na origem.

- **Ponte do app desktop:** a cada 5 s lê `~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json`,
  seleciona por nome `sessionId`, `cliSessionId` e `isArchived` (nada mais do arquivo é copiado) e grava
  `~/.expediente/host/sessoes-app.json` (`{geradoEm, sessoes}`) num `.tmp` trocado por `mv -f`. Só relê o arquivo
  cujo tamanho ou data mudou; se o arquivo final tem menos de 4 s, a sessão pula a rodada. Só em sessões que desenham.
- **Amostra horária:** ao ligar e a cada 10 min confere se já há `~/.expediente/host/amostras/<hora>-<conta>.json`; se não há, lê
  `pid`, `entrypoint` e `kind` do registro de sessões da conta e, por pid vivo, o nome do programa de cada processo da cadeia de
  pais (`ps -o ppid=,comm=`, só o último trecho do caminho). Grava só contagens: `{hora, registro, programas}`. Para na 24ª amostra da conta e grava `amostras/concluido-<conta>`; apague esse arquivo para religar. Só em sessões que desenham.

### O que ele acessa

Saída de `claude plugin validate --strict mod/expediente` (a análise estática que o Claude Code faz antes de
carregar o módulo; nada fora desta lista é chamado):

```
❯ ./register.tsx hooks: session.start, session.measure, command.run{command=escritorio}, ui.render{component=Pane, requestId=escritorio}
❯ ./register.tsx answers its own command: command.run{command=escritorio}
❯ ./register.tsx calls: $.clock.after (via getExpediente), $.clock.every (via expedienteText, ligarAmostrador, ligarPonte, schedule), $.clock.now, $.command.register, $.env.get (via amostrarRegistro, readEnv, rodarPonte), $.fs.list (via amostrarRegistro, arquivosDoApp), $.fs.read (via amostrarRegistro, rodarPonte), $.fs.stat (via amostrarRegistro, rodarPonte), $.fs.write (via amostrarRegistro, rodarPonte, writeUsage), $.http.fetch (via getExpediente), $.process.run (via abrirNoApp, acharFoco, amostrarRegistro, focar, rodarPonte), $.session.id (via consulta, rodarPonte), $.session.surfaces (via atualizarPainel, expedienteText, ligarAmostrador, ligarPonte, poll), $.session.usage, $.ui.copy (via copiarComando), $.ui.invalidate (via atualizarPainel), $.ui.open (via expedienteText), $.ui.resolve, $.ui.status (via setStatus), $.ui.toast (via abrirNoApp, copiarComando, focar)
❯ ./register.tsx env writes: nothing
❯ ./register.tsx env reads: CLAUDE_CONFIG_DIR, EXPEDIENTE_PORT, EXPEDIENTE_USAGE_DIR, HOME
```

Em palavras: só observa (nenhum hook decide nada: não aprova ferramentas, não muda prompts, não lê mensagens),
grava três tipos de arquivo em `~/.expediente/host` (o de uso, o `sessoes-app.json`, este por `mv`, e uma amostra por hora em
`amostras/`), roda `$.process` só para o `mv`, para `ps -o ppid=,comm=` e, a pedido no painel do `/escritorio`, para o leitor do painel, `open` (lista permitida), `zellij`, `pgrep` e `osascript`, fala só com `127.0.0.1` e lê quatro variáveis de ambiente. `$.clock.after` é o
prazo de 2 s de cada pergunta ao Expediente (`$.http.fetch` não aceita AbortSignal).

## `expediente-permissoes` — responder permissões pelo escritório

Um hook `PermissionRequest` comum (sem mod), em `expediente-permissoes/hooks/hooks.json`:

```json
{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/permission-hook.mjs\"", "timeout": 330, "statusMessage": "Aguardando resposta no Expediente" }] }
```

O script `hooks/permission-hook.mjs` é o único script do hook (fonte única; Node puro, só
`node:*`, porque o Claude Code copia apenas a pasta do plugin para o cache). Ele manda o pedido ao Expediente local
e espera a resposta por até 5 min; o diálogo continua no terminal e vale o que você responder primeiro. Sem o
Expediente no ar ou sem nenhuma página aberta, sai na hora. Porta: `EXPEDIENTE_PORT` (padrão 4848); espera:
`EXPEDIENTE_PERMISSION_TIMEOUT` (padrão 300 s; o tempo limite do hook no plugin é fixo em 330 s, então valores
maiores que 300 são cortados pelo Claude Code). Precisa de `node` 22+ no `PATH` da sessão.

`claude plugin validate --strict mod/expediente-permissoes`: `✔ Validation passed` (o validador também confere o
esquema do `hooks.json`).

## Desenvolver

```bash
claude --plugin-dir mod/expediente                     # carrega o mod numa sessão, sem instalar (recarrega ao salvar)
claude -p "/escritorio" --plugin-dir mod/expediente      # testa o comando sem sessão interativa (não chama o modelo)
cd mod/expediente && claude plugin test                # testes do mod (tests/*.test.ts), sem sessão, login nem rede
claude plugin validate --strict mod/expediente         # análise estática + manifesto (idem para mod/expediente-permissoes e .)
npx tsc -p mod/expediente                              # tipos (depois de carregar o mod uma vez com --plugin-dir)
```

Ao carregar o mod, o Claude Code grava os tipos da versão instalada em `expediente/.claude-plugin/types/` e um
`expediente/tsconfig.json` que os estende; os dois são gerados e ficam fora do git (`mod/.gitignore`). Os testes do
mod importam `claude-code/testing` e só rodam pelo `claude plugin test`: o `npm test` (vitest) e o
`npm run typecheck` não olham esta pasta.
