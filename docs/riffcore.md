# RiffCore — motor experimental de seis faixas

Estado: código de preparação, treino, avaliação e integração implementado; checkpoint de teste exercitado. **Pesos musicais qualificados ainda não existem neste projeto.** O aplicativo permanece no Superior.

## Arquitetura inicial

O professor é o Superior atual: Demucs 6s para guitarra/piano, RoFormer para voz, ensemble de bateria e especialista de baixo. Ele gera rótulos offline. O estudante inicial usa a arquitetura pré-treinada `htdemucs_6s`, com suas seis saídas, ajustada por perda de waveform e espectral em múltiplas resoluções. O RiffCore não é um modelo treinado do zero nem usa os modelos privados do Moises.

Na inferência, o candidato usa um único modelo e uma estimativa por janela, com sobreposição de 50%, sem a cadeia de quatro modelos do professor. O objetivo de pesquisa é transferir qualidade para essa execução menor. A qualidade resultante depende do corpus e do treinamento; a destilação pode também aprender erros do professor. Por isso a qualificação exige referências reais independentes.

Fontes técnicas consultadas: [Demucs](https://github.com/facebookresearch/demucs), [Mel-Band RoFormer vocal](https://github.com/KimberleyJensen/Mel-Band-Roformer-Vocal-Model) e [catálogo de modelos do MSST](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/docs/pretrained_models.md). SCNet foi considerado como outra base eficiente; os checkpoints listados consultados têm quatro fontes e não substituem diretamente guitarra/piano separados. O primeiro estudante começa na base já compatível com seis fontes.

## Dados

Todo treino recebe um manifesto explícito. Gravações e artistas devem ficar em um único split. Áudio estéreo a 44.100 Hz, em WAV/FLAC, com referências exatamente alinhadas em duração e canais. As seis chaves obrigatórias são `vocals`, `drums`, `bass`, `guitar`, `piano`, `other`.

```json
{
  "version": 1,
  "tracks": [{
    "id": "gravacao-001",
    "artist_id": "artista-a",
    "recording_id": "sessao-a-001",
    "split": "train",
    "label_type": "teacher",
    "genres": ["rock"],
    "mix": "gravacao-001/mix.wav",
    "gain": 1.0,
    "stems": {
      "vocals": "gravacao-001/vocals.wav",
      "drums": "gravacao-001/drums.wav",
      "bass": "gravacao-001/bass.wav",
      "guitar": "gravacao-001/guitar.wav",
      "piano": "gravacao-001/piano.wav",
      "other": "gravacao-001/other.wav"
    }
  }]
}
```

`gain` é a atenuação comum dos stems em relação à mistura original. O loader a compensa antes de treinar. Para referências originais, normalmente é `1.0`. Em registros de teste, use `label_type: ground_truth`, acrescente `baseline` com as seis faixas do Superior e `baseline_gain` com o ganho aplicado a elas.

## Preparação explícita de rótulos

Um catálogo `inputs.json` pode conter `tracks` com `id`, `artist_id`, `mix`, `split` e `genres`; `split` deve ser train/validation. Os caminhos são relativos ao catálogo. O comando seguinte decodifica as entradas selecionadas, executa o Superior uma vez por gravação e produz `labels/manifest.json` com rótulos marcados como teacher:

```bash
.venv/bin/python -m riffsync.riffcore.prepare data/riffcore/inputs.json data/riffcore/labels --device cpu
```

Essa preparação é custosa e ocorre offline. O comando usa o Superior mesmo que outro motor esteja configurado. Para qualificar o estudante, complete o corpus com gravações reais independentes em `split: test`, seus stems originais e as saídas de baseline do Superior. Rótulos do professor não contam como ground truth.

## Treino e avaliação

```bash
.venv/bin/python -m riffsync.riffcore.train data/riffcore/manifest.json data/riffcore/candidate.pt --dry-run
.venv/bin/python -m riffsync.riffcore.train data/riffcore/manifest.json data/riffcore/candidate.pt --steps 1000 --device cpu
.venv/bin/python -m riffsync.riffcore.evaluate data/riffcore/manifest.json data/riffcore/candidate.pt data/riffcore/qualification.json --device cpu
```

O treino usa somente train; acompanha até quatro recortes fixos de validation ao salvar. O checkpoint contém pesos, IDs dos conjuntos de desenvolvimento, hash do manifesto, parâmetros e passos realmente executados. A avaliação rejeita artistas/gravações de treino ou artistas de validação no teste. O passo de treino sintético executado durante o desenvolvimento apenas verifica gradientes, checkpoint e inferência; os pesos desse teste não são distribuídos como produto.

Para GPU NVIDIA compatível, é necessário ter o driver e uma instalação CUDA do PyTorch. O instalador padrão atual é CPU. Exemplo da variante oficial CUDA 12.4 para as versões usadas pelo projeto:

```bash
.venv/bin/python -m pip install 'torch==2.5.1+cu124' 'torchaudio==2.5.1+cu124' --index-url https://download.pytorch.org/whl/cu124
```

Depois use `--device cuda` no treino e na avaliação. Essa execução não foi validada em GPU neste ambiente.

## Critérios iniciais de qualificação

- Pelo menos 12 gravações reais de teste, com 30 s ou mais, e pelo menos três gêneros.
- Pelo menos quatro referências ativas para cada instrumento.
- Mediana da diferença de SI-SDR por instrumento >= -0,25 dB contra o Superior; percentil 10 >= -1 dB.
- Faixas com referência silenciosa não podem ganhar mais de 1 dB de vazamento em relação ao baseline.
- RTF mediano <= 0,5 e p95 <= 1,0 no hardware declarado. RTF é tempo de inferência dividido pela duração do áudio, com modelo carregado; decode/export são etapas distintas.

São critérios iniciais de engenharia, não prova de equivalência ao Moises nem garantia para qualquer gravação. A aprovação gera relatório com métricas, hardware e hash exato do checkpoint. Alterar os pesos invalida essa aprovação.

## Integração com o app

O padrão é `RIFFSYNC_ENGINE=superior`. Após qualificação aprovada, configure explicitamente `RIFFSYNC_ENGINE=riffcore`, `RIFFCORE_CHECKPOINT` e `RIFFCORE_REPORT` antes de iniciar os serviços. O runner exige pesos treinados e um relatório aprovado com hash correspondente. Usa RiffCore no perfil Superior de seis faixas; os outros perfis continuam disponíveis.

Checkpoint sem treino ou candidato reprovado é recusado antes da inferência. A seleção não é alterada automaticamente por um treino. A entrega segue o mesmo formato de seis WAVs PCM24, com ganho comum e residual em Outros, mantendo mixer e arranjo compatíveis.
