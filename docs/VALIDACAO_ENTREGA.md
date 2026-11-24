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
