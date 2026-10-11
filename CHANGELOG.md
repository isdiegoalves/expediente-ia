# Novidades

O que entrou em cada versão do Expediente. Cada versão tem a sua seção aqui, e o texto dela vira as notas da
[release no GitHub](https://github.com/isdiegoalves/expediente-ia/releases) (`npm run release`), que o Expediente abre em
**Configurações › Sobre › Ver o que mudou**.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e os números seguem o
[versionamento semântico](https://semver.org/lang/pt-BR/): correção sobe o último número (0.2.**1**), novidade sobe o
do meio (0.**3**.0).

## [Não lançado]

## [1.2.0] - 2026-10-11

Escala, leveza e retomada: o escritório aguenta dezenas de subagentes sem lotar, gasta menos quando nada acontece, conta
o que mudou enquanto você esteve fora e mostra as mesmas rodas e moedinhas em todas as abas. Para atualizar: `git pull`,
`npm run docker:up` e `npm run instalar` (desta vez o `instalar` é necessário: ele troca a cópia do mod por uma que não
depende do repositório; da próxima em diante, `npm run atualizar` faz o `git pull`, o `npm install` e o `instalar`).

### Adicionado

- **Fan-out sem lotar a sala.** Com mais de oito subagentes numa sala, oito trabalham nas mesas como antes e os demais
  ficam numa roda da equipe, em pé sobre um tapete na cor da sala, com uma placa que conta quantos trabalham, esperam
  você e concluíram; quem espera você sai da roda primeiro. Um clique na roda abre a lista de quem está nela, e o nome
  leva ao subagente. Os balões não se cobrem mais: quem não acha lugar desvia, vira só o ícone ou espera a vez.
  Enquanto a sala está assim, os subagentes dela ficam de fora das rodas dos ociosos (TV, pingue-pongue, copa).
- **Quem espera você, primeiro.** Na lista lateral, quem espera você sobe para o topo (a ordem que você arrastou fica
  guardada), há filtro por estado e as salas se recolhem. No escritório, cada sala mostra um balão só com a contagem
  ("4 precisam de você"), e os avisos chegam agrupados em vez de empilhados; quando quem espera é sessão do app
  desktop, o aviso leva à lista de espera do app.
- **Resumo "desde que você saiu".** Ao voltar à janela depois de 30 minutos fora, abre um painel sem rolagem com
  quantas sessões terminaram, quais travaram (com o erro), quais esperam você e, por sessão, a última tarefa em
  andamento. Também abre pelo botão da barra superior ou pela tecla R, e `/escritorio resumo` no Claude Code mostra o
  mesmo em texto, sem gastar tokens. O servidor guarda a hora da saída em `resumo.json` e ela sobrevive ao reinício.
- **Modo maquete.** Em Configurações › Aparência, um interruptor deixa o escritório com cara de miniatura: uma faixa
  nítida que segue o mouse e as bordas desfocadas. Nomes, balões e o aviso de quem espera você continuam nítidos por
  cima. Vem desligado (o escritório fica como sempre e nada extra é carregado) e a escolha fica no navegador. Sem
  WebGL2, ou se o efeito não conseguir rodar, a opção se desliga e diz por quê.
- **Atualizar num comando.** `npm run atualizar` faz o `git pull --ff-only`, o `npm install` e reinstala o mod em cada
  conta; depois é só reiniciar o servidor (`npm run docker:up`).
- Para quem desenvolve: `npm run medir:escala` mede o tempo de trabalho de cada quadro e a CPU do navegador em cenários
  fixos da simulação (`?mock=1&sessions=10&projects=10&subs=30` monta 10 salas com 30 subagentes cada), e
  `npm run medir:servidor` mede a CPU e a memória do servidor sobre sessões fictícias, nativo ou num container de teste.

### Alterado

- **Rodas e moedinhas iguais em todas as abas.** Quem entra em cada roda, quando e quem ganha passou a ser decidido
  pelo servidor: duas abas mostram a mesma roda, os mesmos participantes e o mesmo saldo, que sobrevive a recarregar a
  página e a reiniciar o servidor, e o `/escritorio` no Claude Code mostra o saldo de cada agente. As moedinhas que
  estavam guardadas no navegador não são trazidas: os saldos recomeçam do zero. Uma roda em andamento quando o servidor
  reinicia não é retomada.
- **Movimento pelo escritório vale para todas as abas.** Calmo, Normal e Agitado, em Configurações, voltam a mudar
  quantas rodas acontecem (além dos passeios sozinhos) e a escolha fica no servidor, igual em todas as abas e depois de
  reiniciar; a escolha antiga, guardada no navegador, deixa de valer. Na simulação e no timelapse, vale só na aba.
- **Escritório parado gasta menos do computador.** Com todos os agentes ociosos há um minuto e sem você mexer na
  janela, o desenho cai para no máximo 10 quadros por segundo, e volta ao máximo na hora em que chega um alerta, um
  agente começa a trabalhar ou você mexe o mouse ou o teclado. Agente esperando você mantém o desenho no máximo; um
  comando rodando em segundo plano, não.
- **O mod instalado não depende mais da pasta do repositório.** A cópia em `~/.expediente/mod-instalado` passou a ser
  independente: mover ou renomear a pasta do Expediente não quebra o mod. Conta nova do Claude Code entra no
  `npm run instalar` mesmo sem sessão aberta, e só entra como conta a pasta `~/.claude*` que tem `.claude.json`,
  `projects/` ou `sessions/` (pastas de outras ferramentas com nome parecido ficam de fora).

## [1.1.0] - 2026-10-10

O melhor do Habblaud 0.8.0 e de dois forks, trazido com a autoria preservada; o aviso de versão nova sem o servidor
acessar a internet; e a documentação com a identidade do Expediente. Para atualizar: `git pull`, `npm run docker:up` e
`npm run instalar`.

### Adicionado

- **Aviso de versão nova, alimentado pelo host.** `npm run versao` (no seu computador, quando quiser ou agendado)
  consulta a última release do Expediente no GitHub e grava `~/.expediente/host/versao.json`; o servidor só lê esse
  arquivo e continua sem acessar a internet. Quando há versão maior, aparece o selo **Nova versão**, um aviso (uma vez
  por versão) e, em Configurações › Sobre, o link do que mudou e há quanto tempo foi a última verificação.
- **Lista lateral mais útil.** Cada agente mostra o título da sessão e há quanto tempo está ocioso; agentes e salas se
  reordenam arrastando, e a ordem fica guardada no navegador.
- **Gaveta e terminal móveis.** A gaveta e o terminal se arrastam, mudam de tamanho e o terminal expande; não passam
  por baixo da barra superior e lembram o lugar. A linha do tempo do agente mostra 15 itens, com "Mostrar mais".
- **Personagem do projeto.** No lápis da gaveta do agente, escolha nome, sorteio e peças do personagem da sala; cada
  sessão da sala mantém quem era. A sala também pode ser renomeada (lápis ou botão direito). Essas rotas só atendem
  pelo próprio computador, com a trava do terminal.
- **Temas do escritório.** Em Configurações › Aparência › Tema do escritório: padrão, Natal ou Halloween, como
  decoração por cima do tema; a escolha fica no navegador e as cores vêm do tema como dado.
- Verificação automática no GitHub (Actions): a cada push na `main`, nas branches de fatia e a cada pull request, o
  projeto roda `typecheck`, testes e build no Node 22.12 e no 24, com as ações fixadas por versão exata.

### Alterado

- A documentação fala do Expediente e do repositório dele: a instalação clona `isdiegoalves/expediente-ia`, os links
  de release e de comparação são do Expediente, e o histórico até a 0.4.0 é apresentado como o do projeto de origem.

### Corrigido

- **Subagentes com nome (teammates) no escritório.** O subagente lançado com nome no Claude Code (que vira teammate)
  não aparecia, ou entrava e saía na hora com "Concluiu em 0s". Agora ele entra trabalhando, fica à toa no escritório
  entre um turno e outro, volta à mesa quando recebe mensagem e só vai embora quando é encerrado ou a sessão fecha. Se
  calar no meio do trabalho, aparece como parado, como qualquer subagente. O resumo do time mostra "x trabalhando · y à
  toa · z concluídos"; o teammate com o turno encerrado e 5 s de silêncio conta como à toa, não como concluído, porque
  pode receber mensagem e voltar a trabalhar. A rodada mostra "z de t concluídos".
- Nome de sala e de personagem recusa ou perde caractere invisível de formatação (espaço de largura zero, BOM, hífen
  suave, junção de palavra), que disfarçava o nome.

## [1.0.0] - 2026-10-10

Primeira versão do Expediente com numeração própria: o escritório leva você à sessão de cada agente e mostra o que
importa, no navegador e dentro do Claude Code. Para atualizar: `git pull`, `npm run docker:up` e `npm run instalar`.

### Adicionado

- **Ir para a sessão.** Na gaveta do agente, "Ir para a sessão": a sessão do app desktop abre no app Claude, na própria
  sessão; a sessão de terminal viva traz o painel dela no zellij e o WezTerm para a frente ("Focar a sessão", executado
  pelo mod numa sessão do Claude Code aberta; sem nenhuma, o comando é copiado); sessão em segundo plano copia
  `claude attach`; sessão encerrada copia `cd -- '<pasta>' && claude --resume`. "Nova sessão neste projeto" abre uma
  sessão nova na pasta. Cada agente mostra de onde vem (app desktop, terminal, sdk, segundo plano).
- **A gaveta mostra o que importa.** Contexto atual e "compactou N×" com antes e depois; custo exato, ou marcado
  "(estimado)" quando o Claude Code não grava o custo ou ele está desatualizado (preços do catálogo do Claude Code,
  sobrescrevíveis em `~/.expediente/host/precos.json`); "esperando há N min" com o motivo, sem zerar quando o servidor
  reinicia; subagente "parado" com o último erro da API e as tentativas.
- **Subagentes agrupados** por time ou pelo agente que os criou, com concluídos sobre o total, "rodada N" para nomes que
  começam com `rN-` e "parado por você".
- **Perguntas do `AskUserQuestion`** na gaveta, com as opções. Responder pelo escritório pede o plugin
  `expediente-permissoes` (`npm run instalar -- --com-permissoes`).
- **Dentro do Claude Code (mod `expediente`).** Linha de status "precisa de você" em até 5 s; `/escritorio` com as
  sessões por estado, contexto e custo, sem gastar tokens; painel com o caminho para cada sessão (abrir no app, focar o
  painel do terminal, copiar o comando seguro).
- **Tema como dado.** Cores, textos e decoração vêm de `tema.json` e PNGs do tema; marca própria em pixel art.

### Segurança

- O servidor só atende pelo próprio computador: porta 4848 publicada só em 127.0.0.1, Host e Origin estritos (só
  `localhost`, `expediente.localhost` e IPs de loopback), sem CORS. O container monta, só leitura, `projects/` e
  `sessions/` de cada conta e `~/.expediente/host`. Terminal, histórico, permissões e foco só ligam com a publicação
  confirmada em loopback; o atalho para o app e o foco usam código de uso único.
- Segredos mascarados em tudo que a tela mostra, inclusive títulos, perguntas e comandos copiados.
- Sem saída de rede: a checagem de versão do projeto de origem saiu, e 1 hora de medição no container não achou nenhuma
  conexão para fora.

### Alterado

- **A instalação do mod é só pelo `claude plugin`.** `npm run instalar` (e `instalar:status` e `desinstalar`) substitui
  `mod:install`, `usage:install` e `hooks:install` e seus pares: o Expediente deixa de editar o `settings.json` das
  contas. O plugin de permissões passa a ser opcional (`npm run instalar -- --com-permissoes`) e é recusado na conta
  onde o plugin de permissões do projeto de origem estiver ativo. Antes de instalar, roda `claude plugin validate --strict`; Claude Code
  anterior ao 2.1.287 é recusado. O instalador registra uma cópia fixa do commit
  (`~/.expediente/mod-instalado`) em vez deste checkout, e o `docker:up` não atualiza mais o mod: atualizar é rodar
  `npm run instalar` de novo. Saiu também a migração do nome antigo (pasta de estado, container e plugins `codetown`).

### Corrigido

- Quando um arquivo de transcript era apagado e outro, maior, era criado no lugar, o Expediente podia não perceber a
  troca: alguns sistemas de arquivos reaproveitam o número (inode) do arquivo apagado, e só o inode era comparado.
  Agora, quando o sistema informa o momento de criação do arquivo, ele também entra na comparação, e a leitura
  recomeça do início do arquivo novo.
- O `npm install` alterava o `package-lock.json` (o do repositório estava desatualizado em relação ao
  `package.json`), e por isso o `git pull` da versão seguinte parava com "Your local changes … would be
  overwritten". Agora o arquivo fica igual. Quem já tem a alteração roda uma vez `git checkout -- package-lock.json`
  antes do `git pull`.

## Antes da 1.0.0

Até a 0.4.0 o histórico é o do projeto de origem, o Habblaud, de onde o Expediente deriva (veja a linha de origem no
[README](README.md)): o [CHANGELOG dele no commit `cb0c0bb`](https://github.com/marmottajr/habblaud/blob/cb0c0bb/CHANGELOG.md)
lista o que entrou em cada versão. O Expediente tem releases próprias a partir da 1.0.0.

[Não lançado]: https://github.com/isdiegoalves/expediente-ia/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/isdiegoalves/expediente-ia/releases/tag/v1.2.0
[1.1.0]: https://github.com/isdiegoalves/expediente-ia/releases/tag/v1.1.0
[1.0.0]: https://github.com/isdiegoalves/expediente-ia/releases/tag/v1.0.0
