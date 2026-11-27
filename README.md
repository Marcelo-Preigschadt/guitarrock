# RiffSync

**Sua música. Seu jeito de tocar.**

Estúdio web para carregar uma gravação, separar instrumentos e gerar automaticamente um arranjo em compassos, pautas, cifras e tablaturas, sincronizado com as pistas de áudio reais. Interface em português, compatível com computador e celular.

## Motor e desempenho — v0.6.0

O **Superior continua como padrão**, com os quatro modelos, duas estimativas Demucs, voz RoFormer, ensemble de bateria e especialista de baixo. Agora o processamento usa até oito threads dentro da quota/afinidade real do servidor, com controle explícito por `RIFFSYNC_CPU_THREADS`. O mesmo limite é aplicado ao PyTorch, ONNX e Whisper. A tela de configuração e `/api/health` mostram os núcleos e threads disponíveis.

As pistas são liberadas assim que a separação termina. Cifras, notas e tablaturas seguem numa fila persistente de análise musical, com progresso, cancelamento e retomada próprios. A entrega posterior do arranjo preserva áudio, mixer, texto importado e correções. Erros de análise musical preservam a reprodução das faixas. Reiniciar o worker recupera a análise pendente sem repetir a separação.

O separador também salva checkpoints completos por modelo, com hash da entrada, parâmetros, arquivos e estados aleatórios. Uma retomada reaproveita etapas verificadas e repete somente as incompletas/inválidas. A separação concluída é recuperada antes de refazer inferências. Esses caches são por tarefa, preservam a propriedade do upload e são removidos após a publicação do resultado.

**RiffCore** é o novo motor experimental, baseado em um estudante de seis fontes inicializado com `htdemucs_6s` e treinado por destilação do Superior. Ele foi implementado com preparação explícita de rótulos, treino, avaliação com referências reais e integração para inferência de um único modelo. Estado atual: **protótipo treinável, sem pesos qualificados para produção**. O Superior permanece ativo. O teste de código executou um passo real de gradiente e uma inferência de seis saídas; isso não demonstra generalização musical.

Veja [desenvolvimento do RiffCore](docs/riffcore.md) e [medições de desempenho](docs/performance.md). Aceleração medida em blocos locais não garante o mesmo fator em um Codespace com outra quantidade de CPUs. Não foi medido desempenho de GPU neste ambiente.

## Funcionalidades implementadas

- Importação local de MP3, WAV, FLAC, OGG, M4A, AAC, WebM e Opus, conforme os codecs do navegador. WebM pode conter vídeo: o processamento extrai sua pista de áudio automaticamente.
- Reprodução multifaixa com controle de volume, mute e solo por pista. Trechos curtos usam buffers Web Audio; projetos longos usam elementos de mídia com relógio de uma pista de referência e correção de desvio, evitando carregar todas as pistas como PCM na memória.
- Reprodução em M4A/AAC a 320 kbps, preparada uma vez e guardada no servidor, adaptando o mecanismo técnico do FaixaLab. Os WAVs separados permanecem intactos para download pelo botão de cada pista. O original enviado não é alterado.
- Entrega incremental: cifras, notas, tablaturas e compassos aparecem assim que o manifesto está pronto. Cada pista tem estado de carregamento próprio. Uma falha não oculta as demais nem remove as correções já feitas.
- Controle de visibilidade da notação independente do mute do áudio.
- Forma de onda com posição de reprodução, marcadores arrastáveis e repetição A–B.
- Importação de texto TXT, LRC e ChordPro; espaços de cifras e tablaturas ASCII são preservados. LRC mantém os timestamps.
- Sincronização manual por bloco ou linha: selecione o trecho, toque o áudio e pressione **M**, ou use **Marcar**. Tempos também podem ser digitados.
- **Cifra e braço**: sequência de acordes com diagramas, braço horizontal e notas nas casas sincronizadas. Alterna digitação sugerida do acorde e notas detectadas na guitarra/baixo. A cifra é armazenada separadamente do texto importado. **Gerar/Recalcular cifra** reutiliza as faixas existentes e não executa Demucs.
- **Reprocessar em qualidade superior**: cria uma revisão independente a partir do upload original. Combina `htdemucs_6s` para guitarra/piano, Mel-Band RoFormer (Kimberley Jensen) para voz e os especialistas oficiais `f7e0c4bc` (bateria) e `d12395a8` (baixo). Os modelos Demucs usam duas estimativas deslocadas. Preserva a versão anterior em Meus projetos e no servidor. Não reutiliza o cache de áudio antigo como se fosse o novo resultado. A rota antiga de refinamento de voz/bateria permanece compatível com clientes anteriores.
- **Arranjo da IA**: pautas e tablaturas geradas diretamente dos eventos de notas detectados, com cifras acima dos compassos, cursor e páginas acompanhando a reprodução. Não exige importação de Guitar Pro/MusicXML e não gera arquivos MIDI.
- Edição visual de cada nota: início, fim, corda, casa ou altura. A grade visual pode ser ajustada por BPM e compasso. A reprodução usa os WAVs separados, preservando o timbre da gravação.
- Marcação de ataques de bateria, melodia da voz e notas de piano. O andamento, a métrica e as digitações são estimativas editáveis.
- Separação real com Demucs: modelos `htdemucs` (4 pistas), `htdemucs_ft` (4 pistas, refinado) e `htdemucs_6s` (6 pistas, experimental).
- Início direto por **Separar com IA** no mixer ou **Separar instrumentos** nas configurações. Com API e worker no mesmo servidor do aplicativo, o endereço pode ficar vazio. Erros de envio permanecem visíveis na tela com a resposta do servidor.
- Transcrição de notas por stem com Basic Pitch; estimativa de cordas e casas para guitarra e baixo em afinação padrão. Piano mantém eventos de notas no projeto.
- Estimativa de acordes maiores/menores por chroma, segmentação rítmica e suavização temporal. O limite de silêncio considera o nível do acompanhamento separado, para não eliminar acordes apenas por estarem baixos. Trechos sem evidência suficiente não recebem um acorde inventado.
- Letra automática com faster-whisper/Whisper `large-v3-turbo`, CPU `int8`, idioma automático e timestamps por palavra, usando o áudio original para evitar depender de uma voz isolada com artefatos. A aba **Letra e cifra** acompanha a reprodução e permite corrigir texto e tempos. O processamento da letra começa depois da entrega do resultado musical e não bloqueia os áudios concluídos.
- O botão **Gerar letra com IA** reutiliza a voz de uma tarefa concluída. Cancelar ou repetir a letra preserva as faixas, cifras, notas e controles do mixer. O worker persiste e recupera essa fila separadamente. Letras editadas não são sobrescritas por consultas repetidas da mesma revisão.
- Cifras estimadas no acompanhamento separado (`guitar`, `piano`, `other`, com apoio do `bass`), com menor peso para `other` quando há instrumentos harmônicos dedicados; a voz e a bateria não entram nesse mix. A aba **Acordes** permite corrigir as estimativas.
- Fila SQLite persistente, worker separado da API, progresso por etapa, cancelamento e detecção de worker interrompido.
- Uma retentativa automática se um subprocesso receber SIGTERM com o worker ainda ativo. Reiniciar o worker recoloca a tarefa na fila; cancelamentos explícitos são preservados. O botão **Retomar processamento** reutiliza o upload de tarefas que falharam.
- Separação com janelas de até 7,8 segundos e sobreposição de 50% por padrão, retentativa automática com janelas menores quando há falta de memória e diagnóstico copiável na tela para falhas de memória, rede/modelos, dependências e disco. As janelas não limitam a duração da música.
- Transcrição ONNX em blocos de até 32 segundos com contexto e fusão de eventos nas fronteiras, para limitar o uso de memória.
- Acesso às tarefas e arquivos restrito à chave aleatória da sessão do navegador.
- Projetos locais persistidos no IndexedDB, exportação/importação de `.riffsync` com áudios e partitura, download das pistas e exportação do acompanhamento em WAV.
- Cache offline do aplicativo após um carregamento completo da versão de produção. A IA exige o servidor; sessões já baixadas podem ser estudadas localmente.
- Demonstração de 19 segundos com arranjo original sintetizado. **A demonstração é identificada como tal e não simula resultados de IA.**

## Qualidade da separação — v0.5.0

**Superior** é a opção inicial para novos envios. Cada um dos quatro modelos recebe a mesma gravação original; guitarra e piano continuam separados, a voz usa Mel-Band RoFormer e bateria/baixo usam membros específicos de `htdemucs_ft`. Cada modelo Demucs produz duas estimativas com deslocamentos temporais, alinhadas e promediadas. A bateria combina as estimativas de `htdemucs_6s` e do especialista com pesos fixos de 50%, sem ajustar pesos para uma música específica. RoFormer usa janelas de 8 segundos com 50% de sobreposição e fades conforme a inferência do autor. **Normal** usa o modelo selecionado com uma estimativa. Quatro faixas em Superior usam RoFormer e dois especialistas e calculam Outros pelo residual; não produzem guitarra/piano separados.

A inferência roda sequencialmente. Em CPU, Superior exige várias vezes o tempo do modo Normal; os pesos são baixados uma vez. O RoFormer tem cerca de 871 MiB, revisão fixa e SHA256 verificado; `torch.load(weights_only=True)` e carga estrita de parâmetros. A arquitetura usa `bs-roformer==0.6.0` com a camada linear desativada e adaptação apenas dos nomes dos slots tempo/frequência do checkpoint original. O progresso acompanha os blocos efetivamente processados em cada etapa. Em falta de memória, as janelas do Demucs diminuem e o resultado avisa que houve essa redução. O arquivo original é decodificado como float32, evitando uma etapa intermediária de quantização em PCM16.

Os WAVs são entregues em PCM24 com um único fator de atenuação para todas as pistas quando necessário para evitar clipping. Não há normalização independente por instrumento. O residual de reconstrução fica exclusivamente em Outros; a soma das pistas recupera a gravação com esse ganho comum, dentro da precisão de PCM24. Isso garante o balanço do conjunto, não a ausência de vazamentos em cada pista. A reprodução continua usando o cache AAC320; o download individual fornece o WAV PCM24. O manifesto registra modelos, perfil, janelas, estimativas, ganho e erro de reconstrução.

Para músicas já separadas, clique em **Reprocessar em qualidade superior**. Os WAVs antigos não mudam automaticamente. A revisão preserva letra, notação e ajustes do mixer; recalcula a cifra sem descartar o áudio se essa análise falhar. A revisão só é concluída depois que todas as faixas esperadas foram geradas. Não aplica gate ou denoiser de fala aos instrumentos: ambos podem cortar pratos, ataques e sustain. Ainda podem ocorrer artefatos de separação, especialmente em guitarra e piano do modelo experimental.

## Pedaleira e timbre — v0.4.0

A pedaleira aparece aberta no início do estúdio, antes de carregar música ou conectar um dispositivo. Cabeçote, caixas e pedais têm controles próprios; o menu **Pedaleira e timbre** leva diretamente a eles. A conexão de áudio fica depois dos equipamentos.

1. Ligue a guitarra à entrada de instrumento de uma interface de áudio. Escolha a entrada e o canal 1 ou 2, clique em **Conectar guitarra** e permita a entrada de áudio. O app solicita áudio sem cancelamento de eco, redução de ruído ou ganho automático. O navegador pode ignorar essas preferências conforme o dispositivo.
2. Clique em **Ativar retorno**. A captura inicia com retorno desligado e saída em −12 dB. Use fones e desative o monitoramento direto da interface para não ouvir os dois caminhos.
3. Ligue, desligue e reordene os 15 módulos: noise gate, compressor, boost, overdrive, distorção, fuzz, amplificador, caixa, EQ, chorus, phaser, flanger, tremolo, delay e reverb. As setas mudam a ordem real do processamento. Os controles respondem durante a execução.
4. Escolha amp **Clean, Crunch ou High gain** e caixa **1×12, 2×12 ou 4×12**. Esses modelos nativos usam saturação e filtros DSP; as caixas não são IRs medidos. **Importar IR** aceita respostas mono/estéreo de até 5 segundos. **Importar .nam** carrega uma captura neural compatível com Neural Amp Modeler em 48 kHz. Capturas que já incluem caixa devem ser usadas com o módulo de caixa desligado, a menos que você queira os dois estágios. Não há capturas comerciais incluídas.
5. Salve timbres com nomes como **Base** e **Solo**. A/B guarda e recupera duas cadeias completas. Os timbres, NAM, IR e a calibração são persistidos por música no IndexedDB e no arquivo `.riffsync`. Sem música aberta, a pedaleira tem sua própria biblioteca local. JSON exporta somente os parâmetros e referências aos arquivos; para transferir tudo, exporte o projeto.
6. Para tocar junto, use **Silenciar guitarra da música**, que silencia também o áudio original e limpa o solo do mixer. A guitarra ao vivo usa o mesmo contexto e saída do acompanhamento. Ela não é adicionada à exportação do acompanhamento nem gravada automaticamente.

### Valvulados clássicos

A biblioteca **Valvulados clássicos** oferece doze perfis DSP e duas cadeias por modelo: **Base** e **Solo com delay**. Selecionar uma marca/modelo carrega amp, caixa, ganho, EQ e efeitos; preserva os ganhos gerais de entrada e saída. Os controles permanecem editáveis e os perfis acompanham os presets salvos, A/B e projetos `.riffsync`.

| Referência | Modelos disponíveis |
|---|---|
| Marshall | 1959 Plexi; JCM800 2203 |
| Fender | Twin Reverb ’65; Deluxe Reverb ’65 |
| Mesa/Boogie | Dual Rectifier; Mark IIC+ |
| Orange | OR120; Rockerverb 50 |
| Laney | Supergroup; Lionheart L20H |
| Gibson | Falcon GA-19RVT; EH-150 |

Cada perfil tem filtros antes e depois da saturação, duas curvas suaves de saturação com assimetria própria, resposta de ganho e voicing de caixa. Apenas o perfil escolhido é processado. São **interpretações DSP ajustadas manualmente**, não simulações de circuito elétrico nem capturas medidas dos fabricantes. Os efeitos de ambiente são os módulos do aplicativo; não reproduzem fisicamente uma mola ou o circuito de tremolo original. NAM/IR importados continuam disponíveis para usar respostas capturadas.

### Ajuste automático por referência

Selecione uma pista de guitarra separada e um trecho de **2 a 20 segundos**, ou importe um trecho curto. Grave **6 segundos de guitarra limpa** pela entrada ou importe DI de 2 a 20 segundos. A calibração é capturada antes dos pedais; o app recusa silêncio, nível muito baixo e clipping. Toque material próximo ao trecho de referência.

**Aproximar timbre** renderiza 75 candidatos/comparações no `OfflineAudioContext`, procura entre amps e caixas DSP, ganho, EQ, saturação, compressor, chorus, delay e reverb, e mantém somente mudanças com menor distância entre descritores espectrais e de dinâmica. O timbre anterior vai para A; o resultado, para B. A referência e a DI podem ser ouvidas separadamente sem misturar a entrada ao vivo. Cancelar preserva o timbre anterior.

Este recurso é uma **aproximação experimental por otimização DSP**, não um modelo treinado para identificar equipamentos. A redução informada mede a distância sonora dos descritores, não a fidelidade perceptual. Captadores, afinação, execução, acordes diferentes e vazamentos da separação limitam o resultado. Ele não descobre uma cadeia única de pedais nem garante copiar o timbre da gravação. NAM e IR importados podem ser ajustados manualmente; a busca automática usa os modelos DSP nativos.

A extração de referência de uma tarefa concluída é autenticada, gera um WAV mono de 48 kHz de no máximo 20 segundos e reutiliza cache. Não executa a separação novamente. Sem o servidor, pistas curtas locais podem ser usadas diretamente; para pistas longas, importe um trecho curto.

O processamento local usa Web Audio e AudioWorklet em contexto seguro (**HTTPS** ou localhost). A saída exibida em ms é uma estimativa de `baseLatency + outputLatency`, não a latência total de ida e volta da interface. A latência real e a quantidade de efeitos/NAM que rodam sem falhas dependem do navegador, driver e hardware. [Motor NAM usado](https://github.com/tone-3000/neural-amp-modeler-wasm); licença distribuída em `frontend/public/licenses/neural-amp-modeler-wasm.txt`.

## Executar com Docker

Requer Docker com Compose. A imagem usa Python 3.11, FFmpeg e PyTorch para CPU.

```bash
docker compose up --build
```

Abra **http://localhost:8000**. O mesmo endereço serve o aplicativo e a API. O segundo serviço executa o worker; ambos compartilham os arquivos e a fila. Os pesos do Demucs são baixados no primeiro processamento e permanecem no volume `riffsync-models`. A API permanece responsiva durante o processamento.

O build instala dependências de IA grandes. O tempo de separação depende de CPU/GPU, duração da música e modelo escolhido; o aplicativo não promete um prazo fixo. Para GPU NVIDIA, instale wheels CUDA compatíveis de `torch` e `torchaudio` juntos, disponibilize a GPU ao container e defina `RIFFSYNC_DEVICE=cuda`. A imagem fornecida usa CPU.

## Abrir no GitHub Codespaces

Use **Code → Codespaces → Create codespace on main**. A configuração em `.devcontainer` instala as dependências e inicia API e worker. Abra a porta **8000**, identificada como **RiffSync Studio**. O primeiro preparo pode levar alguns minutos. Codespaces pausa quando a sessão é encerrada ou fica inativa; não é hospedagem permanente.

## Instalação local

Requer **Node.js com npm**. O instalador reutiliza Python 3.10/3.11 disponível ou instala Python 3.11 isoladamente via uv, sem substituir o Python do sistema. Em Debian/Ubuntu, instala FFmpeg e libsndfile quando necessários, usando os repositórios da distribuição. Repositórios externos como Yarn não entram nessa atualização do APT.

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

Abra **http://localhost:8000**. Os scripts são para Linux/macOS ou WSL. No Windows, Docker Desktop é a alternativa para executar a configuração completa.

### Instalar em outro repositório ou conta

O diretório e o dono do repositório podem mudar: o setup resolve todos os caminhos a partir da própria cópia. Após copiar o projeto ou criar um fork, no terminal do novo Codespace:

```bash
bash scripts/setup.sh && bash scripts/start.sh --background
```

Abra a porta **8000** desse novo Codespace. Ele usa seu próprio diretório `data`, seus modelos e seus processos. `RIFFSYNC_PYTHON` continua disponível para indicar um interpretador compatível específico. Um ambiente `.venv` incompatível é preservado com sufixo de backup. `bash scripts/setup.sh --runtime-only` prepara apenas Python/FFmpeg, sem baixar os pacotes de IA.

### Desenvolvimento

```bash
# Inicia API, worker e interface com atualização automática.
npm run dev
```

Acesse **http://localhost:5173**. O Vite encaminha `/api` para `localhost:8000`.
Sem `.venv`, esse comando inicia apenas a interface. Para executá-los separadamente, use `uvicorn riffsync.api:app --reload --port 8000`, `python -m riffsync.worker` e `npm --prefix frontend run dev` no ambiente Python instalado.

## Publicar a interface separadamente

O workflow manual **Publish web app to GitHub Pages** gera e publica `frontend/dist`. Antes de executá-lo, selecione **GitHub Actions** como origem em **Settings → Pages** do repositório. O build usa caminhos relativos e suporta o subdiretório `/guitarrock/`.

GitHub Pages hospeda a interface estática. Para usar IA, hospede a API **e o worker** em um servidor Python e informe sua URL em **Configurações → Endereço do servidor**. Inclua a origem exata do frontend em `CORS_ORIGINS`, por exemplo `https://SEU-USUARIO.github.io`, e use HTTPS quando a interface estiver em HTTPS. O servidor precisa ter acesso aos pesos dos modelos. Não há servidor de IA público contratado ou configurado neste repositório.

## Atualizar um Codespace existente

Na raiz do repositório:

```bash
git pull --ff-only && python3 scripts/restart.py
```

Esse comando instala os motores de letra e RoFormer se estiverem ausentes, atualiza as dependências da interface quando o lockfile mudou, recompila a interface, encerra somente os processos RiffSync deste checkout e inicia API e worker. Confere a versão do build no endpoint de saúde **e compara o HTML efetivamente servido com o build recém-criado**. A confirmação inclui versão, revisão e identificador de build. Após recarregar a aba, a barra lateral deve mostrar **v0.6.0**. O script de início também recompila quando a revisão ou os arquivos da interface mudaram, mesmo que já exista `dist/index.html`.

API e worker são iniciados em sessões independentes do terminal. Um bloqueio por diretório de dados impede dois workers simultâneos. Os uploads e projetos do diretório `data` são preservados. Não apague os dados do site no navegador: os projetos e a chave de acesso às tarefas são armazenados ali.

O Whisper baixa seus pesos no primeiro uso e os conserva em `data/models/whisper`. `LYRICS_MODEL` escolhe o modelo (padrão `large-v3-turbo`) e `LYRICS_LANGUAGE` pode fixar `pt`, `en` ou outro idioma aceito; vazio ativa detecção automática. Nenhuma chave de API paga é necessária. Canto, vazamentos da separação e ruído podem causar omissões ou palavras incorretas; o reconhecimento não consulta um catálogo de letras oficiais.

Para uma tarefa que já falhou, clique em **Retomar processamento**: o servidor reutiliza o arquivo enviado e reinicia o processamento, sem novo upload. Não há checkpoint dentro do modelo. Uma queda abrupta do worker permite até duas recuperações automáticas; interrupções repetidas exigem retomada manual. O código `−15` identifica SIGTERM, mas não informa quem enviou o sinal. Encerrar o Codespace também encerra seus processos.

Se uma tarefa falhar, abra **Ver diagnóstico do processamento → Copiar diagnóstico**. Tarefas antigas que falharam também exibem os logs quando ainda estão disponíveis no servidor. Não é necessário copiar o terminal.

Se a IA concluiu mas faltam áudios, use **Recuperar resultado**. Essa ação busca o resultado da mesma tarefa e reutiliza as pistas já recebidas; não envia a música novamente nem executa o separador. O erro indica o arquivo e a resposta HTTP quando disponíveis. A partitura e a cifra permanecem acessíveis durante a recuperação. Projetos parcialmente recebidos são salvos localmente e retomam a entrega ao serem reabertos.

## Configuração do backend

| Variável | Padrão | Finalidade |
|---|---|---|
| `RIFFSYNC_DATA` | `./data` | SQLite, uploads e resultados; deve ser compartilhado entre API e worker |
| `RIFFSYNC_DEVICE` | `auto` | `cpu`, `cuda` ou seleção automática |
| `SEPARATION_SEGMENT_SECONDS` | `7.8` | Janela interna do Demucs, entre 1 e 7,8 segundos; RoFormer usa 8 s |
| `MAX_UPLOAD_MB` | `200` | Limite por upload no backend |
| `MAX_DURATION_SECONDS` | `1200` | Duração máxima do áudio enviado à IA |
| `JOB_TIMEOUT_SECONDS` | `7200` | Timeout por etapa de subprocesso |
| `RETENTION_DAYS` | `7` | Remove tarefas terminadas e seus arquivos após esse prazo; `0` desativa |
| `CORS_ORIGINS` | localhost nas portas 5173/8000 | Origens exatas autorizadas a chamar a API |
| `FRONTEND_DIST` | `./frontend/dist` | Diretório do frontend compilado, se servido pela API |

`.env.example` documenta as variáveis. O Compose lê `.env` para substituições, mas a execução direta do Python usa as variáveis exportadas no ambiente.

### API

Documentação interativa em `/docs`.

| Método | Endpoint | Uso |
|---|---|---|
| GET | `/api/health` | Disponibilidade da API, worker e modelos |
| POST | `/api/jobs` | Multipart `file`, `model`, `transcribe` |
| GET | `/api/jobs/{id}` | Estado, progresso, avisos e resultado |
| POST | `/api/jobs/{id}/cancel` | Interromper processamento |
| POST | `/api/jobs/{id}/retry` | Recolocar tarefa com falha na fila, reutilizando o upload |
| GET | `/api/jobs/{id}/files/{filename}` | Baixar uma pista finalizada |
| GET | `/api/jobs/{id}/files/{filename}?format=m4a` | Reprodução AAC em cache, com a mesma autenticação e suporte a HTTP Range |
| GET | `/api/jobs/{id}/excerpt/{filename}?start=0&seconds=8` | Trecho mono de 48 kHz para comparação de timbre, de 1 a 20 segundos, autenticado e em cache |
| DELETE | `/api/jobs/{id}` | Remover tarefa finalizada com sucesso ou falha |

Exceto `/health`, as rotas requerem `X-Workspace-Key` com a chave gerada pelo frontend. A chave não é enviada em query strings. Isso isola sessões, mas não implementa cadastro, login Google, recuperação de conta ou quotas por pessoa. A fila limita tarefas ativas por sessão e globalmente. Para uma oferta pública multiusuário, acrescente autenticação e quotas de processamento antes da abertura.

## Estrutura

```text
frontend/src/          Interface React/TypeScript, áudio e sincronização
frontend/src/components/  Mixer, forma de onda, tablatura e partitura
backend/riffsync/      API, fila, worker e transcrição
backend/tests/         Testes de isolamento, fila, arquivos e cancelamento
scripts/               Instalação, inicialização e teste dos modelos reais
.github/workflows/     Validação contínua e publicação manual da interface
```

## Validação

```bash
npm ci --prefix frontend
npm test
npm run build
.venv/bin/python -m unittest discover -s backend/tests -v

# Executa Demucs e Basic Pitch reais; baixa os pesos se necessário.
.venv/bin/python scripts/smoke_pipeline.py

# Mesma integração com arquivos realmente codificados em WebM/Opus e MP3.
RIFFSYNC_SMOKE_FORMAT=webm .venv/bin/python scripts/smoke_pipeline.py
RIFFSYNC_SMOKE_FORMAT=mp3 .venv/bin/python scripts/smoke_pipeline.py
```

O teste de modelos usa uma gravação sintetizada de 5 segundos, passa pelo endpoint de upload, separa seis instrumentos, transcreve os stems e verifica o download dos seis WAVs. Ele valida a integração; não mede qualidade musical em gravações comerciais.

## Limites da transcrição

A separação não recupera perfeitamente os instrumentos originais; vazamentos e artefatos afetam as notas detectadas. O modelo de seis pistas não garante a separação entre guitarra solo e base, e sua saída de piano é experimental. Basic Pitch estima alturas e durações; cordas/casas são uma digitação possível, não uma identificação da execução original. Bends, slides, ligaduras e articulações não são reconstruídos nesta versão. O estimador de cifras atual cobre tríades maiores/menores, não um dicionário completo de acordes. Todo material gerado pode ser corrigido no editor de notas ou complementado por cifras e tablaturas TXT sincronizadas manualmente. A grade de compassos é estimada em 4/4 por padrão, podendo ser corrigida pelo usuário.

## Componentes utilizados

- [React](https://react.dev/) e [TypeScript](https://www.typescriptlang.org/)
- [Bravura](https://github.com/steinbergmedia/bravura) — fonte musical SMuFL, SIL OFL; distribuída pelo pacote alphaTab. A notação usa SVG próprio, sem o player MIDI do alphaTab.
- [Demucs](https://github.com/facebookresearch/demucs) — separação, MIT; repositório original arquivado
- [Basic Pitch](https://github.com/spotify/basic-pitch) — transcrição, Apache-2.0
- [librosa](https://librosa.org/) — análise de áudio, ISC
- [FastAPI](https://fastapi.tiangolo.com/) — API Python, MIT
- [Lucide](https://lucide.dev/) — ícones, ISC
- DM Sans e Manrope — fontes distribuídas com o frontend, SIL Open Font License

Na aba **Letra e cifra**, o idioma pode ser fixado em português, inglês ou espanhol. Refazer a letra usa o áudio original e descarta a transcrição anterior da tela enquanto processa. Trechos de baixa confiança ficam sem texto e são marcados para revisão; a confiança do modelo não comprova fidelidade à letra real.
