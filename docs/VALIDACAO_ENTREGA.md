# Entrega dos resultados e reprodução

A falha confirmada no código anterior era a aplicação conjunta de todos os resultados: o cliente só atualizava o mixer, as cifras e as notas depois de baixar e decodificar todos os WAVs. Uma única falha ocultava os demais resultados. A captura fornecida não permite distinguir uma falha de rede de uma falha do decodificador; agora a interface informa o arquivo e o erro disponível.

A implementação mantém o guitarrock e sua notação SVG. A reprodução AAC em cache foi adaptada do mecanismo técnico de `app/faixalab/backing.py` do [FaixaLab, revisão 0a74a79](https://github.com/Marcelo-Preigschadt/FaixaLab/tree/0a74a79). Os modelos de separação e transcrição não foram substituídos nesta correção.

## Verificações executadas

- 28 testes Python: autenticação, fila, isolamento de arquivos, cancelamento, recuperação, codificação AAC real, cache, HTTP Range e preservação do manifesto quando um WAV está ausente.
- 22 testes TypeScript: aplicação das notas antes dos downloads, falha parcial, reutilização do cache, preservação de edições, cancelamento por troca de sessão, erros HTTP/HTML e reprodução de mídia sem alocação de AudioBuffers PCM.
- Compilação TypeScript e build de produção.
- Navegador com separação e transcrição reais de uma amostra sintetizada de cinco segundos. Após a conclusão, uma pista foi temporariamente retirada para provocar HTTP 404: as outras cinco pistas e a notação permaneceram disponíveis. Restaurar o arquivo e usar a recuperação concluiu o mesmo resultado, sem novo processamento pela IA. A reprodução foi iniciada e o relógio avançou.
- Navegador com seis arquivos AAC de 270 segundos: carregamento, reprodução, pausa, mute e avanço para cerca de 2min28s, com acompanhamento dos compassos. Esse projeto de teste repete stems da amostra curta; valida a entrega e a reprodução longa, não a precisão da transcrição em uma música comercial de 4min30s.

Não houve acesso ao áudio original da captura do usuário nem ao diagnóstico específico de sua falha de download. O botão **Recuperar resultado** permite buscar a tarefa concluída no mesmo Codespace, mantendo as faixas recebidas e as correções locais.

## Fontes consultadas

- [MDN — AudioBuffer](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer): o áudio decodificado reside na memória; mídia é apropriada para fontes longas.
- [MDN — decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData): a decodificação depende do arquivo completo.
- [FastAPI — FileResponse](https://fastapi.tiangolo.com/advanced/custom-response/#fileresponse): transmissão do arquivo e cabeçalhos de resposta.
- [GitHub — segurança do Codespaces](https://docs.github.com/en/codespaces/reference/security-in-github-codespaces): autenticação das portas privadas. Essa documentação justifica reconhecer respostas HTML de autenticação; não comprova que essa foi a causa da falha relatada.

## Versão 0.3.0 — letra automática e transferências interrompidas

A nova captura de 25/11 mostra seis stems no manifesto, três recebidos e `Failed to fetch` em voz, bateria e outros. Isso comprova que a separação terminou nesse caso, mas não identifica, isoladamente, a causa de rede no Codespace. A captura anterior mostrava uma interface ainda mais antiga. A versão passa a ser visível como **v0.3.0**, com revisão e hash de fontes no build.

- O download usa intervalos HTTP Range de até 1 MiB, com duas tentativas por intervalo. Trechos recebidos ficam em memória para a recuperação na mesma aba; arquivos completos continuam salvos no projeto local. Recarregar a página perde os trechos parciais, preservando os áudios completos. `If-Range` e ETag evitam misturar revisões de arquivos. O WAV original continua sendo a opção de download; o mixer recebe AAC.
- Um teste provoca `Failed to fetch` na leitura do segundo intervalo depois de receber o primeiro MiB: a recuperação solicita apenas o intervalo pendente. Autorização/HTML de login continuam tendo diagnóstico próprio.
- Faster-whisper usa Whisper small CPU/int8, voz isolada, detecção automática do idioma e timestamps por palavra. A fila da letra mantém a tarefa de áudio concluída; cancelamento, repetição e recuperação de worker não removem os stems.
- A cifra usa um mix de guitarra, piano e outros; o peso de outros é menor quando há stems harmônicos dedicados. O estimador continua restrito a tríades maiores/menores.
- Execução real no navegador: upload de MP3 original de seis segundos, com voz sintetizada por FFmpeg/flite, tons de Em/C e percussão; Demucs gerou seis WAVs distintos, Basic Pitch gerou eventos, o estimador marcou Em, e Whisper reconheceu a frase “The guitar plays in the morning, we sing together through the night.” na voz separada. Mixer com seis stems e original silenciado, mute de guitarra, reprodução e destaque por palavra foram observados. A letra foi solicitada novamente sobre a mesma tarefa.
- 35 testes Python e 27 testes TypeScript, compilação de produção e execução real do script de reinício. O reinício confirmou API/worker/ASR, manifesto de versão e igualdade do HTML servido com o build local.

Essa amostra valida a integração. Não foi possível acessar o áudio de 4min30s do usuário ou sua sessão autenticada do Codespace para confirmar a recuperação específica naquele servidor. A precisão da letra cantada, dos acordes e da tablatura em músicas reais não é comprovada pelo teste com fala sintetizada.

Referências: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) e a implementação `app/faixalab/pipeline.py` do [FaixaLab](https://github.com/Marcelo-Preigschadt/FaixaLab), revisão do arquivo `3d63002127460416d187a867632df59fe9f7e655`. Foi reaproveitada a configuração técnica de ASR, mantendo o aplicativo guitarrock.

## Versão 0.3.1 — cifra no braço, recuperação harmônica e revisões

- A aba inicial **Cifra e braço** mostra um diagrama de acorde, notas nas cordas/casas e a sequência reconhecida. O braço alterna entre digitação sugerida do acorde e notas estimadas de guitarra/baixo. As posições não identificam a digitação original do músico.
- As digitações foram verificadas por classes de altura: 12 fundamentais e 10 qualidades produzem exatamente as notas do acorde. O detector de áudio continua cobrindo tríades maiores/menores; o dicionário visual também aceita acordes digitados manualmente, como sétimas e power chords.
- A cifra passa a ter dados próprios (`Project.harmony`). Importar letra não a apaga. Marcadores antigos com acordes simples também podem alimentar a visualização. Recalcular cifra usa os WAVs existentes, sem Demucs nem nova transcrição de notas.
- O gate de energia harmônica deixou de usar um limiar absoluto de .003, que descartava acompanhamento baixo. Usa nível relativo e inclui o baixo com peso reduzido. Um teste com Em/C mantém os mesmos acordes após redução de amplitude em 60 dB. A amostra de seis segundos, após separação, retornou Em até 3.04 s e C em seguida.
- Refinamento executado de verdade com os especialistas oficiais `04573f0d` (voz) e `f7e0c4bc` (bateria), sete segundos de contexto e 50% de sobreposição. A comparação SHA-256 confirmou preservação dos quatro outros WAVs e de todos os WAVs da tarefa anterior. A interface conserva uma cópia local anterior para comparação. Isso valida a execução e preservação, não uma melhoria perceptiva universal.
- Whisper large-v3-turbo CPU/int8 executado no MP3 original da amostra, com idioma inglês fixado, reconhecendo a frase de teste e timestamps. A interface permite escolher o idioma e refazer a letra no original; remove a letra anterior enquanto aguarda. Trechos com baixa confiança ficam sem palavras e são marcados para revisão. Confiança do modelo não comprova que a letra está correta.
- Navegador: resultado de IA salvo, recálculo de cifra sem separação, troca Em→C com atualização do diagrama e do braço, modo notas da faixa e seleção de idioma/refazer letra.

Não houve acesso ao áudio do usuário nesta rodada. A amostra contém fala sintetizada e instrumentos gerados para teste; não comprova a qualidade da voz cantada na música do usuário. O refinamento é opcional, adiciona duas inferências e não usa uma API paga.

Fonte dos especialistas: [configuração oficial de htdemucs_ft](https://github.com/facebookresearch/demucs/blob/main/demucs/remote/htdemucs_ft.yaml). O modo comum passa a usar janela de sete segundos e overlap de 50%; o conjunto de seis fontes continua experimental.

Validação final da versão 0.3.1: 40 testes Python, 32 testes TypeScript e build de produção aprovados.

## Versão 0.4.0 — guitarra ao vivo, pedaleira e aproximação de timbre

- Entrada real via `getUserMedia`, seleção de dispositivo/canal e processamento Web Audio/AudioWorklet no mesmo contexto do acompanhamento. Retorno desligado inicialmente; saída padrão −12 dB, medidor de RMS/pico, cancelamento de captura ao desconectar e encerramento dos processadores ao trocar de sessão. O indicador de latência é somente a estimativa de saída do navegador.
- Quinze módulos com parâmetros, bypass e ordem real editável. Amps Clean/Crunch/High gain e caixas 1×12/2×12/4×12 são modelos DSP. IRs importados usam convolução. Capturas `.nam` usam o motor headless de `neural-amp-modeler-wasm` 3.3.0 em WebAssembly/AudioWorklet. Somente a entrada `/engine` é importada; o componente React 18 dessa dependência não é usado. O override de peers conserva React 19 do aplicativo, e uma instalação limpa por `npm ci` foi validada.
- Busca automática de 63 comparações renderizadas com o mesmo DSP. Descritores por 24 bandas logarítmicas, crest factor e variação de energia; normalização de nível; busca entre amp, caixa, ganho, EQ e efeitos. Cada candidato só substitui o anterior se reduzir a distância. Não usa um modelo treinado de identificação de equipamentos e não foi apresentado como implementação de TAPE/AutoFX. O modo automático não otimiza NAM/IR externos.
- Referências do servidor são trechos mono de 48 kHz, limitados a 20 segundos, autenticados e em cache; testes executam FFmpeg real e verificam duração, canal, cache, isolamento, limites, silêncio após o fim e preservação do WAV original.
- Testes de navegador: renderização real dos 15 módulos com sinal sintético e silêncio, verificação de amostras finitas, carga dos AudioWorklets, reamplificação de DI e encerramento. A busca recuperou um alvo sintetizado pelo próprio DSP (High gain, 4×12, ganho 8, médios −5, agudos +5), reduzindo a distância de 11,61 a 0 em 63 comparações. Esse teste controlado não mede a fidelidade em uma música ou guitarra real.
- Teste da interface: importação de DI, referência, NAM Linear sintético de 48 kHz e IR de teste; reprodução, A/B, alteração da ordem e bypass de Delay, salvamento de presets e recarga com NAM/IR preservados. Referência carregada da guitarra da demonstração, mute da guitarra no mixer, preset por música, exportação `.riffsync`, importação e reprodução da DI restaurada. Em iframe de 390 px, o conteúdo não apresentou overflow horizontal da página (375 px úteis, excluída a barra de rolagem).
- O atualizador sincroniza dependências por hash do manifest/lockfile antes de compilar, evitando que um Codespace com `node_modules` antigo deixe de instalar o motor NAM. A instalação limpa foi executada; uma segunda execução reutilizou a instalação sem reinstalar.

A guitarra física, os drivers e a latência de ida e volta do equipamento do usuário não foram testados. Não houve acesso à gravação do usuário para avaliar a aproximação de timbre. Não foram baixadas ou incluídas capturas comerciais, nem alterados os modelos de separação, letra ou transcrição nesta versão.

Fontes técnicas: [NAM WASM](https://github.com/tone-3000/neural-amp-modeler-wasm), [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet), [OfflineAudioContext](https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext) e [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). As pesquisas AutoFX/TAPE serviram para avaliar os limites da proposta; não há seus pesos ou código de inferência neste recurso.

Validação final da versão 0.4.0: **41 testes Python 3.11 e 46 testes TypeScript aprovados**, build de produção aprovado, instalação limpa de dependências e checagem de sintaxe dos scripts aprovadas.

## Versão 0.4.1 — equipamentos visíveis e instalação no Codespace

A tela passa a mostrar a pedaleira aberta no início do estúdio, sem upload e sem conexão de áudio. Cabeçote com seis controles e modos Clean/Crunch/High gain; três gabinetes visuais selecionáveis; treze pedais em grade com seus controles, footswitch e ordem editável. Amplificador e gabinete continuam sendo os dois outros módulos da cadeia original de quinze. Os ajustes alteram os mesmos parâmetros DSP e a conexão fica abaixo do equipamento.

Na sessão real do usuário, o terminal mostrou que a atualização anterior falhou com HTTP 404 para `@use-gesture/react` e `@use-gesture/core` 10.4.0. O app permaneceu na 0.3.1 porque o reinício parou antes de recompilar. As duas dependências foram fixadas em **10.3.1**, com tarballs e integridades conferidos pelo npm do próprio Codespace. O lockfile usa as versões publicadas e o instalador informa explicitamente quando falha e a versão antiga pode continuar sendo exibida.

Validação local: instalação limpa, compilação TypeScript/build e 46 testes TypeScript; navegador sem conectar áudio confirmou treze pedais renderizados, troca de amp, ganho, caixa 4×12 e footswitch/drive do Overdrive habilitados e operantes.

## Versão 0.4.2 — biblioteca de amplificadores clássicos

- Doze perfis em seis marcas de referência, com cadeia Base e Solo com delay. A seleção é feita antes de conectar a entrada, atualiza cabeçote/caixa/knobs e preserva os ganhos gerais de entrada/saída. Projetos antigos sem perfil continuam válidos; perfis desconhecidos são recusados. Importação/exportação preserva perfil, parâmetros e variação.
- Os perfis usam duas saturações suaves com assimetria, filtro de entrada, brilho antes da saturação, filtragem entre estágios, cortes de DC/saída, frequências de médios/presença e voicing de caixa. São ajustes DSP originais, não modelos de circuitos derivados dos esquemas dos fabricantes, nem capturas de amplificadores reais. Nenhum modelo NAM comercial foi incluído.
- O ajuste automático compara também os doze presets de base, totalizando 75 avaliações. Não há rede neural de reconhecimento dos equipamentos originais.
- Navegador: 24 renders OfflineAudioContext de dois segundos com sinal sintético, todos finitos, sem clipping nessa amostra e com saída silenciosa para entrada zero. Os doze resultados de base foram distintos entre si. A troca de estrutura clássico → genérico → clássico manteve o sinal. Esses testes não validam fidelidade a amplificadores físicos ou a latência de ida e volta do equipamento do usuário.
- Interface: seleção das seis marcas sem pedir entrada de áudio; Solo com delay ligou o Delay e alterou o nome; o preset salvo e a variação foram restaurados após recarga. O visual do cabeçote acompanhou o fabricante/modelo selecionado.
- 50 testes TypeScript, 41 testes Python 3.11 e build de produção aprovados.

Referências consultadas para nomes, famílias e contexto dos modelos (os parâmetros DSP são decisões de projeto): [Marshall JCM800](https://www.marshall.com/us/en/product/jcm800-2203-vintage-reissue-head?pid=1007097), [Fender — válvulas dos modelos](https://support.fender.com/hc/en-us/articles/42507659450779-What-tubes-are-in-my-amp), [Mesa/Boogie Dual Rectifier](https://www.gibson.com/products/mesa-boogie-90s-dual-rectifier), [Orange — manual Rockerverb](https://orangeamps.com/wp-content/uploads/2011/04/Orange_RKMKII_User_Manual_web.pdf), [Laney Lionheart](https://www.laney.co.uk/amps/guitar/lionheart/l20h/), [Gibson — histórico](https://www.gibson.com/pages/gibson-amplifiers).
