> **Origem.** O Expediente deriva do [Habblaud](https://github.com/marmottajr/habblaud) 0.4.0 (commit `cb0c0bb`, licença MIT, Copyright (c) 2026 Márcio Junior). Os arquivos herdados foram modificados; veja `LICENSE` e `NOTICE`.

<p align="center">
  <img src="client/public/assets/brand/logo-mark@4x.png" width="96" alt="Logo do Expediente: um pequeno prédio em pixel art" />
</p>

<h1 align="center">Expediente</h1>

<p align="center">
  <b>O escritório virtual dos seus agentes do Claude Code.</b><br />
  Cada projeto vira uma sala, cada agente vira um personagem em pixel art que mostra, em tempo real, o que está fazendo.
</p>

<p align="center">
  <img alt="Node.js 22.12+" src="https://img.shields.io/badge/node-%E2%89%A522.12-5fa04e?logo=node.js&logoColor=white" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178c6?logo=typescript&logoColor=white" />
  <img alt="Docker" src="https://img.shields.io/badge/Docker-pronto-2496ed?logo=docker&logoColor=white" />
  <img alt="Zero dependências de runtime" src="https://img.shields.io/badge/depend%C3%AAncias%20de%20runtime-0-f08a3c" />
  <img alt="Interface em português" src="https://img.shields.io/badge/interface-PT--BR-4aa8e8" />
</p>

<p align="center">
  <img src="docs/screenshots/office.gif" width="820" alt="Animação de uma sala do Expediente: personagens digitando nas mesas, subagentes com crachá e balões de atividade" />
</p>

---

Você abre o Claude Code em vários projetos, dispara subagentes, deixa tarefas rodando… e perde a noção de quem está
fazendo o quê. O **Expediente** transforma isso num escritório que dá para entender de relance: quem está digitando,
quem levantou a mão porque **precisa de você**, quem entregou o trabalho e foi embora, quem foi tomar um café
enquanto espera a próxima instrução — e quanto de cada conta você já gastou na sessão de 5 horas e na semana.

E quando dois ou mais agentes estão à toa, o escritório ganha **vida social**: cada um tem personalidade própria, e
eles veem futebol juntos no lounge, jogam videogame e ping-pong, fofocam na copa, se arrumam no espelho e apostam
moedinhas no jokenpô. Veja em [Vida social](#vida-social).

Tudo roda na sua máquina, lendo os arquivos que o próprio Claude Code já grava (e só as linhas `alias` do seu shell,
para dar a letra de cada conta). Nada sai do computador: o Expediente não lê credenciais nem faz chamadas externas.

## Sumário

- [Como é](#como-é)
- [Instalação](#instalação)
- [Como usar](#como-usar)
- [Contas e uso (5 horas e semanal)](#contas-e-uso-5-horas-e-semanal)
- [Configuração](#configuração)
- [Como funciona](#como-funciona)
- [Privacidade e segurança](#privacidade-e-segurança)
- [Desenvolvimento](#desenvolvimento)
- [Solução de problemas](#solução-de-problemas)
- [Aviso](#aviso)
- [Licença](#licença)
- [Vida social](#vida-social)

## Como é

**Visão geral.** O prédio tem recepção com elevadores, copa, banheiros e lounge; cada projeto com uma sessão aberta
ganha a sua sala ao longo do corredor. No topo, os contadores e o uso de cada conta; à esquerda, as salas e os
agentes; embaixo, o feed de atividade.

![Visão geral do Expediente: prédio com recepção, copa, banheiros, lounge e salas de projeto; barra lateral com salas e agentes; uso das contas no topo; feed de atividade embaixo](docs/screenshots/overview.png)

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/agent-details.png" alt="Gaveta de detalhes de um agente com tarefas, subagentes, linha do tempo e estatísticas" /></td>
    <td width="50%"><img src="docs/screenshots/night.png" alt="O escritório à noite, com postes acesos e salas iluminadas" /></td>
  </tr>
  <tr>
    <td><b>Detalhes do agente:</b> atividade atual, tarefas com progresso, subagentes, linha do tempo e estatísticas.</td>
    <td><b>Dia e noite:</b> o céu nas janelas e a iluminação seguem a hora local.</td>
  </tr>
</table>

<table>
  <tr>
    <td width="42%"><img src="docs/screenshots/collab.png" alt="Subagente entregando o resultado ao agente principal enquanto outra agente pede permissão" /></td>
    <td width="58%">
      <b>Colaboração à vista.</b> Subagentes são colegas com nome próprio e crachá: chegam pelo elevador, trabalham na
      sala do projeto e, ao terminar, vão até o agente que os chamou entregar o resultado (📦) antes de ir embora.<br /><br />
      <b>Precisa de você.</b> Quando um agente espera uma permissão ou resposta no terminal, ele corre para a mesa e
      levanta a mão, com um alerta piscando — e um aviso aparece na tela (opcionalmente com som e notificação do navegador).
    </td>
  </tr>
</table>

<table>
  <tr>
    <td width="58%">
      <b>Esperando o shell.</b> Quando o agente termina o turno mas deixa um comando rodando (testes, build,
      deploy…), ele não sai para passear: fica na mesa com uma ampulheta virando sobre a cabeça, o terminal mostrando
      o progresso e um balão com o comando e o tempo. E a espera vira comédia: primeiro ele come pipoca assistindo ao
      terminal; depois de 3 min cruza os braços e gira na cadeira; depois de 10 min junta teia de aranha; depois de
      25 min cochila. Quando o comando termina, levanta e comemora com confete — ou ganha uma nuvem de chuva, se
      falhou. Na lista lateral e nos detalhes, um cronômetro mostra há quanto tempo cada comando está rodando.
    </td>
    <td width="42%"><img src="docs/screenshots/shell-wait.png" alt="Agente comendo pipoca na mesa, com uma ampulheta sobre a cabeça e o balão 'Rodar a suíte de testes · 1 min'; na fileira da frente, uma colega espera há mais tempo, com teia de aranha na cadeira e o terminal mostrando o progresso" /></td>
  </tr>
</table>

**A luz apaga.** Quando você fecha a última sessão de um projeto, o último personagem vai até o interruptor,
apaga a luz, sai pelo elevador — e a sala é desmontada, virando jardim até um novo projeto chegar. Se o jardim
ficou entre duas salas, a sala mais distante se muda para lá: é montada no lugar vago, o pessoal vai andando até
ela, e o endereço antigo apaga e é desmontado. Assim o prédio não fica com buracos e encolhe sozinho.

| 1. A sala é montada, ainda apagada | 2. Alguém acende a luz e todos trabalham | 3. O último sai e apaga a luz | 4. A sala vira jardim |
| --- | --- | --- | --- |
| ![Sala sendo montada, com os móveis aparecendo e a luz apagada](docs/screenshots/lifecycle-1.png) | ![Sala acesa com três agentes trabalhando nas mesas](docs/screenshots/lifecycle-2.png) | ![Sala com a luz apagada e os móveis ainda no lugar, depois que todos saíram](docs/screenshots/lifecycle-3.png) | ![O lote da sala transformado em jardim](docs/screenshots/lifecycle-4.png) |

<table>
  <tr>
    <td width="34%"><img src="docs/screenshots/mobile.png" alt="Expediente no celular, com o uso das contas no topo" /></td>
    <td>
      <b>Também no celular.</b> A interface se adapta a telas pequenas: o uso das contas fica no topo, a lista de
      salas vira uma gaveta e os detalhes abrem de baixo para cima. O Expediente só atende o próprio computador, então
      o celular não o alcança pela rede.
    </td>
  </tr>
</table>

> As imagens acima usam o **modo demonstração** (projetos, pessoas e contas fictícios).

## Instalação

### Requisitos

- **macOS** (testado) ou Linux.
- **[Claude Code](https://code.claude.com)** instalado, com uma ou mais contas (2.1.287 ou mais novo para o mod).
- **Node.js 22.12+** e **npm** (desenvolvido com o Node 24; o Docker já usa o Node 24).
- **Docker Desktop** (ou Docker Engine com Compose v2), se for rodar em container.

### 1. Baixe o projeto

```bash
git clone https://github.com/isdiegoalves/expediente-ia.git
cd expediente-ia
npm install
```

> O `npm install` só baixa ferramentas de compilação (Vite, TypeScript, tsx…). O servidor do Expediente não tem
> dependências de runtime: usa só módulos nativos do Node.

### 2. Suba o Expediente

**Opção A — Docker (recomendado para deixar sempre ligado)**

```bash
npm run docker:up
```

O script detecta as suas contas do Claude Code, monta só as pastas necessárias (em modo somente leitura), constrói
a imagem e sobe o container — que reinicia sozinho junto com o Docker. Abra **http://localhost:4848**.

**Opção B — Node, sem Docker**

```bash
npm run build
npm start
```

Abra **http://localhost:4848**. Para desenvolver, use `npm run dev` (servidor + Vite com recarga automática).

Agora abra o Claude Code em qualquer projeto e veja o seu agente chegar pelo elevador. 🎉

### 3. Instale o mod do Expediente no Claude Code (recomendado)

```bash
npm run instalar                         # o mod, em cada conta
npm run instalar -- --com-permissoes     # também o plugin de permissões (responder pelo escritório)
```

O Expediente traz um [mod](https://code.claude.com/docs/en/plugins/mods/overview) (um plugin que roda dentro do
Claude Code) e o instala em cada conta **só pelo `claude plugin`**, a partir de uma **cópia fixa** do commit (`~/.expediente/mod-instalado`, exportada sem `.git`, independente desta pasta): o instalador nunca edita o
`settings.json` de ninguém, nunca desinstala o plugin do projeto de origem (o Habblaud) e recusa o `expediente-permissoes` na conta onde o
`habblaud-permissoes` dele estiver ativo (os dois responderiam o mesmo pedido). Com o mod:

- o **uso de 5 horas e semanal** de cada conta aparece ao vivo no Expediente;
- o terminal mostra uma linha quando **outra sessão precisa de você** (permissão ou resposta);
- o comando **`/escritorio`** passa a existir no Claude Code;
- com `--com-permissoes`, dá para **aprovar ou recusar pelo escritório** os pedidos de permissão ("Do you want
  to…"), com o plugin `expediente-permissoes` (veja [Responder pelo escritório](#responder-pelo-escritório)).

Precisa do **Claude Code 2.1.287 ou mais novo** (`claude --version`); em versão anterior o instalador recusa a conta.
Antes de tocar nas contas, ele roda `claude plugin validate --strict` na cópia. `npm run instalar` instala o `HEAD` deste
checkout (e recusa se houver alterações nos arquivos versionados); `-- --commit <ref>` escolhe outro. O mod roda dentro de cada sessão,
com as suas permissões, e acessa só o que está listado em [`mod/README.md`](mod/README.md); para conferir sem rodar
nada, `claude plugin validate mod/expediente` mostra os eventos que ele trata e as chamadas que faz. Sessões já
abertas carregam o mod com `/reload-plugins` (ou ao reabrir). Confira com `npm run instalar:status`; para desfazer:
`npm run desinstalar`.

> O Claude Code lê o mod da cópia fixa, não deste checkout: trocar de branch aqui não muda o que as sessões rodam, e
> **mover ou apagar a pasta do repositório não afeta o mod instalado** (a cópia não guarda o caminho do repositório).
> Se você instalou antes de existir essa cópia independente (ela era um `git worktree` preso ao caminho do repositório),
> rode `npm run instalar` uma vez, na pasta onde o repositório está agora: ele troca a cópia e poda o registro antigo.
>
> **Conta nova:** crie e abra a conta (`CLAUDE_CONFIG_DIR=~/.claude-nova claude`) e rode `npm run instalar`: toda
> pasta `~/.claude*` com `projects/`, `sessions/` ou `.claude.json` (o Claude Code já rodou ali)
> é detectada, mesmo sem nenhuma sessão ainda. Para o mod chegar só a algumas contas, use `-- --conta <pasta>`.

### Atualizar

A versão em uso aparece na barra superior, ao lado de "Conectado", e em **Configurações › Sobre**. O servidor não
acessa a internet: quem confere se saiu versão nova é um script no seu computador, que você roda quando quiser
(as notas de cada versão também estão no [`CHANGELOG.md`](CHANGELOG.md)):

```bash
npm run versao           # consulta a última release do Expediente no GitHub e grava ~/.expediente/host/versao.json
```

É uma chamada anônima à API pública do GitHub, com tempo limite; se falhar, o arquivo anterior fica como estava. Não é
automático: só roda quando você manda (opt-in). Para agendar, ponha o mesmo comando no `cron` (macOS e Linux) ou no
`launchd` (macOS), por exemplo uma vez por dia:

```
0 9 * * * cd /caminho/do/expediente-ia && PATH=/caminho/do/node/bin:/usr/bin:/bin /caminho/do/node/bin/npm run versao >> $HOME/.expediente/versao.log 2>&1
```

O `cron` e o `launchd` rodam com um `PATH` mínimo, sem o do seu terminal: se o Node vem do `nvm` ou do Homebrew, o `npm` não
é achado. Por isso a linha leva o caminho absoluto do `npm` e o `PATH` com a pasta do Node; descubra a pasta com
`dirname "$(command -v node)"` num terminal onde o `npm run` funciona.

No `launchd` (macOS), um agente em `~/Library/LaunchAgents` com o mesmo comando e o mesmo `PATH`:

```xml
<key>ProgramArguments</key>
<array>
  <string>/bin/sh</string><string>-c</string>
  <string>cd /caminho/do/expediente-ia &amp;&amp; /caminho/do/node/bin/npm run versao</string>
</array>
<key>EnvironmentVariables</key>
<dict><key>PATH</key><string>/caminho/do/node/bin:/usr/bin:/bin</string></dict>
<key>StartCalendarInterval</key>
<dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
```

O servidor relê o arquivo sozinho, sem reiniciar (no Docker, o `~/.expediente/host` já é montado em `/host`, só leitura).

Quando a última release é maior que a versão em uso, aparece o selo **Nova versão** no lugar do número e um aviso (uma vez por versão). Em **Configurações › Sobre**
ficam a versão nova com a data, o link **Ver o que mudou**, como atualizar e há quanto tempo foi a última verificação
(ou "Nunca verificado"). Para atualizar, um comando só:

```bash
npm run atualizar                         # git pull --ff-only, npm install e reinstala o mod em cada conta
npm run atualizar -- --com-permissoes     # as opções vão para o npm run instalar
npm run docker:up                         # depois, reinicie o servidor (ou: npm run build && npm start)
```

O `atualizar` recusa um checkout com alterações nos arquivos versionados e para no primeiro passo que falhar. Ele não
reinicia o servidor.

> Se o `git pull` parar com "Your local changes to the following files would be overwritten by merge:
> package-lock.json", rode `git checkout -- package-lock.json` e repita: até a 0.4.0, o `npm install` alterava esse
> arquivo.

O mod não é atualizado sozinho: o `npm run atualizar` já o reinstala (se você atualizou na mão, com `git pull`, rode
`npm run instalar`; o `docker:up` só lembra, se ele não estiver instalado).

### Desinstalar

```bash
npm run desinstalar                         # tira o mod, o plugin de permissões e o marketplace das contas
npm run docker:down                         # para o container
docker volume rm expediente_expediente-data     # apaga os dados do container (nomes, salas, linha do tempo e estatísticas)
docker image rm expediente:local              # apaga a imagem
rm -rf ~/.expediente                          # apaga os dados locais (uso capturado, nomes, salas, linha do tempo e estatísticas)
```

Depois é só apagar a pasta do projeto — rode o `desinstalar` **antes**, senão o Claude Code das contas passa a
reclamar do marketplace que sumiu. Se você instalou pelo jeito antigo (instaladores que editavam o `settings.json` e
que não existem mais), o tap de statusline e o hook de permissão continuam lá: tire-os da conta à mão
(`statusLine.command` e `hooks.PermissionRequest`). Esses instaladores deixaram cópias
`settings.json.expediente-backup-<data>` na pasta de cada conta (ex.: `~/.claude/`); apague-as se não precisar mais.

## Como usar

### O que cada personagem está fazendo

| Estado | O que você vê |
| --- | --- |
| **Trabalhando** | Na mesa, digitando. O monitor e um balão mostram a atividade: 📖 lendo, ✏️ editando, 💻 terminal, 🧪 testes, 🌐 pesquisando… |
| **Precisa de você** | Corre para a mesa e levanta a mão, com alerta piscando: está esperando uma permissão ou resposta no terminal. |
| **Esperando o shell** | Terminou o turno mas deixou um comando rodando (testes, build, deploy…), então fica na mesa com uma ampulheta virando sobre a cabeça e o terminal em progresso: come pipoca assistindo, depois de 3 min cruza os braços e gira na cadeira, depois de 10 min junta teia de aranha e depois de 25 min cochila; quando o comando termina, levanta e comemora com confete (ou ganha uma nuvem de chuva, se falhou). Depois de 40 s, se houver colegas à toa, pode sair para uma roda — com a ampulheta na cabeça. |
| **Ocioso** | Terminou o turno e passeia: café na copa, bebedouro, banheiro, sofá do lounge, celular no puff, espelho. Com colegas à toa, entra numa roda: TV, videogame, ping-pong, papo na copa, jokenpô (veja [Vida social](#vida-social)). Depois de 10 min parado, cochila — mas um colega pode acordá-lo para uma roda. |
| **Subagente concluído** | Vai até o agente que o chamou, entrega o resultado e sai pelo elevador. |
| **Sessão encerrada** | Vai embora; se era o último da sala, apaga a luz antes de sair. |

Cada personagem tem um **nome brasileiro único** (Marina, Henrique, Luan…) que se mantém enquanto a sessão existir, e
um **chip colorido com a letra da conta** (C, D…).

### Interface

- **Topo:** contadores (salas, agentes, trabalhando, subagentes, shells rodando, precisam de você) e um cartão de
  **uso por conta**. O de shells só aparece enquanto algum comando está rodando; clique nele para ir até quem espera.
  Embaixo do logo ficam a conexão e a versão em uso, que vira o selo **Nova versão** quando o `versao.json` do host
  indica uma release maior (veja [Atualizar](#atualizar)).
- **Painel lateral:** busca, filtro por conta e a lista de salas com seus agentes e subagentes.
- **Gaveta de detalhes:** clique num personagem (no prédio ou na lista) para ver atividade, tarefas, subagentes,
  linha do tempo e estatísticas (ferramentas, tokens, custo, linhas alteradas, modelo, branch).
- **Feed:** as últimas atividades de todo o escritório.
- **Configurações (⚙):** nomes, balões, quanto os ociosos passeiam e se juntam em rodas (vale para todas as abas), ciclo dia/noite, sons, notificações do navegador,
  modo demonstração e **Sobre** (versão em uso, versão nova, link do que mudou e última verificação). **Ajuda (?):** legenda completa e atalhos.
- **Meu dia (📊):** para onde foi o tempo do dia (veja [Meu dia](#meu-dia)). **Timelapse** e **Histórico** (os relógios
  da barra superior): veja [Timelapse do dia](#timelapse-do-dia) e [Terminal somente leitura](#terminal-somente-leitura).

**Câmera:** arraste para mover, role para dar zoom, clique duplo num personagem para segui-lo.

**Atalhos:** `/` busca · `F` seguir o selecionado · `T` terminal · `L` timelapse · `M` meu dia · `P` próximo pedido
de permissão · `O` ou `0` visão geral · `Esc` limpar seleção · `[` painel lateral · `]` feed · setas/`WASD` mover ·
`+` `-` zoom · `?` ajuda.

### Dia, noite e sons

O escritório acompanha a **hora local**: de madrugada e à noite o gramado e a rua ficam azulados e escuros, os postes,
os abajures, as máquinas e os monitores ligados acendem halos de luz, as salas com gente ficam iluminadas (a luz que
apaga quando a sala esvazia continua valendo), os carros passam de farol aceso e aparecem vaga-lumes no jardim. No
amanhecer (~5–7 h) e no entardecer (~17–19 h) tudo ganha um tom quente, e durante o dia o sol entra pelas janelas e
desenha faixas de luz no piso — curtas ao meio-dia, longas e alaranjadas no fim da tarde. Em **Configurações › Ciclo
dia/noite** dá para escolher automático, sempre dia ou sempre noite; para testar um horário, use `?hora=21:30` na URL.

Os **sons** vêm desligados. Ligados em **Configurações › Sons**, são sintetizados no próprio navegador (sem arquivos
de áudio) e baixinhos: o teclado de quem trabalha nas salas à vista, o "ding" do elevador quando alguém chega ou vai
embora, o sino quando alguém precisa de você, o estalo de tarefa concluída e o pingue-pongue e o fliperama das rodas.
Há volume geral e cada categoria liga e desliga à parte. Com a aba oculta, só o sino toca.

### Tema do escritório

Em **Configurações › Aparência › Tema do escritório** dá para decorar o escritório: **Automático** mantém o visual
original (não há troca por data), **Natal** e **Halloween** vestem os personagens, enfeitam paredes, tapetes, plantas e
elevadores e põem neve nas janelas (a neve para com movimento reduzido). A troca é imediata e fica salva só neste
navegador; caminhos, atividades e animações dos agentes não mudam, e o ciclo dia/noite segue independente. As cores
da decoração são o bloco `paleta.sazonal` do `tema.json`; um tema de marca sem ele usa o do tema padrão.

### Terminal somente leitura

Clique num agente e use **Abrir terminal** para ver a conversa da sessão como o Claude Code mostra: os prompts, as
respostas, cada ferramenta chamada (com o comando ou o diff) e o resultado, atualizados ao vivo. É só para ler: não
dá para digitar nem interferir no agente. Vale para agentes principais e subagentes; no modo demonstração, a conversa
é fictícia.

- **Busca:** com o terminal em foco, `Ctrl+F` (`⌘F` no Mac) ou a lupa do cabeçalho abre a busca na conversa, sem
  diferenciar maiúsculas nem acentos. O contador mostra a posição ("3/17"); `Enter` e `Shift+Enter` vão para o próximo
  e o anterior, abrindo os blocos recolhidos ("… +N linhas") onde o termo estiver. A busca continua valendo enquanto
  chegam mensagens novas. `Esc` fecha a busca; o seguinte fecha o terminal.
- **Filtro:** **Tudo**, **Só prompts** (os seus prompts e as respostas finais do agente, sem os passos intermediários)
  ou **Sem ferramentas**.
- **Copiar:** passe o mouse (ou o foco) sobre um prompt, uma resposta, um comando ou um resultado para copiá-lo.
- **Histórico:** o relógio da barra superior lista as sessões dos últimos 7 dias de todas as contas (até 150), agrupadas
  por dia, com busca por título, projeto ou conta. Uma sessão encerrada abre no terminal com projeto, título e data no
  cabeçalho e "Sessão encerrada às …" no rodapé; uma sessão ainda aberta abre o terminal ao vivo do agente.

Como o terminal (e o histórico) mostra a conversa inteira, o Expediente só é acessível **pelo próprio computador** e o terminal só abre por `http://localhost` ou `http://127.0.0.1`. Com a porta liberada para a rede
Detalhes em [Privacidade e segurança](#privacidade-e-segurança).

### Timelapse do dia

O botão **Timelapse** (relógio com a seta de voltar, ou a tecla `L`) reproduz o dia em alta velocidade: salas
acendendo e apagando, agentes chegando, trabalhando, esperando você, indo para as rodas, subagentes entrando e saindo.
A barra de reprodução tem o dia, play/pausa, a velocidade (60×, 180× ou 600×: um dia de 10 h em 10, 3⅓ ou 1 min),
a linha do tempo arrastável com o gráfico de quem estava presente e trabalhando, as marcas dos picos (clique para
pular até lá) e **Voltar ao vivo**. Enquanto isso, o escritório fica levemente sépia, com o selo **REPLAY 14:32**, e o
feed continua mostrando o que acontece agora.

O servidor grava a linha do tempo **a partir do momento em que está ligado** (não dá para reconstruir o passado):
resumos do que o escritório mostra, sem conversas, em `~/.expediente/timeline/` (no Docker, no volume de dados), com
limite de tamanho por dia e os últimos **7 dias** guardados. Para não gravar: `EXPEDIENTE_TIMELINE=0`. Detalhes em
[`server/README.md`](server/README.md#linha-do-tempo-timelapse).

Os personagens andam mais rápido no replay, mas nas velocidades altas quem fica pouco tempo no escritório quase não
chega à mesa; pular para outro ponto mostra todos já no lugar.
### Responder pelo escritório

Com o plugin de permissões instalado (`npm run instalar -- --com-permissoes`), quando um agente pede permissão — rodar um comando, editar um arquivo, abrir
uma página — o pedido aparece no escritório: o personagem levanta a mão, um aviso com **Responder**
surge na tela e, nos detalhes do agente, o cartão **Pede permissão** mostra o comando (ou o diff da edição) com os
botões:

- **Aprovar** — e, quando o Claude Code sugere, **Aprovar e não perguntar de novo** (a mesma regra que o terminal
  ofereceria, por exemplo `Bash(npm test:*)` neste projeto);
- **Recusar** — com um motivo opcional, que vai para o agente, e a opção de interrompê-lo;
- **Responder no terminal** — o Expediente deixa o pedido de lado.

O diálogo continua aparecendo no terminal ao mesmo tempo, e vale o que você responder primeiro: respondeu no
terminal, o pedido some do escritório sozinho. O contador **precisam de você** (e a tecla `P`) leva até cada pedido.
As perguntas do agente (`AskUserQuestion`) chegam do mesmo jeito: o cartão **Pergunta para você** mostra as opções de
cada pergunta e o campo **Outro**, e **Responder** manda as respostas ao agente.

- O pedido passa por um hook `PermissionRequest` do Claude Code (o do plugin), que só o desvia
  quando há **alguma página do Expediente aberta** neste computador; com o Expediente parado ou sem nenhuma página, ele
  sai na hora e o terminal segue normal.
- Sem resposta pelo escritório em 5 minutos, o pedido volta a valer só no terminal (as opções do plugin estão em
  [`mod/README.md`](mod/README.md)). Em **subagentes em segundo plano** o Claude Code só mostra o diálogo no terminal depois que o
  hook termina: responda pelo escritório ou use **Responder no terminal**.
- Funciona com a mesma trava do terminal somente leitura: só com o Expediente acessível apenas pelo próprio
  computador e aberto por `http://localhost`. Confira com `npm run instalar:status`.
- No modo demonstração, os agentes fictícios também pedem permissão (de mentira), para experimentar.

### Editar o personagem

Cada sessão chega com um nome e uma aparência sorteados. Para fixar o personagem de um projeto, abra os detalhes do
agente principal e clique no lápis ao lado do nome (**Editar personagem**). No editor:

- **Nome:** até 24 caracteres. Não pode repetir o de alguém que está no escritório nem o escolhido para outro
  projeto.
- **Sortear:** traz outra aparência.
- **Peças:** pele, cabelo, barba, olhos, parte de cima, parte de baixo, sapatos e acessório, com a prévia ao lado.
- **Salvar:** vale para o projeto (a sala). A próxima sessão aberta nele chega com esse personagem. Com duas sessões
  ao mesmo tempo na mesma sala, a segunda recebe um personagem sorteado.
- **Voltar ao sorteio:** desfaz a escolha.

A escolha fica em `~/.expediente/names.json` e some depois de 60 dias sem uso do projeto. O editor tem a mesma trava do
terminal somente leitura: o lápis só aparece com o terminal ligado (sem `EXPEDIENTE_TERMINAL=0`) e o acesso local, isto
é, com o Expediente acessível apenas pelo próprio computador e aberto por `http://localhost`.

### GitHub no escritório

O que os agentes fazem no GitHub anima a sala do projeto, sem token e sem acessar a internet: o Expediente lê nos
transcripts as chamadas (`gh pr create`, `gh pr merge`, `git push`, `gh run watch`, `gh pr checks`, `gh run view`,
`gh release create` e as ferramentas do MCP do GitHub) e os resultados delas.

| Evento | O que acontece |
| --- | --- |
| 🎉 **PR aberto ou mergeado, release publicada** | Confete cai na sala, todos comemoram com pulinhos e uma faixa diz o motivo ("PR #12 mergeado!") por ~12 s. |
| 🚨 **CI vermelho** | Giroflex piscando nos cantos da sala, chão avermelhado e um balão "!" sobre quem viu a falha, até um CI verde na sala (que vira festa) ou por 10 min. |
| 🚀 **Push** | Só o aviso e o feed. |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/github-party.png" alt="Sala app-mobile em festa: confete caindo, a faixa dourada 'PR #12 mergeado!' e Jéssica de pé com os braços para cima e uma estrela sobre a cabeça" /></td>
    <td width="50%"><img src="docs/screenshots/github-alarm.png" alt="Sala data-pipeline em alarme: chão avermelhado, faixa vermelha 'CI falhou (feat/checkout)', giroflex nos cantos de cima e um balão '!' vermelho ao lado de Ícaro" /></td>
  </tr>
</table>

Cada evento também gera um aviso ("🎉 Danilo abriu o PR #12 em expediente", "🚨 CI falhou em expediente (feat/x)") e entra
no feed. Só o que acontece ao vivo anima a sala: o que já estava nos transcripts quando o Expediente abriu vai só para o
histórico. Com "reduzir movimento" ligado no sistema, nada pisca nem gira. No modo demonstração, PRs, merges e CIs
fictícios aparecem de tempos em tempos.
### Meu dia

O botão **Meu dia** (ou a tecla `M`) mostra para onde foi o dia: quanto tempo os agentes passaram trabalhando e,
em destaque, quanto tempo ficaram **esperando você** (permissão, pergunta ou escolha) — com a maior espera, quem
esperou, onde e quando. Ao lado, sessões, subagentes, pedidos, tokens e custo (quando o Claude Code grava o custo no
transcript), e gráficos por hora, por projeto (do que mais esperou você para o que menos esperou) e por conta, além
do ranking das maiores esperas. Escolha o dia no seletor (o Expediente guarda os últimos 30); aberto no dia de hoje,
o painel se atualiza a cada 30 s. Cada gráfico tem uma versão em tabela, e a legenda liga e desliga cada status.

O tempo é **tempo de agente**: dois agentes trabalhando por uma hora contam duas horas. O Expediente só conta o que
acontece enquanto ele está rodando, e o dia segue o fuso do seu navegador. Com o modo demonstração ligado, o painel
mostra números fictícios (com o selo "demonstração") e deixa alternar para os dados reais; os agentes do demo nunca
entram nas estatísticas de verdade.

### Modo demonstração

Quer ver o escritório cheio sem ter sessões abertas?

- Acrescente **`?mock=1`** à URL (ex.: http://localhost:4848/?mock=1) para simular tudo no navegador, sem as suas
  sessões reais. Parâmetros: `&speed=3` acelera o tempo e `&sessions=6` muda o número de sessões simuladas.
- Ou ligue pela interface — **Ver demonstração** (quando o escritório está vazio) ou **Configurações › Modo
  demonstração** —, que coloca agentes fictícios junto com os reais. Com `npm run demo` (ou `EXPEDIENTE_DEMO=1` no
  `.env` do Docker), esse modo já começa ligado.

## Contas e uso (5 horas e semanal)

Se você usa mais de uma conta do Claude Code (por exemplo, um atalho `c` com `~/.claude` e um `d` com
`CLAUDE_CONFIG_DIR=~/.claude-conta2`), o Expediente mostra todas juntas: cada agente leva o chip da sua conta e o topo
mostra, para cada conta, o **percentual usado** da sessão de 5 horas e da semana e **quando cada limite reinicia**.

**Como as contas são reconhecidas.** Cada pasta de configuração do Claude Code é uma conta: `~/.claude` e qualquer
`~/.claude*` com `projects/` ou `sessions/` (além de `CLAUDE_CONFIG_DIR`). Para dar a letra de cada uma, o Expediente
lê nos arquivos do shell (`~/.zshrc`, `~/.bashrc`…) **somente** as linhas `alias x='... claude ...'`:

```bash
alias c='claude'
alias d='CLAUDE_CONFIG_DIR=~/.claude-conta2 claude'
```

vira **Conta C** e **Conta D**. Só valem atalhos de até 3 letras; contas sem atalho recebem A, B…

**De onde vêm os números.** O jeito recomendado é o mod do Expediente (`npm run instalar`, Claude Code 2.1.287+):
dentro de cada sessão, ele recebe do próprio Claude Code os limites do plano e guarda só os percentuais de 5 horas e
da semana (e quando reiniciam) em `~/.expediente/host/uso/<conta>.json`. Os números chegam depois da próxima resposta de
cada conta. Confira com `npm run instalar:status`.

<details>
<summary><b>Detalhes do que o mod grava e do cache do /usage</b></summary>

- O mod grava **somente** `{accountId, configDir, fetchedAt, five_hour, seven_day}` — nada de prompts, custos ou
  caminhos de projeto. Qualquer falha na captura é ignorada: a sessão nunca quebra por causa do Expediente.

| Fonte | Como funciona |
| --- | --- |
| **Mod do Expediente** (recomendado) | Ao vivo, como descrito acima. |
| Cache do `/usage` (sempre ligado) | O Claude Code grava o último resultado do comando `/usage`. No modo Node, o Expediente relê a cada 60 s; no Docker, vale o valor lido no último `npm run docker:up`. Só muda quando alguém roda `/usage`. |

As fontes são arquivos locais: nenhuma lê senhas ou tokens, nem faz chamadas de rede. Vale sempre a fonte com os
números mais recentes. Números com mais de 30 minutos aparecem como **desatualizados**; uma janela que já reiniciou
desde a coleta aparece como **—** até chegarem números novos.

</details>

## Configuração

Tudo funciona sem configurar nada. Se precisar ajustar, use variáveis de ambiente:

| Variável | Padrão | Para quê |
| --- | --- | --- |
| `EXPEDIENTE_PORT` | `4848` | Porta HTTP no modo Node. No Docker a porta é fixa: `127.0.0.1:4848`. |
| `EXPEDIENTE_CLAUDE_DIRS` | detecção automática | Pastas das contas, separadas por vírgula (ex.: `/caminho/conta1,/caminho/conta2`). |
| `EXPEDIENTE_DATA_DIR` | `~/.expediente` | Onde o Expediente guarda os próprios dados (nomes dos personagens e das salas, linha do tempo do timelapse e estatísticas do Meu dia). |
| `EXPEDIENTE_TIMELINE` | ligado | `0` desliga a gravação da linha do tempo (os dias já gravados continuam no timelapse). No Docker fica sempre ligado. |
| `EXPEDIENTE_USAGE_DIR` | `~/.expediente/host/uso` | Onde o mod (ou o tap de statusline) grava o uso. |
| `EXPEDIENTE_DEMO` | desligado | `1` liga o modo demonstração ao iniciar. |
| `EXPEDIENTE_TERMINAL` | ligado | `0` desliga o terminal somente leitura. |
| `EXPEDIENTE_ACCOUNTS` | — | JSON para personalizar nome, letra ou cor, casado pelo nome da pasta da conta. Ex.: `[{"id":".claude-conta2","name":"Trabalho","short":"T","color":"#5cc97b"}]`. |

**No Docker**, valem `EXPEDIENTE_DEMO` e `EXPEDIENTE_TERMINAL` (no `.env` ou no ambiente) e `EXPEDIENTE_CLAUDE_DIRS`, `EXPEDIENTE_USAGE_DIR` e `EXPEDIENTE_ACCOUNTS` (lidas pelo `docker:up`
no host); as demais ficam fixas dentro do container. Opções: `npm run docker:up -- --no-build` (sobe sem reconstruir),
`npm run docker:down` (para) e `npm run docker:logs` (acompanha os logs).

## Como funciona

```
 ~/.claude*/sessions/<pid>.json ─────────────────┐
 ~/.claude*/projects/<projeto>/<sessão>.jsonl ───┼──▶ servidor Node ──▶ modelo do escritório ──▶ SSE ──▶ navegador
 .../<sessão>/subagents/**/agent-*.jsonl ────────┘    (polling de 1 s)                                 (canvas + interface)
```

- **Quem está no escritório:** enquanto uma sessão está aberta, o Claude Code mantém `sessions/<pid>.json` com o
  projeto e o status (ocupado, ocioso, esperando você ou esperando um shell em segundo plano). É isso que decide
  quem aparece e o que cada um faz.
- **Shells rodando:** nos transcripts, cada `Bash` em segundo plano (ou comando longo em primeiro plano) vira um
  "shell" com rótulo e cronômetro, até chegar a notificação de que terminou, falhou ou foi interrompido.
- **Vida social:** as rodas, as personalidades e as moedinhas são simulação, sem nenhum efeito nos agentes de verdade.
  O servidor decide quem entra em que roda, quando e com que resultado (`shared/social/agenda.ts`) e manda as rodas e
  as carteiras no snapshot; cada aba só anima (`client/src/world/social/`), então duas abas mostram a mesma roda e o
  mesmo saldo, que também aparece no `/escritorio` do mod. O ritmo (Configurações › Movimento pelo escritório: Calmo,
  Normal ou Agitado) também é do servidor e muda a frequência das rodas e dos passeios em todas as abas; sem servidor
  (simulação, timelapse) vale só na aba. Carteiras e ritmo ficam em `social.json`, na pasta de dados. A personalidade
  sai da semente de cada agente (é a mesma em qualquer navegador).
- **O que cada um está fazendo:** o servidor acompanha o fim dos transcripts (`.jsonl`) das sessões abertas e traduz
  cada chamada de ferramenta numa atividade em português, com ícone. Dali também saem tarefas, título, modelo e
  estatísticas.
- **Subagentes:** os transcripts em `<sessão>/subagents/` (inclusive os de workflows) viram personagens ligados ao
  agente que os chamou.
- **GitHub:** PRs, pushes, CI e releases saem das mesmas linhas do transcript (o comando e a saída dele, ou o
  `gitOperation` que o próprio Claude Code grava); nada é consultado no GitHub.
- **O desenho:** o navegador recebe o estado por SSE e desenha tudo num canvas — personagens, móveis, pisos e paredes
  são pixel art **gerada por código**; já o logotipo, as ilustrações e os quadros das paredes foram gerados com IA.

<details>
<summary><b>Estrutura do código e API</b></summary>

```
shared/   protocolo (types.ts), atividades em PT-BR, nomes, simulador de demonstração
server/   servidor HTTP + SSE: contas e uso, leitura das sessões e transcripts, modelo do escritório
client/   Vite: src/art (pixel art procedural), src/world (o escritório no canvas), src/ui (interface)
scripts/  build do servidor, docker-up, instaladores (mod, tap de statusline e hook de permissão) e screenshots
mod/      o mod do Expediente e o plugin de permissões (plugins do Claude Code; marketplace em .claude-plugin/)
```

| Rota | Descrição |
| --- | --- |
| `GET /api/stream` | SSE com os eventos `snapshot`, `feed` e `notice` (formato em `shared/types.ts`). |
| `GET /api/snapshot` | Estado atual do escritório. |
| `GET /api/agents/:id` | Detalhes de um agente, com até 200 atividades. |
| `GET /api/agents/:id/terminal` | SSE do terminal somente leitura (eventos `init` e `append`); só com acesso local. |
| `PUT /api/agents/:id/character` | Editar o personagem: `{name, seed, parts}` grava o nome e a aparência do agente principal como o personagem do projeto (a sala); só com acesso local. |
| `DELETE /api/agents/:id/character` | "Voltar ao sorteio": apaga o personagem do projeto e o agente volta ao nome sorteado; só com acesso local. |
| `GET /api/sessions/recent` | Histórico: sessões dos últimos 7 dias de todas as contas (até 150); só com acesso local. |
| `GET /api/sessions/:conta/:sessionId/terminal` | SSE da conversa de uma sessão do histórico (mesmo protocolo do terminal); só com acesso local. |
| `GET /api/stats?day=AAAA-MM-DD` | Estatísticas do Meu dia (tempo por status, projetos, contas, horas, esperas, tokens e custo). |
| `GET /api/stats/days` | Dias com estatísticas (os últimos 30). |
| `GET /api/timeline/days` | Dias gravados para o timelapse, com tamanho e horário do primeiro e do último registro. |
| `GET /api/timeline/:dia` | Linha do tempo de um dia (`AAAA-MM-DD`), em JSONL (com gzip). |
| `GET /api/health` | Saúde: versão, demonstração, Docker, terminal, responder pelo escritório, fontes e status de uso de cada conta. |
| `POST /api/demo` | `{"enabled": true \| false}` liga ou desliga os agentes simulados. |
| `POST /api/rooms/rename` | `{"id": sala, "name": nome}` renomeia a sala (vazio volta ao nome da pasta); o nome fica em `rooms.json`, na pasta de dados. Só com acesso local. |
| `POST /api/social/ritmo` | `{"ritmo": "calm" \| "normal" \| "lively"}` muda o ritmo do escritório para todas as abas; fica em `social.json`, na pasta de dados. Só com acesso local. |
| `GET /api/mod/summary` | Para o mod do Claude Code: versão, quantos agentes, quantos trabalham e quem precisa de você (sem o demo e, com `?account=&session=`, sem a própria sessão). |
| `/api/permissions…` | Responder pelo escritório: o hook de permissão registra o pedido e espera; a página busca o detalhe e decide. Só com acesso local. |

Mais detalhes do servidor em [`server/README.md`](server/README.md).

</details>

<details>
<summary><b>O que o Docker monta e por quê</b></summary>

| Host | Container | Para quê |
| --- | --- | --- |
| `<conta>/sessions/` | `/claude/<conta>/sessions` (somente leitura) | Sessões abertas e seus status. |
| `<conta>/projects/` | `/claude/<conta>/projects` (somente leitura) | Transcripts das sessões e dos subagentes. |
| `~/.expediente/host/` | `/host` (somente leitura) | Ponte do mod; o uso ao vivo é lido de `/host/uso`. |
| volume `expediente-data` | `/data` | Dados do próprio Expediente (nomes dos personagens, carteiras da vida social, linha do tempo do timelapse e estatísticas do Meu dia). |

Todo bind do host é somente leitura. A pasta da conta **nunca** é montada inteira (lá ficam credenciais e configurações). O container roda como usuário sem
privilégios, com sistema de arquivos somente leitura, sem capabilities extras e com `no-new-privileges`. Os metadados
das contas (letra, e-mail, organização) são lidos no host pelo `docker:up` e passados ao container.

</details>

## Privacidade e segurança

- **Só leitura:** o Expediente nunca grava nas pastas do Claude Code. A exceção é o instalador, que você roda:
  o `npm run instalar` / `desinstalar` usa só o próprio `claude plugin` (que registra o marketplace e os plugins
  no `settings.json` e em `<conta>/plugins/`); o Expediente nunca edita o `settings.json` por conta própria, e um teste
  falha se algum arquivo do repositório passar a gravar nele.
- **O mod:** roda dentro de cada sessão do Claude Code, com as suas permissões (como todo mod), e faz só o que está
  listado em [`mod/README.md`](mod/README.md) — `claude plugin validate mod/expediente` mostra os eventos e as chamadas,
  sem rodar nada. Grava só os percentuais de uso de 5 horas e da semana (e quando reiniciam) em
  `~/.expediente/host/uso/<conta>.json`; para a linha de "precisa de você" e o `/escritorio`, só fala com o Expediente em
  `127.0.0.1`. Não lê a conversa, não chama o modelo e não envia nada para fora do computador. Ele é lido desta
  pasta: o que estiver nela (inclusive depois de um `git pull`) é o que roda.
- **Só local, por padrão:** o servidor só aceita conexões do próprio computador e não há opção para liberar a rede.
  Não há telemetria, e o servidor não faz nenhuma chamada de rede de saída (há um teste que proíbe módulo de rede em
  `server/` e `shared/`). A única consulta externa é o `npm run versao`, que você roda no seu computador, por opção:
  uma chamada anônima, sem token, à API pública do GitHub (`api.github.com/repos/isdiegoalves/expediente-ia/releases/latest`).
  Ela não envia nada sobre as suas sessões; o GitHub vê só o seu IP e o `User-Agent` `expediente-versao`.
- **Sem credenciais:** o Expediente não lê senhas nem tokens de acesso. Do `.claude.json` de cada conta aproveita só o
  e-mail, a organização e o cache do `/usage`; o uso ao vivo vem do mod (ou do tap de statusline).
- **Segredos mascarados:** tokens e senhas com formato conhecido (`Bearer`, `-u usuário:senha`, `TOKEN=`, chaves
  `sk-…`, `ghp_…`, `AKIA…`, JWTs, senhas em URLs) viram `***` antes de chegar ao navegador.
- **Protegido contra sites maliciosos:** o servidor recusa endereços que não sejam `localhost`/IP (DNS rebinding) e
  `POST` vindos de outras origens (CSRF), e não deixa a página ser embutida em outros sites.
- **Terminal somente leitura só local:** a conversa completa das sessões (e o histórico das sessões encerradas, com os
  títulos) só sai do servidor com o Expediente acessível apenas pelo próprio computador (127.0.0.1 no Node; porta publicada
  só em 127.0.0.1 no Docker, sem variável que mude isso) e cada pedido precisa vir por `localhost`/`127.0.0.1`: IPs
  da rede e pedidos com `X-Forwarded-For` de fora do loopback são recusados. Segredos são mascarados e textos longos truncados antes
  de chegar ao navegador; no modo demonstração, a conversa é fictícia. `EXPEDIENTE_TERMINAL=0` desliga de vez.
- **Linha do tempo do timelapse:** só os resumos que já aparecem na tela (atividade em uma linha, status, títulos,
  uso das contas, sem e-mails, comandos completos ou conversas), gravados em `~/.expediente/timeline/` e apagados depois
  de 7 dias. `EXPEDIENTE_TIMELINE=0` desliga a gravação.
- **Responder pelo escritório, só local:** aprovar ou recusar age sobre as sessões, então segue a mesma trava do
  terminal (bind local, `Host` local, nada de proxies ou túneis) e só existe com o hook de permissão (o do plugin
  `expediente-permissoes` ou o do jeito antigo) instalado por você. As respostas exigem JSON e origem local (um site
  aberto no navegador não consegue mandá-las), o hook só fala com `127.0.0.1` e, na dúvida — Expediente fora do ar,
  erro, tempo esgotado —, sai sem decidir: vale o terminal. O comando completo ou o diff só saem do servidor para
  quem abriu a página pelo próprio computador. "Sempre permitir" só aplica uma regra que o próprio Claude Code sugeriu
  para aquele pedido. Atenção: qualquer programa ou pessoa que consiga abrir `http://localhost:4848` nesta máquina
  também consegue responder; em computadores compartilhados com outros usuários, não instale o plugin de
  permissões (ele só entra com `npm run instalar -- --com-permissoes`).
- **Editor de personagem, só local:** salvar ou voltar ao sorteio muda o escritório e grava em `names.json`, então
  segue a mesma trava do terminal (bind local, `Host` local, nada de proxies ou túneis): sem ela, o lápis não aparece
  e o servidor responde `403`. As mudanças exigem JSON e origem local. `EXPEDIENTE_TERMINAL=0` desliga junto.
- **Estatísticas do Meu dia:** só números agregados (tempo por status, contagens, tokens, custo) com nomes de projeto,
  conta e agente, guardados em `EXPEDIENTE_DATA_DIR/stats/` por 30 dias — nada da conversa.
- **O que aparece na tela:** resumos das atividades (ferramenta, arquivo, comando ou consulta), títulos das sessões,
  tarefas e estatísticas (e, no terminal somente leitura, a conversa). Não exponha a porta em redes em que você não
  confia.

## Desenvolvimento

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor + Vite em http://localhost:4848, com recarga automática. |
| `npm run dev:client` | Só o Vite, em http://localhost:5848 (abra com `?mock=1`; `/api` é repassado para a porta 4848). |
| `npm run demo` | `npm run dev` com o modo demonstração ligado. |
| `npm run build` / `npm start` | Compila e roda a versão de produção. |
| `npm test` | Testes (Vitest). |
| `npm run typecheck` | Verificação de tipos de cliente, servidor e scripts. |
| `claude plugin test mod/expediente` | Testes do mod (sem sessão, conta nem rede). |
| `claude plugin validate .` | Valida o marketplace (`.claude-plugin/marketplace.json`); com `mod/expediente` ou `mod/expediente-permissoes`, valida o plugin e lista os eventos e as chamadas do mod. |
| `claude --plugin-dir mod/expediente` | Abre uma sessão com o mod desta pasta, sem instalar (edite e rode `/reload-plugins`). |
| `npm run atualizar` | Atualiza num comando: `git pull --ff-only`, `npm install` e reinstala o mod em cada conta. |
| `npm run instalar:status` | Mostra, por conta, o marketplace, os plugins e as versões instaladas. |
| `npm run demo:timeline` | Gera uma linha do tempo fictícia (simulador do modo demonstração) para o timelapse. |
| `npm run release` | Publica a versão do `package.json` no GitHub (tag e release com as notas do `CHANGELOG.md`). |

Para tirar screenshots sem abrir o seu navegador, `scripts/shot.mjs` usa um Chromium headless isolado (Playwright).
Na primeira vez, baixe o navegador (uma vez só): `npx playwright-core install chromium-headless-shell`.

```bash
node scripts/shot.mjs 'http://localhost:4848/?mock=1&speed=3' /tmp/expediente.png --size 1400x900 --wait 4000
```

No console do navegador, `expediente.world.debug` tem ferramentas para testar cenas (ex.:
`expediente.world.debug.setHour(21)` para ver a noite). Para fixar a hora já ao abrir, use `?hora=21:30` na URL.

**Timelapse só com dados fictícios** (ex.: para gravar um GIF): `npm run demo:timeline` roda o simulador do modo
demonstração offline e grava um dia inteiro (por padrão, ontem das 9h às 19h, com manhã cheia, almoço mais vazio e
pico à tarde) em `<tmp>/expediente-demo/timeline/`. Depois suba um Expediente que só leia essa pasta e não mostre as suas
sessões, e abra o Timelapse:

```bash
npm run demo:timeline -- --data-dir /tmp/expediente-demo        # opções: --date, --start 8:30, --hours, --sessions, --seed
mkdir -p /tmp/expediente-demo/vazio
EXPEDIENTE_DATA_DIR=/tmp/expediente-demo EXPEDIENTE_TIMELINE=0 EXPEDIENTE_CLAUDE_DIRS=/tmp/expediente-demo/vazio \
  EXPEDIENTE_PORT=4848 npm start                                 # depois de npm run build; abra http://localhost:4848
```

`EXPEDIENTE_TIMELINE=0` evita gravar nessa pasta; com a gravação ligada, dias com mais de 7 dias são apagados.

**Publicar uma versão:** toda versão tem a sua seção no [`CHANGELOG.md`](CHANGELOG.md), com o que entrou. Durante o
trabalho, anote as mudanças em "Não lançado". Para lançar:

1. Suba o número com `npm version minor --no-git-tag-version` (ou `patch`, numa versão só de correções).
2. Troque "Não lançado" pela versão e a data (`## [0.3.0] - AAAA-MM-DD`), deixe um "Não lançado" vazio em cima e
   atualize os links do fim. O `npm test` falha se a versão do `package.json` não tiver seção.
3. Faça o merge na `main` e rode `npm run release` (precisa do [`gh`](https://cli.github.com/) autenticado; `-- --dry-run`
   só mostra as notas). O script cria a tag `v0.3.0` e a release com o texto da seção. A partir daí, quem rodar
   `npm run versao` passa a ver o selo **Nova versão**.

## Solução de problemas

<details>
<summary><b>O escritório está vazio</b></summary>

Só aparecem sessões **abertas** do Claude Code. Confira se há alguma rodando e se a conta foi detectada em
`http://localhost:4848/api/health`. Se as pastas das contas estiverem em outro lugar, use
`EXPEDIENTE_CLAUDE_DIRS=/caminho/conta1,/caminho/conta2`.

</details>

<details>
<summary><b>O uso aparece como "sem dados" ou "desatualizado"</b></summary>

Rode `npm run instalar` e confira com
`npm run instalar:status`. Os números chegam depois da próxima resposta numa sessão aberta
daquela conta; numa sessão aberta antes da instalação, rode `/reload-plugins` ou reabra a sessão. Um **—** no lugar
do percentual quer dizer que a janela reiniciou desde a última coleta.

</details>

<details>
<summary><b>O mod não carrega numa sessão</b></summary>

Rode `npm run instalar:status`: ele mostra a versão do Claude Code (o mod precisa da 2.1.287 ou mais nova) e, por conta,
se o marketplace aponta para a cópia fixa e se os plugins estão instalados e ligados. Numa sessão aberta antes da
instalação, rode `/reload-plugins`; o `/plugin` mostra, embaixo das abas, os mods carregados (ex.:
`1 mod active · expediente`). Mods não rodam com `"disableAllHooks": true` no `settings.json` da conta nem com
`claude --safe-mode`.

</details>

<details>
<summary><b>"A porta 4848 já está em uso"</b></summary>

Outro Expediente (Node ou Docker) já está rodando. Pare-o (`npm run docker:down`, ou Ctrl+C no terminal do
`npm start`) ou use outra porta no modo Node: `EXPEDIENTE_PORT=4849 npm start`.

</details>

<details>
<summary><b>O terminal somente leitura não abre</b></summary>

Confira se o `.env` não tem
`EXPEDIENTE_TERMINAL=0` e abra por
`http://localhost:4848` (pelo IP da rede ele é recusado). No Docker, um container
criado antes desse recurso precisa ser recriado: `npm run docker:up`. O log de inicialização (`npm run docker:logs`)
diz se o terminal está ligado e, se não estiver, por quê.

</details>

<details>
<summary><b>O pedido de permissão não aparece no escritório</b></summary>

Rode `npm run instalar:status`: ele diz, por conta, se o plugin `expediente-permissoes` está instalado e ligado e se o
Expediente está respondendo pedidos. O pedido só é desviado com alguma
página do Expediente aberta por `http://localhost` (ou `127.0.0.1`) e com o terminal somente leitura ligado (mesma
trava). Sessões abertas antes da instalação carregam o plugin com `/reload-plugins` (ou ao reabrir). As perguntas do
agente (`AskUserQuestion`) passam pelo mesmo hook e dependem das mesmas condições.

</details>

<details>
<summary><b>No Docker, uma sessão fechada continua no escritório</b></summary>

Acontece se o Claude Code foi encerrado à força sem apagar o próprio registro em `sessions/` (no Docker não dá para
conferir se o processo ainda existe). Rodando com Node (`npm start`), o Expediente confere os processos e isso não
acontece.

</details>

<details>
<summary><b>No Docker, uma conta fora de /Users não aparece</b></summary>

O Docker Desktop só compartilha algumas pastas do Mac com os containers (por padrão `/Users`, `/Volumes`, `/private` e
`/tmp`). Adicione a pasta em *Settings › Resources › File sharing*.

</details>

<details>
<summary><b>Quero começar do zero</b></summary>

`npm run docker:down`, depois `docker volume rm expediente_expediente-data` (apaga os nomes guardados) e
`npm run docker:up`.

</details>

## Aviso

O Expediente é um projeto independente, **não afiliado, patrocinado nem endossado pela Anthropic**. "Claude" e
"Claude Code" são marcas da Anthropic, usadas aqui só para descrever com o que o projeto funciona.

Para mostrar os agentes, o Expediente lê apenas arquivos locais que o próprio Claude Code grava na sua máquina
(registros das sessões abertas, transcripts e configurações das contas). Esse formato não é documentado e pode mudar entre versões do Claude Code:
depois de uma atualização, o Expediente pode deixar de funcionar, total ou parcialmente, até ser ajustado.

## Licença

[MIT](LICENSE). As imagens em `client/public/assets` (logotipo, ilustrações, quadros e pôsteres) foram geradas com
IA para este projeto e convertidas em pixel art pelos scripts de `scripts/assets/`.

## Vida social

Quando dois ou mais agentes estão à toa — ociosos, ou esperando um shell há mais de 40 segundos —, eles param de
passear sozinhos e se juntam. Ninguém combina nada: cada personagem tem uma **personalidade**, **amigos** e
**rivais**, e isso decide o que ele prefere fazer, com quem e o que fala. Quem está esperando um shell só sai da mesa
para uma roda (sozinho, continua na pipoca) e leva a ampulheta junto; quando o comando termina — ou quando você manda
um pedido novo para alguém —, ele avisa a turma ("Opa, me chamaram! 🏃") e corre de volta para a mesa.

<p align="center">
  <img src="docs/screenshots/social-lounge.gif" width="816" alt="Lounge do Expediente com três rodas ao mesmo tempo: três colegas no sofá vendo futebol na TV (a tela pisca GOL), uma partida de pingue-pongue com torcida e um duelo nos fliperamas com provocações nos balões" />
</p>

### As rodas

| | Roda | O que acontece |
| --- | --- | --- |
| 📺 | **TV no lounge** | Futebol, novela ou desenho, com pipoca no sofá. No futebol a torcida comemora junto com o "GOL" que pisca na tela (ou lamenta o gol do adversário); na novela, coraçõezinhos e "Não acredito! 😱". Quem é de sonecas acaba dormindo no sofá. |
| 🎮 | **Videogame** | Dois no sofá com o controle, a TV em tela dividida (corrida ou luta), melhor de 3, provocações ("Que lag é esse?!") e torcida. |
| 👾 | **Fliperama** | Duelo nas duas máquinas do lounge, uma partida só. |
| 🏓 | **Pingue-pongue** | Até 5 pontos, com a bolinha indo e voltando, placar nos balões ("3 × 2 🏓") e torcida atrás da mesa. |
| ☕ | **Papo na copa** | Cada um pega um café (ou água) e senta à mesa: fofoca com o nome dos colegas ("Viram o commit de Rafaela? 👀"), piada (a roda gargalha), trabalho ("Deploy na sexta? 😈") e assuntos do dia e da hora ("Sextou! 🎉"). |
| 💬 | **Conversa** | Dois colegas em pé num canto da recepção, da copa ou do lounge. |
| ✊ | **Jokenpô valendo** | "Jo… ken… pô!", os gestos aparecem sobre a cabeça, quem ganha comemora e as moedinhas voam de um para o outro; quem perde fica chateado e, se for competitivo, pede revanche. Empate repete. Quem está passando pode parar para assistir. |
| 💄 | **Espelho do banheiro** | Batom ou pente, com o rosto refletido no espelho e um brilho no final. Vale sozinho ou em dupla ("Empresta o pente?"). |

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/social-rps.png" alt="Jokenpô na recepção: Lia comemora com uma moeda sobre a cabeça e o balão 'Ganhei!', moedinhas voam de Bruna (chateada, com o ícone de pedra) para ela, '+20' e '−20' flutuando, e Iara assiste atrás" /></td>
    <td width="50%"><img src="docs/screenshots/social-kitchen.png" alt="Papo na copa: quatro colegas sentados à mesa comprida com café, com os balões 'Vai dar certo!' e 'Hahaha'" /></td>
  </tr>
  <tr>
    <td><b>Jokenpô valendo moedinhas.</b> A aposta sai da personalidade (quem é de apostas aposta alto, quem é pão-duro aposta pouco) e nunca passa do saldo de quem tem menos.</td>
    <td><b>Papo na copa.</b> Quem fala mais é quem é mais sociável; as reações dependem do assunto (gargalhada na piada, 👀 na fofoca).</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/social-mirror.png" alt="Duas colegas diante das pias do banheiro se arrumando, com os rostos refletidos nos espelhos e o balão 'Tá arrasando!'" /></td>
    <td><img src="docs/screenshots/social-drawer.png" alt="Seção Vida social nos detalhes do agente: 'Vendo novela na TV com Bruna e Iara', 115 moedinhas, 1 vitória e 0 derrotas, os traços Vaidade e Economia, o bordão, amizades, rivalidades com o placar e o extrato" /></td>
  </tr>
  <tr>
    <td><b>No espelho.</b> Quem é de vaidade passa no banheiro sempre que pode — e aparece refletido.</td>
    <td><b>Nos detalhes do agente.</b> O que está fazendo, a carteira, o placar, a personalidade, amizades e rivalidades (com o retrospecto) e o extrato.</td>
  </tr>
</table>

### Personalidades

Cada agente tem 2 ou 3 traços, sorteados pela semente dele (é sempre a mesma pessoa, em qualquer navegador):

🏆 Competição · 🎲 Apostas · 🎮 Games · 📺 Séries e TV · 🗣️ Fofoca · 💄 Vaidade · ☕ Cafeína · 😂 Piadas · 🏓 Esporte ·
🙈 Timidez · 💰 Economia · 😴 Sonecas · 🧘 Calma · 📚 Leitura

Os traços mudam o que cada um escolhe (quem é de séries liga a TV, quem é de esporte chama para o ping-pong), quem
chama (amigos se procuram; rivais se desafiam nos jogos), o que fala e até quem joga melhor. Cada um também tem um
bordão ("Tá pago!", "Bora codar!"). Passe o mouse sobre um traço nos detalhes do agente para ver o que ele faz.

### Moedinhas

Moedinhas fictícias (🪙), só para dar graça às apostas:

| | |
| --- | --- |
| **Chegou ao escritório** | 🪙100 (subagentes, 🪙30) |
| **Tarefa concluída** (item da lista de tarefas) | +🪙10 |
| **Pedido atendido** (fim de turno) | +🪙5 |
| **Subagente entregou o resultado** | +🪙15 |
| **Apostas** (jokenpô; partidas entre rivais ou com quem é de apostas) | o que perder vai para quem ganhar |

Cada ganho aparece como "+🪙10" sobre a cabeça; as partidas e apostas entram no feed de atividade. O saldo, o placar
e o extrato ficam salvos no navegador (cada navegador tem a sua economia: as apostas são sorteadas ali) e são
esquecidos três dias depois de o agente sair.

> Tudo isso é encenação do Expediente: nada muda nos agentes do Claude Code, que continuam trabalhando normalmente.

---

<p align="center">
  Feito com ☕ e muitos agentes do <a href="https://code.claude.com">Claude Code</a>.
</p>
