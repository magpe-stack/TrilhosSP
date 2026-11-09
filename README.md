# SP Trilhos - Guia do Metrô e Trem de São Paulo

PWA que funciona 100% offline para planejar rotas de metrô e trem na Grande São Paulo, explorar o mapa oficial em vetor e consultar o guia do passageiro.

- **App:** https://magpe-stack.github.io/TrilhosSP/
- **Repositório:** https://github.com/magpe-stack/TrilhosSP
- **Manual (este arquivo):** https://github.com/magpe-stack/TrilhosSP/blob/main/README.md

## Recursos

| Recurso | Como funciona |
|---|---|
| **Buscador de rotas offline** | Algoritmo de caminho mínimo ponderado (BFS com custos, fila de prioridade) sobre o grafo montado a partir de `dados.json`. Pesos em minutos por parada (metrô 2,0; trem 2,8) e penalidade de baldeação (6 min em "Mais rápida", 25 min em "Menos baldeações"). O tempo exibido é **estimativa**. |
| **Terminais de ônibus** | Estações com `terminal_onibus: true` aparecem com o ícone de ônibus nas etapas. A opção "Sugerir apenas estações com terminal de ônibus" filtra as sugestões de busca. |
| **Mapa SVG interativo** | `mapa.svg` é carregado inline. Arraste, zoom por roda do mouse, pinça, botões +/− e teclado. A rota calculada acende e o restante esmaece. Os chips de linha destacam qualquer linha manualmente. |
| **Guia do Passageiro** | Abas Metrô, Trens e Ônibus Metropolitanos, busca em tempo real e cartões sanfonados (bicicletas, pets, bagagens, achados e perdidos, bilhetagem). |
| **Projetos** | Novo Projeto, Meus Projetos (abrir, duplicar, exportar, imprimir, excluir), salvamento automático do projeto ativo. |
| **Backup completo** | Um único `.json` com todos os projetos, o projeto ativo e as preferências. |
| **Importar / Exportar / Imprimir** | Incluem todos os dados e estados: nome, anotações, origem, destino, preferência, filtro de terminais, rota calculada, linhas em destaque, visão (zoom/posição) do mapa e estado do guia. |
| **Light-First** | Inicia sempre no modo claro. O modo escuro é manual (menu) e fica salvo em `localStorage`. |
| **Tela cheia, Compartilhar, Instalar** | Fullscreen API, Web Share API (com arquivo `.json` quando suportado) e `beforeinstallprompt`. |
| **Acessibilidade** | HTML semântico, link "pular para o conteúdo", foco visível, alvos de toque ≥ 44 px, `aria-live` nos resultados, abas e cartões com ARIA, respeito a `prefers-reduced-motion`, contraste AA. |

## Estrutura

```
index.html      estrutura semântica
style.css       design system (tokens light/dark, mobile-first, split-view ≥ 1024 px, impressão)
app.js          lógica: grafo, roteamento, mapa, guia, projetos, PWA
sw.js           Service Worker (cache estático, offline)
manifest.json   configuração do PWA
dados.json      base de linhas e estações
mapa.svg        mapa oficial em vetor
icon-192.png    ícone do PWA
icon-512.png    ícone do PWA
README.md       esta documentação
```

## Publicar no GitHub Pages

1. Envie todos os arquivos acima para a raiz do repositório `magpe-stack/TrilhosSP` (branch `main`).
2. Em **Settings > Pages**, escolha *Deploy from a branch*, branch `main`, pasta `/ (root)`.
3. Abra `https://magpe-stack.github.io/TrilhosSP/`. Na primeira visita com internet o Service Worker guarda tudo; depois o app abre offline.
4. Ao alterar qualquer arquivo, incremente `VERSAO` em `sw.js` para forçar a atualização do cache.

Para testar localmente: `python3 -m http.server 8000` e abra `http://localhost:8000` (Service Workers exigem `localhost` ou HTTPS).

## Formatos de arquivo

Exportação de projeto (`sptrilhos.projeto`, versão 1):

```json
{ "formato": "sptrilhos.projeto", "versao": 1, "app": {...}, "exportadoEm": "ISO-8601",
  "base": { "linhas": 14, "estacoes": 200 },
  "projeto": { "id": "...", "nome": "...", "notas": "...", "criadoEm": "...", "atualizadoEm": "...",
               "estado": { "origemTexto": "", "destinoTexto": "", "origemId": "", "destinoId": "",
                           "criterio": "rapida|baldeacoes", "apenasTerminais": false,
                           "rota": { ... }, "mapa": { "viewBox": [x,y,w,h], "linhasDestacadas": ["L1"] },
                           "guia": { "aba": "metro", "termo": "" } } } }
```

Backup completo (`sptrilhos.backup`): `{ formato, versao, app, exportadoEm, preferencias: {tema}, projetoAtivoId, projetos: [ ... ] }`.

Na importação os projetos recebem novos ids (nada é sobrescrito) e todo conteúdo é validado e limitado em tamanho antes de ser gravado.

## Sobre o mapa SVG

O arquivo `mapa.svg` foi exportado como contornos, sem ids por estação. Por isso o destaque dinâmico é feito **por linha**: o app identifica as peças do desenho pela cor oficial de cada linha e acende as linhas usadas na rota, esmaecendo as demais. O trajeto exato (estação a estação) aparece na lista de etapas. Se o SVG for reexportado com ids (por exemplo `id="est-LUZ"`), é possível evoluir para destacar trechos e estações individuais.

## Correções de dados

Ao carregar, `app.js` aplica pequenas correções ao `dados.json` (função `aplicarCorrecoes`, controlada pela constante `CORRIGIR_DADOS`). Todas conferidas com o mapa oficial:

- **L1:** "Jabaquara / São Judas" renomeada para **São Judas**; adicionada **São Joaquim** (entre Vergueiro e Japão-Liberdade).
- **L4:** ordem corrigida para Luz, República, Higienópolis-Mackenzie, Paulista, Oscar Freire, Fradique Coutinho, Faria Lima, Pinheiros, Butantã, São Paulo-Morumbi, Vila Sônia.
- **L7 e L8:** Lapa passa a ser baldeação entre as duas linhas.
- **L12:** adicionadas Itaim Paulista, Jardim Romano e Engenheiro Manoel Feio.

Defina `CORRIGIR_DADOS = false` para usar o JSON exatamente como fornecido. Ainda ausentes da base: Linha 6-Laranja (em obras) e Linha 17-Ouro, que aparecem no mapa mas não no JSON.

Baldeações: o JSON lista apenas as linhas de conexão; o app liga a estação correspondente pelo nome (com o alias Paulista ↔ Consolação). Baldeações sem par são registradas no console.

## Privacidade

Nenhum dado sai do aparelho. Projetos e preferências usam `localStorage`; o único tráfego de rede é o carregamento inicial dos arquivos do app. Links externos (GitHub) abrem com `rel="noopener noreferrer"`.

## Fontes do guia (consultadas em nov/2026)

- Prefeitura de São Paulo, serviço "Bike no Metrô".
- CPTM, página "Bicicletas na CPTM".
- AASP, transporte de animais domésticos no Metrô, CPTM e EMTU (2019).
- B News São Paulo, achados e perdidos no Metrô e na CPTM.
- Diário do Transporte, tarifas de jan/2026 e Pix nas máquinas da Linha 1 (out/2026).
- Telefones e legenda: mapa oficial incluído em `mapa.svg`.

Regras e tarifas mudam. Confirme nos canais oficiais antes de viajar.

## Aviso

Projeto independente, sem vínculo oficial com Metrô, CPTM, ViaQuatro, ViaMobilidade, TIC Trens, Trivia ou ARTESP. Tempos de viagem são estimativas.
