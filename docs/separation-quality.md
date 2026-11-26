# Separação geral — validação v0.5.0

O perfil é fixo para todos os uploads. Nenhuma regra usa nome de arquivo, artista, gênero ou identificador de projeto. Os pesos não foram treinados nem ajustados nos trechos abaixo.

## Motor

- Voz: [Mel-Band RoFormer, Kimberley Jensen](https://github.com/KimberleyJensen/Mel-Band-Roformer-Vocal-Model), checkpoint MIT, revisão `ac9b0614ab3cd7f77219e18ba494dfd93956c348`, SHA256 `87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e`.
- Guitarra e piano: `htdemucs_6s`. Bateria: média com pesos fixos entre a estimativa de seis fontes e o especialista `f7e0c4bc`. Baixo: `d12395a8`. [Pesos oficiais dos especialistas](https://github.com/facebookresearch/demucs/blob/main/demucs/remote/htdemucs_ft.yaml).
- Todos recebem a mistura original em float32. Nenhum recebe uma faixa já separada. Demucs usa duas estimativas temporais; RoFormer usa janelas de 8 segundos com 50% de sobreposição.
- Ganho comum, WAV PCM24, alinhamento e duração preservados. Outros contém o residual. Isso preserva a soma do conjunto, mas não elimina erros de atribuição entre instrumentos.

## Comparação local

Dois trechos da amostra pública [MUSDB18 de aproximadamente 7 segundos](https://github.com/sigsep/sigsep-mus-db), conjunto **test**, decodificados em float32 a 44.100 Hz. A referência vem das faixas isoladas fornecidas pelo dataset. Os arquivos de música e os checkpoints não fazem parte deste repositório.

Métrica: SI-SDR em dB sobre o trecho estéreo concatenado, com remoção de média e projeção de ganho escalar. Não equivale ao SDR com filtros do museval nem a uma avaliação auditiva. Maior é melhor. Baseline: fluxo anterior, `htdemucs_6s`, 1 shift, janela 7 s, overlap 0,5. Perfil novo: RoFormer + especialistas, 2 shifts Demucs, janela até 7,8 s. O primeiro trecho reutilizou as estimativas de baixo/guitarra/piano já geradas na janela de 7 s; o segundo usou 7,8 s. A bateria abaixo usa o ensemble em 7,8 s nos dois trechos. O baseline tinha deslocamentos aleatórios sem seed fixa; valores podem variar entre execuções.

| Trecho | Faixa | Anterior | Novo | Diferença |
| --- | --- | ---: | ---: | ---: |
| AM Contra - Heart Peripheral | vocals | 10.62 | 13.31 | +2.69 |
| AM Contra - Heart Peripheral | drums | 6.75 | 7.12 | +0.37 |
| AM Contra - Heart Peripheral | bass | 1.07 | 1.50 | +0.43 |
| AM Contra - Heart Peripheral | other | -10.70 | -6.16 | +4.55 |
| Speak Softly - Broken Man | vocals | 6.05 | 12.71 | +6.66 |
| Speak Softly - Broken Man | drums | 7.76 | 8.18 | +0.43 |
| Speak Softly - Broken Man | bass | 17.07 | 18.76 | +1.69 |
| Speak Softly - Broken Man | other | 7.00 | 8.61 | +1.61 |

Para Outros, somam-se Outros + guitarra + piano antes de comparar, pois o dataset tem quatro fontes. Não há referência individual de guitarra/piano nesses trechos. A soma dos WAVs novos recuperou a entrada com erro máximo abaixo de `8e-7` por amostra, incluindo quantização.

Esses dois trechos são um teste de funcionamento e comparação, não uma prova de qualidade para qualquer gravação. Os ganhos variam, e a qualidade de guitarra/piano continua limitada pelo modelo experimental. O especialista de bateria sozinho piorou o primeiro trecho; por isso o motor mantém a estimativa complementar do modelo geral no ensemble. Os pesos de 50% são os mesmos para toda música.

## Verificações de confiabilidade

Os testes cobrem janelas curtas, longas e de tamanho ímpar; estéreo e fronteiras; silêncio; valores inválidos; preservação de alinhamento; clipping e ganho comum; checksum/cache de pesos; faixa faltante; revisão com upload existente; preservação dos WAVs anteriores, notação e letra; cancelamento; retentativa por memória e entrega parcial dos downloads. Os testes unitários não baixam modelos. A inferência real foi executada separadamente nos trechos citados.
