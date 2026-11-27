# Desempenho v0.6.0

O formato de entrada e o custo de inferência são etapas diferentes. MP3 local evita baixar o arquivo do YouTube; os modelos ainda precisam analisar cada janela da gravação.

## Medição local

CPU AMD EPYC 9V74, nove CPUs disponíveis por afinidade, PyTorch 2.5.1 CPU, precisão FP32. Entradas sintéticas de oito segundos para medir execução; não são testes de qualidade musical. Os testes com 2/8 threads usam o mesmo modelo e a mesma entrada.

| Operação | 2 threads | 8 threads | Escopo |
| --- | ---: | ---: | --- |
| Forward Demucs 6s | 9,716 s | 2,339 s | Um bloco de 7,8 s, sem shifts |
| Forward Mel-Band RoFormer | 31,982 s | 15,042 s | Um bloco de 8 s |

A maior diferença absoluta de saída do RoFormer nesse teste foi `2,91e-10`. A mudança de threads não aplica quantização, reduz janelas, remove instrumentos ou altera o número de estimativas.

O Superior completo levou 77,596 s na primeira execução da entrada sintética de 8 s, incluindo carregamento/primeiros downloads dos especialistas, inferência, validação e exportação. Reabrir o resultado verificado da mesma tarefa levou 0,0125 s e não executou modelos. Este segundo número mede **recuperação de cache**, não separação de uma música nova.

O protótipo RiffCore executou um passo real de treino em recorte sintético de 1 s e salvou um checkpoint. Sua inferência retornou seis fontes estéreo, alinhadas e finitas: 5,697 s para 8 s, medindo inferência com o modelo já carregado. O checkpoint tem somente um passo de treino de teste e **não é qualificado para uso musical**. Esse tempo não deve ser comparado como se tivesse o mesmo escopo do Superior completo acima.

## Mudanças gerais

- Orçamento de threads limitado por afinidade e quota cgroup; até oito por padrão. `RIFFSYNC_CPU_THREADS` permite override dentro da alocação disponível. Preferências explícitas OMP/MKL existentes continuam respeitadas.
- PyTorch, ONNX Runtime e Whisper recebem o mesmo orçamento. A sessão ONNX não cria um segundo conjunto irrestrito de threads para cada inferência de notas.
- Pistas são publicadas antes de cifras/notas. A análise tem fila persistente, progresso e geração independente; uma conclusão atrasada de análise cancelada não substitui uma nova solicitação.
- Checkpoints por modelo verificam hashes de áudio e parâmetros antes de reutilizar faixas; estados de RNG preservam as estimativas restantes na retomada. Caches corrompidos ou de outra entrada são invalidados.
- A análise musical foi exercitada com Basic Pitch ONNX real: eventos retornados para guitarra, baixo, piano, voz e bateria, sem falhas de dependência. O runtime fixa `setuptools<81` porque a versão de resampy exigida pelo Basic Pitch ainda importa `pkg_resources`.

Em servidor com somente duas CPUs, a nova política respeita esse limite. Não há ganho de 8 threads quando o hardware só oferece duas. Manter todos os modelos do Superior exige mais cálculo que um modelo único. O caminho de evolução RiffCore tenta transferir essa capacidade para um estudante mais barato, mas exige treino e qualificação medidos.
