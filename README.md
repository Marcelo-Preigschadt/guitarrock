# RiffSync

**Sua música. Seu jeito de tocar.**

Estúdio web para carregar uma gravação, separar instrumentos, criar acompanhamentos e sincronizar cifras e tablaturas com o áudio original. Interface em português, compatível com computador e celular.

## Funcionalidades implementadas

- Importação local de MP3, WAV, FLAC, OGG e M4A, conforme os codecs do navegador.
- Reprodução multifaixa usando um único relógio Web Audio e controle de volume, mute e solo por pista.
- Controle de visibilidade da notação independente do mute do áudio.
- Forma de onda com posição de reprodução, marcadores arrastáveis e repetição A–B.
- Importação de texto TXT, LRC e ChordPro; espaços de cifras e tablaturas ASCII são preservados. LRC mantém os timestamps.
- Sincronização manual por bloco ou linha: selecione o trecho, toque o áudio e pressione **M**, ou use **Marcar**. Tempos também podem ser digitados.
- Importação de Guitar Pro 3–8 e MusicXML via alphaTab, seleção de instrumento e marcação manual do início de cada compasso. O compasso sincronizado é destacado sobre a partitura.
- Separação real com Demucs: modelos `htdemucs` (4 pistas), `htdemucs_ft` (4 pistas, refinado) e `htdemucs_6s` (6 pistas, experimental).
- Transcrição de notas por stem com Basic Pitch; estimativa de cordas e casas para guitarra e baixo em afinação padrão. Piano mantém eventos de notas no projeto.
- Estimativa de acordes maiores/menores por chroma, segmentação rítmica e suavização temporal. Trechos sem evidência suficiente não recebem um acorde inventado.
- Fila SQLite persistente, worker separado da API, progresso por etapa, cancelamento e detecção de worker interrompido.
- Acesso às tarefas e arquivos restrito à chave aleatória da sessão do navegador.
- Projetos locais persistidos no IndexedDB, exportação/importação de `.riffsync` com áudios e partitura, download das pistas e exportação do acompanhamento em WAV.
- Cache offline do aplicativo após um carregamento completo da versão de produção. A IA exige o servidor; sessões já baixadas podem ser estudadas localmente.
- Demonstração de 19 segundos com arranjo original sintetizado. **A demonstração é identificada como tal e não simula resultados de IA.**

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

Pré-requisitos: **Python 3.11**, **Node.js 22**, **FFmpeg** e `libsndfile`.

```bash
bash scripts/setup.sh
bash scripts/start.sh
```

Abra **http://localhost:8000**. Os scripts são para Linux/macOS ou WSL. No Windows, Docker Desktop é a alternativa para executar a configuração completa.

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

## Configuração do backend

| Variável | Padrão | Finalidade |
|---|---|---|
| `RIFFSYNC_DATA` | `./data` | SQLite, uploads e resultados; deve ser compartilhado entre API e worker |
| `RIFFSYNC_DEVICE` | `auto` | `cpu`, `cuda` ou seleção automática |
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
| GET | `/api/jobs/{id}/files/{filename}` | Baixar uma pista finalizada |
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
```

O teste de modelos usa uma gravação sintetizada de 5 segundos, passa pelo endpoint de upload, separa seis instrumentos, transcreve os stems e verifica o download dos seis WAVs. Ele valida a integração; não mede qualidade musical em gravações comerciais.

## Limites da transcrição

A separação não recupera perfeitamente os instrumentos originais; vazamentos e artefatos afetam as notas detectadas. O modelo de seis pistas não garante a separação entre guitarra solo e base, e sua saída de piano é experimental. Basic Pitch estima alturas e durações; cordas/casas são uma digitação possível, não uma identificação da execução original. Bends, slides, ligaduras e articulações não são reconstruídos nesta versão. O estimador de cifras atual cobre tríades maiores/menores, não um dicionário completo de acordes. Todo material gerado pode ser complementado pelo editor manual ou substituído por TXT/Guitar Pro/MusicXML.

## Componentes utilizados

- [React](https://react.dev/) e [TypeScript](https://www.typescriptlang.org/)
- [alphaTab](https://alphatab.net/) — renderização musical, MPL-2.0
- [Demucs](https://github.com/facebookresearch/demucs) — separação, MIT; repositório original arquivado
- [Basic Pitch](https://github.com/spotify/basic-pitch) — transcrição, Apache-2.0
- [librosa](https://librosa.org/) — análise de áudio, ISC
- [FastAPI](https://fastapi.tiangolo.com/) — API Python, MIT
- [Lucide](https://lucide.dev/) — ícones, ISC
- DM Sans e Manrope — fontes distribuídas com o frontend, SIL Open Font License
