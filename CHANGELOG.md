# Novidades

O que entrou em cada versão do Expediente. Cada versão tem a sua seção aqui, e o texto dela vira as notas da
[release no GitHub](https://github.com/isdiegoalves/expediente-ia/releases) (`npm run release`), que o Expediente abre em
**Configurações › Sobre › Ver o que mudou**.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e os números seguem o
[versionamento semântico](https://semver.org/lang/pt-BR/): correção sobe o último número (0.2.**1**), novidade sobe o
do meio (0.**3**.0).

## [Não lançado]

### Adicionado

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

### Corrigido

- **Subagentes com nome (teammates) no escritório.** O subagente lançado com nome no Claude Code (que vira teammate)
  não aparecia, ou entrava e saía na hora com "Concluiu em 0s". Agora ele entra trabalhando, fica à toa no escritório
  entre um turno e outro, volta à mesa quando recebe mensagem e só vai embora quando é encerrado ou a sessão fecha. Se
  calar no meio do trabalho, aparece como parado, como qualquer subagente.
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

## [0.4.0] - 2026-10-08

### Alterado

- **O CodeTown agora se chama Expediente.** O nome muda em toda parte: interface, logotipo, placa da recepção, totem da
  entrada, prévia de link, repositório (`github.com/marmottajr/habblaud`), marketplace e plugins do Claude Code
  (`expediente` e `expediente-permissoes`, com o comando `/escritorio`), variáveis de ambiente (`EXPEDIENTE_*`), pasta de
  estado (`~/.expediente`) e Docker (container e imagem `expediente`, volume `expediente-data`).
- Para quem vem do CodeTown: rode `npm run mod:install` uma vez (troca o marketplace e os plugins antigos pelos novos
  em cada conta) e `npm run docker:up` (tira o container antigo e copia os nomes, a linha do tempo e as estatísticas
  do volume `codetown_codetown-data` para o novo, sem apagar o antigo). A pasta `~/.codetown` e as preferências e
  moedinhas guardadas no navegador passam para os nomes novos sozinhas. As variáveis `CODETOWN_*` não valem mais:
  renomeie para `EXPEDIENTE_*` no `.env` (o servidor e o `docker:up` avisam). Detalhes no README, em
  "Vindo do CodeTown".

## [0.3.2] - 2026-10-08

### Corrigido

- Quando um terminal fechava e a sala dele era desmontada, ficava um jardim no meio do prédio, entre salas. Agora a
  sala mais distante se muda para a vaga: é montada lá, ainda apagada; o primeiro a chegar acende a luz e cada um
  volta para a mesma mesa. O endereço antigo apaga e é desmontado, e o prédio encolhe. Uma sala que abre ocupa a
  primeira vaga livre, e a carga inicial já vem sem buracos.
- Quem estava a caminho de algo que deixou de existir, como o bebedouro de uma coluna do corredor que sumiu quando o
  prédio encolheu, era teletransportado. Agora muda de plano e segue andando.

## [0.3.1] - 2026-10-08

### Corrigido

- Quem cochilava na mesa (ocioso há mais de 10 minutos) e levantava para uma roda, uma festa ou um passeio saía
  andando com o "zzz" na cabeça. Agora o "zzz" só aparece enquanto o personagem dorme.

## [0.3.0] - 2026-10-08

### Adicionado

- **Mod do Expediente para o Claude Code** (2.1.287 ou mais novo): `npm run mod:install` instala, em cada conta, o
  marketplace desta pasta com o mod `expediente` (uso de 5 horas e semanal ao vivo, uma linha no terminal quando outra
  sessão precisa de você e o comando `/escritorio`) e o plugin `expediente-permissoes` (responder permissões pelo
  escritório; `-- --sem-permissoes` deixa de fora). `npm run mod:status` mostra o que cada conta tem e
  `npm run mod:uninstall` tira tudo. O `npm run docker:up` atualiza o mod de quem já instalou.

### Mudado

- O tap de statusline (`npm run usage:install`) e o hook de permissão (`npm run hooks:install`) viram o jeito antigo,
  para o Claude Code anterior ao 2.1.287. O `npm run mod:install` tira os dois da conta (com backup), porque o mod faz
  o mesmo. A interface e o README passam a ensinar o `npm run mod:install`.
- O script do hook de permissão mudou para `mod/expediente-permissoes/hooks/permission-hook.mjs`. O caminho antigo
  (`scripts/permission-hook.mjs`) virou um atalho, então quem instalou o hook antes continua funcionando.
- Em Contas e uso, a origem dos números diz quando vêm do mod ("ao vivo (mod do Expediente)").
- O leitor do uso ao vivo ignora um arquivo lido pela metade e fica com o último número bom, em vez de esconder a
  conta por um ciclo.

## [0.2.0] - 2026-10-08

Primeira versão publicada.

### Adicionado

- **Versão e atualizações:** a versão em uso aparece na barra superior e em Configurações › Sobre. A cada 6 horas o
  Expediente confere as releases no GitHub; quando sai uma versão nova, aparece o selo **Nova versão**, com um aviso e o
  link do que mudou. `EXPEDIENTE_UPDATE_CHECK=0` desliga a consulta.
- **Meu dia** (tecla M): para onde foi o tempo dos agentes, quanto tempo esperaram você, tokens e custo, com 30 dias
  de histórico.
- **GitHub no escritório:** PR aberto ou mergeado e release publicada viram festa na sala; CI vermelho liga o alarme,
  até um CI verde.
- **Responder pelo escritório** (tecla P): com o hook instalado (`npm run hooks:install`), aprovar, recusar ou
  "sempre permitir" pedidos de permissão sem ir ao terminal. Só com acesso local.
- **Timelapse do dia** (tecla L): o escritório reproduz o dia em alta velocidade.
- **Terminal somente leitura** (tecla T): a conversa de cada agente, ao vivo, no estilo do Claude Code, com busca,
  filtro, botão de copiar e histórico das sessões dos últimos 7 dias. Só com acesso local.
- **Dia e noite** pela hora local e **sons** sintetizados no navegador (desligados por padrão).
- **Vida social:** quem está à toa se junta em rodas (TV, videogame, pingue-pongue, papo na copa, jokenpô valendo
  moedinhas), com personalidades, amizades e rivalidades.
- **Esperando o shell:** o agente que espera um comando longo fica na mesa com a ampulheta, e a espera vira uma gag.
- Forks de sessão aparecem no escritório.
- A página aberta se recarrega sozinha quando o servidor passa a servir outra versão.
- O container usa o fuso horário do computador.
- **O escritório:** cada projeto aberto no Claude Code vira uma sala e cada sessão, um personagem com nome próprio.
  Subagentes chegam, trabalham e entregam ao principal. Mostra as duas contas, com o uso de 5 horas e semanal de
  cada uma (tap de statusline), além de feed de atividade, avisos e modo demonstração. Roda no Node ou no Docker local.

[Não lançado]: https://github.com/marmottajr/habblaud/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.4.0
[0.3.2]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.2
[0.3.1]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.2.0
