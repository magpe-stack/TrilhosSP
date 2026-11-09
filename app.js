/* ==========================================================================
 * SP Trilhos - app.js
 * Seções:
 *  1. Constantes e utilitários        6. Mapa SVG (zoom/pan/destaque)
 *  2. Ícones                          7. Guia do Passageiro
 *  3. Dados + grafo + Dijkstra/BFS    8. Projetos (estado, backup, import/export, impressão)
 *  4. Interface de rota               9. Menu, tema, tela cheia, PWA, Web Share
 *  5. Renderização do resultado      10. Inicialização
 * Somente APIs nativas: fetch, Cache/Service Worker, localStorage,
 * Fullscreen API, Web Share API, beforeinstallprompt.
 * ========================================================================== */
(function () {
  'use strict';

  /* ======================================================================
   * 1. CONSTANTES E UTILITÁRIOS
   * ==================================================================== */
  const APP = {
    nome: 'SP Trilhos',
    versao: '1.0.0',
    urlApp: 'https://magpe-stack.github.io/TrilhosSP/',
    urlRepo: 'https://github.com/magpe-stack/TrilhosSP',
    urlAjuda: 'https://github.com/magpe-stack/TrilhosSP/blob/main/README.md'
  };
  const LS = {
    projetos: 'sptrilhos:projetos',
    ativo: 'sptrilhos:ativo',
    tema: 'sptrilhos:tema'
  };
  const FORMATO_PROJETO = 'sptrilhos.projeto';
  const FORMATO_BACKUP = 'sptrilhos.backup';
  const VERSAO_FORMATO = 1;

  /* Corrige inconsistências conhecidas do JSON fornecido (ver README, "Correções de dados").
     Defina como false para usar o dados.json exatamente como veio. */
  const CORRIGIR_DADOS = true;

  /* Pesos do roteamento (minutos estimados). */
  const PESOS = {
    rapida: { baldeacao: 6 },
    baldeacoes: { baldeacao: 25 }
  };
  const LINHAS_METRO = new Set(['L1', 'L2', 'L3', 'L4', 'L5', 'L15']); // intervalo menor entre estações
  const MIN_PARADA = { metro: 2.0, trem: 2.8 };
  const ESPERA_INICIAL = 3;

  /* Cor de cada linha no SVG (rgb exato usado no arquivo mapa.svg). */
  const COR_SVG = {
    'rgb(0,82,160)': 'L1', 'rgb(0,128,97)': 'L2', 'rgb(239,63,53)': 'L3', 'rgb(255,212,0)': 'L4',
    'rgb(120,78,159)': 'L5', 'rgb(243,116,34)': 'L6', 'rgb(160,23,102)': 'L7', 'rgb(158,158,149)': 'L8',
    'rgb(0,168,142)': 'L9', 'rgb(0,124,142)': 'L10', 'rgb(240,77,34)': 'L11', 'rgb(4,63,136)': 'L12',
    'rgb(0,171,90)': 'L13', 'rgb(133,141,145)': 'L15', 'rgb(146,127,87)': 'L17'
  };

  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const $$ = (sel, raiz) => Array.from((raiz || document).querySelectorAll(sel));

  /** Cria elemento DOM de forma segura (sempre textContent, nunca innerHTML). */
  function h(tag, attrs, ...filhos) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.setAttribute('style', v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const f of filhos.flat()) {
      if (f === null || f === undefined || f === false) continue;
      el.append(f.nodeType ? f : document.createTextNode(String(f)));
    }
    return el;
  }

  const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const chaveNome = (s) => semAcento(s).toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const numLinha = (id) => id.replace('L', '');
  const corLinha = (id) => `var(--${id})`;
  const linhaEscura = (id) => id === 'L4'; // amarelo precisa de texto escuro (contraste)
  const agora = () => new Date().toISOString();
  const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const fmtData = (iso) => { try { return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); } catch (e) { return ''; } };
  const nomeLinhaCurto = (l) => `Linha ${l.id.replace('L', '')}${l.nome.includes('-') ? ' - ' + l.nome.split('-').slice(1).join('-').trim() : ''}`;

  function lerLS(chave, padrao) {
    try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; }
  }
  function gravarLS(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); return true; }
    catch (e) { toast('Não foi possível salvar: armazenamento cheio ou bloqueado.'); return false; }
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('visivel');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('visivel'), 3600);
  }

  /* ======================================================================
   * 2. ÍCONES (SVG inline, sem dependências)
   * ==================================================================== */
  const ICONES = {
    menu: 'M3 6h18M3 12h18M3 18h18',
    close: 'M6 6l12 12M18 6L6 18',
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
    map: 'M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
    book: 'M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2V5zM4 21h15',
    folder: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
    plus: 'M12 5v14M5 12h14',
    minus: 'M5 12h14',
    reset: 'M4 4v6h6M20 20v-6h-6M20 9A8 8 0 006.3 6.3L4 10M4 15a8 8 0 0013.7 2.7L20 14',
    save: 'M5 3h11l4 4v14H5V3zM8 3v6h7V3M8 21v-7h8v7',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    upload: 'M12 15V3M7 8l5-5 5 5M4 21h16',
    printer: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z',
    share: 'M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zM18 22a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
    archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
    moon: 'M21 13A9 9 0 1111 3a7 7 0 0010 10z',
    sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    fullscreen: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    exitfs: 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5',
    install: 'M12 3v12M7 11l5 5 5-5M5 21h14',
    info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 16v-5M12 8h.01',
    help: 'M12 22a10 10 0 100-20 10 10 0 000 20zM9.5 9a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01',
    route: 'M6 19a2 2 0 100-4 2 2 0 000 4zM18 9a2 2 0 100-4 2 2 0 000 4zM8 17h7a3 3 0 000-6H9a3 3 0 010-6h7',
    swap: 'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
    chevron: 'M6 9l6 6 6-6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
    open: 'M5 12h14M13 6l6 6-6 6',
    copy: 'M9 9h11v12H9zM5 15V3h11',
    bus: 'M5 4h14a1 1 0 011 1v12H4V5a1 1 0 011-1zM4 11h16M7 17v3M17 17v3M8 14h.01M16 14h.01',
    train: 'M7 3h10a2 2 0 012 2v10a3 3 0 01-3 3H8a3 3 0 01-3-3V5a2 2 0 012-2zM5 10h14M8 21l2-3M16 21l-2-3M9 14h.01M15 14h.01',
    bike: 'M6 18a3 3 0 100-6 3 3 0 000 6zM18 18a3 3 0 100-6 3 3 0 000 6zM6 15l4-8h5l3 8M10 7l3 8M9 4h3',
    paw: 'M8 11a2 2 0 100-4 2 2 0 000 4zM16 11a2 2 0 100-4 2 2 0 000 4zM4.5 15a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM19.5 15a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zM12 12c3 0 5 3 5 5.5S15 20 12 20s-5-.5-5-2.5S9 12 12 12z',
    bag: 'M5 8h14l1 13H4L5 8zM9 8V6a3 3 0 016 0v2',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3',
    ticket: 'M3 8a2 2 0 012-2h14a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H5a2 2 0 01-2-2v-2a2 2 0 000-4V8zM14 6v12',
    phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z',
    access: 'M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM6 8h12M12 8v6M8 21l4-7 4 7',
    clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 7v5l3 2',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
  };
  const GITHUB = 'M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.4-.5-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0012 .3';

  function icone(nome, extra) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ic' + (nome === 'github' ? ' fill' : '') + (extra ? ' ' + extra : ''));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', nome === 'github' ? GITHUB : (ICONES[nome] || ICONES.info));
    svg.appendChild(p);
    return svg;
  }
  function hidratarIcones(raiz) {
    $$('[data-icone]', raiz).forEach((el) => {
      if (el.querySelector(':scope > svg.ic')) return;
      el.prepend(icone(el.dataset.icone));
    });
  }

  /* ======================================================================
   * 3. DADOS, GRAFO E ROTEAMENTO
   * ==================================================================== */
  const D = {
    linhas: [],            // linhas (após correções)
    porLinha: new Map(),   // id -> linha
    nos: new Map(),        // 'L1:SAD' -> {chave, linha, idx, est, cluster}
    adj: new Map(),        // chave -> [{para, tipo}]
    clusters: new Map(),   // clusterId -> {id, nome, nomes[], nos[], linhas[], terminal}
    nomeParaCluster: new Map()
  };

  /* Correções documentadas (README). Cada uma é pequena e verificável no mapa oficial. */
  function aplicarCorrecoes(dados) {
    const L = (id) => dados.linhas.find((l) => l.id === id);
    // L1: "Jabaquara / São Judas" é a estação São Judas; falta São Joaquim.
    const l1 = L('L1');
    if (l1) {
      const jud = l1.estacoes.find((e) => e.id === 'JUD'); if (jud) jud.nome = 'São Judas';
      if (!l1.estacoes.some((e) => e.id === 'SJQ')) {
        const i = l1.estacoes.findIndex((e) => e.id === 'JAP');
        if (i > 0) l1.estacoes.splice(i, 0, { id: 'SJQ', nome: 'São Joaquim', terminal_onibus: false, baldeacoes: [] });
      }
    }
    // L4: ordem real Luz > República > Higienópolis > Paulista > ... > Faria Lima > Pinheiros > Butantã
    const l4 = L('L4');
    if (l4) {
      const ordem = ['LUZ_L4', 'REP_L4', 'HIG', 'PTA', 'OCS', 'FRD', 'FAR', 'PIN', 'BUT', 'SPO', 'VSO'];
      const mapa = new Map(l4.estacoes.map((e) => [e.id, e]));
      if (ordem.every((id) => mapa.has(id))) l4.estacoes = ordem.map((id) => mapa.get(id));
    }
    // L7 x L8: Lapa é estação de integração
    const l7 = L('L7'), l8 = L('L8');
    if (l7 && l8) {
      const a = l7.estacoes.find((e) => e.id === 'LAPA_7'), b = l8.estacoes.find((e) => e.id === 'LAPA_8');
      if (a && !a.baldeacoes.includes('L8')) a.baldeacoes.push('L8');
      if (b && !b.baldeacoes.includes('L7')) b.baldeacoes.push('L7');
    }
    // L12: estações presentes no mapa oficial e ausentes no JSON
    const l12 = L('L12');
    if (l12 && !l12.estacoes.some((e) => e.id === 'IPA_12')) {
      const i = l12.estacoes.findIndex((e) => e.id === 'ITQ_12');
      if (i > 0) l12.estacoes.splice(i, 0,
        { id: 'IPA_12', nome: 'Itaim Paulista', terminal_onibus: true, baldeacoes: [] },
        { id: 'JRO_12', nome: 'Jardim Romano', terminal_onibus: false, baldeacoes: [] },
        { id: 'EMF_12', nome: 'Engenheiro Manoel Feio', terminal_onibus: false, baldeacoes: [] });
    }
    return dados;
  }

  /* Estações que são a mesma estação física com nomes diferentes entre linhas. */
  const ALIAS = { paulista: 'consolacao' };

  function construirGrafo(dados) {
    D.linhas = dados.linhas;
    D.linhas.forEach((l) => D.porLinha.set(l.id, l));

    // nós + arestas de trajeto
    D.linhas.forEach((l) => {
      l.estacoes.forEach((e, idx) => {
        const chave = `${l.id}:${e.id}`;
        D.nos.set(chave, { chave, linha: l.id, idx, est: e });
        D.adj.set(chave, []);
      });
      for (let i = 0; i < l.estacoes.length - 1; i++) {
        const a = `${l.id}:${l.estacoes[i].id}`, b = `${l.id}:${l.estacoes[i + 1].id}`;
        D.adj.get(a).push({ para: b, tipo: 'trecho' });
        D.adj.get(b).push({ para: a, tipo: 'trecho' });
      }
    });

    // arestas de baldeação: usa o campo "baldeacoes" (linhas) e casa a estação pelo nome
    const pais = new Map(); // union-find
    const raiz = (x) => { while (pais.get(x) !== x) { pais.set(x, pais.get(pais.get(x))); x = pais.get(x); } return x; };
    const uniao = (a, b) => { const ra = raiz(a), rb = raiz(b); if (ra !== rb) pais.set(ra, rb); };
    D.nos.forEach((n, k) => pais.set(k, k));
    const chaveAlias = (n) => { const k = chaveNome(n); return ALIAS[k] || k; };

    D.nos.forEach((n) => {
      (n.est.baldeacoes || []).forEach((idLinha) => {
        const alvo = D.porLinha.get(idLinha);
        if (!alvo) return;
        const k = chaveAlias(n.est.nome);
        let par = alvo.estacoes.find((e) => chaveAlias(e.nome) === k);
        if (!par) { // plano B: maior sobreposição de palavras
          const palavras = new Set(k.split(' '));
          let melhor = 0;
          alvo.estacoes.forEach((e) => {
            const comuns = chaveAlias(e.nome).split(' ').filter((p) => p.length > 2 && palavras.has(p)).length;
            if (comuns > melhor) { melhor = comuns; par = e; }
          });
        }
        if (!par) { console.warn('[SP Trilhos] baldeação sem par:', n.est.nome, '->', idLinha); return; }
        const outra = `${idLinha}:${par.id}`;
        const lista = D.adj.get(n.chave);
        if (!lista.some((x) => x.para === outra)) lista.push({ para: outra, tipo: 'baldeacao' });
        const volta = D.adj.get(outra);
        if (!volta.some((x) => x.para === n.chave)) volta.push({ para: n.chave, tipo: 'baldeacao' });
        uniao(n.chave, outra);
      });
    });

    // estações físicas (clusters)
    const grupos = new Map();
    D.nos.forEach((n, k) => { const r = raiz(k); if (!grupos.has(r)) grupos.set(r, []); grupos.get(r).push(n); });
    const usados = new Map();
    grupos.forEach((nos, r) => {
      nos.forEach((n) => (n.cluster = r));
      const nomes = [...new Set(nos.map((n) => n.est.nome.replace(/\s*\(.*?\)\s*/g, '').trim()))];
      const linhas = [...new Set(nos.map((n) => n.linha))];
      let rotulo = nomes.join(' / ');
      const dupes = usados.get(rotulo) || 0; usados.set(rotulo, dupes + 1);
      if (dupes) rotulo += ` (${linhas.map(numLinha).map((x) => 'L' + x).join(', ')})`;
      D.clusters.set(r, { id: r, nome: rotulo, nomes, nos, linhas, terminal: nos.some((n) => n.est.terminal_onibus) });
    });
    // índice de busca por texto digitado
    D.clusters.forEach((c) => {
      D.nomeParaCluster.set(chaveNome(c.nome), c.id);
      c.nomes.forEach((n) => { const k = chaveNome(n); if (!D.nomeParaCluster.has(k)) D.nomeParaCluster.set(k, c.id); });
    });
  }

  /* Fila de prioridade mínima (heap binário) para o algoritmo ponderado. */
  class Heap {
    constructor() { this.a = []; }
    get tamanho() { return this.a.length; }
    push(item, prio) {
      const a = this.a; a.push({ item, prio });
      let i = a.length - 1;
      while (i > 0) { const p = (i - 1) >> 1; if (a[p].prio <= a[i].prio) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
    }
    pop() {
      const a = this.a, topo = a[0], fim = a.pop();
      if (a.length) {
        a[0] = fim; let i = 0;
        for (;;) {
          let m = i; const l = 2 * i + 1, r = l + 1;
          if (l < a.length && a[l].prio < a[m].prio) m = l;
          if (r < a.length && a[r].prio < a[m].prio) m = r;
          if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return topo;
    }
  }

  function minutosTrecho(idLinha) { return LINHAS_METRO.has(idLinha) ? MIN_PARADA.metro : MIN_PARADA.trem; }

  /**
   * Busca em largura ponderada (Dijkstra, equivalente a um BFS com custos) sobre o grafo offline.
   * Custo = minutos por parada (por linha) + penalidade de baldeação (depende do critério).
   * Retorna uma rota serializável ou null.
   */
  function calcularRota(idOrigem, idDestino, criterio) {
    const pesos = PESOS[criterio] || PESOS.rapida;
    const origem = D.clusters.get(idOrigem), destino = D.clusters.get(idDestino);
    if (!origem || !destino || idOrigem === idDestino) return null;
    const dist = new Map(), prev = new Map(), fila = new Heap();
    origem.nos.forEach((n) => { dist.set(n.chave, 0); fila.push(n.chave, 0); });
    let fim = null;
    while (fila.tamanho) {
      const { item: u, prio } = fila.pop();
      if (prio > (dist.get(u) ?? Infinity)) continue;
      if (D.nos.get(u).cluster === idDestino) { fim = u; break; }
      for (const { para, tipo } of D.adj.get(u)) {
        const peso = tipo === 'baldeacao' ? pesos.baldeacao : minutosTrecho(D.nos.get(para).linha);
        const nd = prio + peso;
        if (nd < (dist.get(para) ?? Infinity)) { dist.set(para, nd); prev.set(para, u); fila.push(para, nd); }
      }
    }
    if (!fim) return null;

    const caminho = [];
    for (let c = fim; c !== undefined; c = prev.get(c)) caminho.unshift(c);

    // agrupa em segmentos por linha
    const segmentos = [];
    let atual = null;
    caminho.forEach((chave) => {
      const n = D.nos.get(chave);
      if (!atual || atual.linha !== n.linha) { atual = { linha: n.linha, estacoes: [] }; segmentos.push(atual); }
      atual.estacoes.push({ id: n.est.id, nome: n.est.nome.replace(/\s*\(.*?\)\s*/g, '').trim(), terminal: !!n.est.terminal_onibus, idx: n.idx });
    });
    const limpos = segmentos;
    let paradas = 0, minutos = ESPERA_INICIAL;
    limpos.forEach((s) => {
      const l = D.porLinha.get(s.linha);
      const sentidoCresce = s.estacoes.length > 1 ? s.estacoes[1].idx > s.estacoes[0].idx : true;
      s.sentido = (sentidoCresce ? l.estacoes[l.estacoes.length - 1] : l.estacoes[0]).nome.replace(/\s*\(.*?\)\s*/g, '').trim();
      s.paradas = s.estacoes.length - 1;
      paradas += s.paradas;
      minutos += s.paradas * minutosTrecho(s.linha);
    });
    const baldeacoes = Math.max(0, limpos.length - 1);
    minutos += baldeacoes * PESOS.rapida.baldeacao;
    return {
      origem: origem.nome, destino: destino.nome, origemId: idOrigem, destinoId: idDestino, criterio,
      segmentos: limpos, paradas, baldeacoes, minutos: Math.round(minutos),
      linhas: [...new Set(limpos.map((s) => s.linha))]
    };
  }

  /* ======================================================================
   * 4. INTERFACE DE ROTA
   * ==================================================================== */
  const E = { // estado de tela
    rota: null,
    projetoId: null,
    deferredPrompt: null,
    view: 'rota',
    painel: 'form'
  };

  function popularLista(somenteTerminais) {
    const dl = $('#lista-estacoes');
    dl.textContent = '';
    [...D.clusters.values()]
      .filter((c) => !somenteTerminais || c.terminal)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .forEach((c) => dl.append(h('option', { value: c.nome, label: c.linhas.map((l) => 'L' + numLinha(l)).join(' ') + (c.terminal ? ' · 🚌' : '') })));
  }

  function acharCluster(texto) {
    const k = chaveNome(texto || '');
    if (!k) return null;
    if (D.nomeParaCluster.has(k)) return D.nomeParaCluster.get(k);
    // aproximação: único cluster cujo nome contém o texto digitado
    const cand = [...D.clusters.values()].filter((c) => chaveNome(c.nome).includes(k));
    return cand.length === 1 ? cand[0].id : null;
  }

  function submeterRota(ev) {
    if (ev) ev.preventDefault();
    const erro = $('#erro-rota');
    erro.textContent = '';
    const o = acharCluster($('#in-origem').value), d = acharCluster($('#in-destino').value);
    if (!o) { erro.textContent = 'Origem não encontrada. Escolha uma estação da lista de sugestões.'; $('#in-origem').focus(); return; }
    if (!d) { erro.textContent = 'Destino não encontrado. Escolha uma estação da lista de sugestões.'; $('#in-destino').focus(); return; }
    if (o === d) { erro.textContent = 'Origem e destino são a mesma estação.'; return; }
    const criterio = ($('input[name="criterio"]:checked') || {}).value || 'rapida';
    const rota = calcularRota(o, d, criterio);
    $('#in-origem').value = D.clusters.get(o).nome;
    $('#in-destino').value = D.clusters.get(d).nome;
    if (!rota) {
      E.rota = null; renderResultado(null);
      erro.textContent = 'Não há trajeto entre essas estações na base de dados atual.';
      return;
    }
    E.rota = rota;
    renderResultado(rota);
    mapaDestacar(rota.linhas);
    persistirAtivoSilencioso();
    const r = $('#resultado'); r.focus({ preventScroll: true }); r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function limparRota() {
    $('#in-origem').value = ''; $('#in-destino').value = '';
    $('#erro-rota').textContent = '';
    E.rota = null; renderResultado(null);
    mapaDestacar([]);
  }

  /* ======================================================================
   * 5. RENDERIZAÇÃO DO RESULTADO
   * ==================================================================== */
  function pilula(idLinha) {
    return h('span', { class: 'pilula-linha' + (linhaEscura(idLinha) ? ' escuro' : ''), style: `--cor:${corLinha(idLinha)}` }, 'L' + numLinha(idLinha));
  }
  function faixaRota(rota) {
    return h('div', { class: 'faixa', role: 'img', 'aria-label': 'Linhas do trajeto: ' + rota.segmentos.map((s) => 'Linha ' + numLinha(s.linha)).join(', ') },
      rota.segmentos.map((s) => h('i', { style: `flex:${Math.max(1, s.paradas)};background:${corLinha(s.linha)}` })));
  }
  function nomeLinhaCompleto(id) { const l = D.porLinha.get(id); return l ? l.nome : id; }

  /** Constrói a lista de etapas (usada na tela e na impressão). */
  function listaEtapas(rota) {
    const ol = h('ol', { class: 'etapas' });
    rota.segmentos.forEach((s, i) => {
      const ini = s.estacoes[0], fimE = s.estacoes[s.estacoes.length - 1];
      const meio = s.estacoes.slice(1, -1);
      const li = h('li', { class: 'etapa', style: `--cor:${corLinha(s.linha)}` },
        h('span', { class: 'bolinha', 'aria-hidden': 'true' }),
        h('h3', null, i === 0 ? 'Embarque em ' : 'Troque para ', pilula(s.linha), ' ',
          h('span', null, i === 0 ? ini.nome : nomeLinhaCompleto(s.linha))),
        h('p', null, nomeLinhaCompleto(s.linha), ' · sentido ', h('strong', null, s.sentido), ' · ',
          s.paradas + (s.paradas === 1 ? ' parada' : ' paradas'), ' até ', h('strong', null, fimE.nome),
          (i === 0 && ini.terminal) ? h('span', { class: 'tag-onibus' }, icone('bus'), 'terminal de ônibus em ' + ini.nome) : null,
          (fimE.terminal) ? h('span', { class: 'tag-onibus' }, icone('bus'), 'terminal de ônibus') : null),
        meio.length ? h('details', null, h('summary', null, `Ver ${meio.length} estações intermediárias`),
          h('ol', null, meio.map((m) => h('li', { class: m.terminal ? 'term' : '' }, m.nome)))) : null);
      ol.append(li);
      if (i < rota.segmentos.length - 1) {
        const prox = rota.segmentos[i + 1];
        ol.append(h('li', { class: 'baldeacao' }, h('strong', null, 'Baldeação em ' + fimE.nome + ': '), 'desça e siga a sinalização para a ',
          nomeLinhaCompleto(prox.linha) + '.'));
      }
    });
    return ol;
  }

  function renderResultado(rota) {
    const alvo = $('#resultado');
    alvo.textContent = '';
    if (!rota) return;
    alvo.append(
      h('h3', null, `${rota.origem} → ${rota.destino}`),
      h('div', { class: 'resumo' },
        h('div', null, h('strong', null, '≈ ' + rota.minutos), h('span', null, 'minutos (estimativa)')),
        h('div', null, h('strong', null, rota.paradas), h('span', null, rota.paradas === 1 ? 'parada' : 'paradas')),
        h('div', null, h('strong', null, rota.baldeacoes), h('span', null, rota.baldeacoes === 1 ? 'baldeação' : 'baldeações'))),
      faixaRota(rota),
      listaEtapas(rota),
      h('div', { class: 'acoes-resultado' },
        h('button', { type: 'button', class: 'btn primario', onclick: () => irPara('mapa') }, icone('map'), 'Ver no mapa'),
        h('button', { type: 'button', class: 'btn', onclick: () => salvarProjetoAtual() }, icone('save'), 'Salvar projeto'),
        h('button', { type: 'button', class: 'btn', onclick: compartilhar }, icone('share'), 'Compartilhar'),
        h('button', { type: 'button', class: 'btn', onclick: () => imprimirProjeto() }, icone('printer'), 'Imprimir')));
  }

  function textoRota(rota) {
    const linhas = [`${APP.nome}: ${rota.origem} → ${rota.destino}`, `≈ ${rota.minutos} min · ${rota.paradas} paradas · ${rota.baldeacoes} baldeação(ões)`];
    rota.segmentos.forEach((s, i) => linhas.push(`${i + 1}. ${nomeLinhaCompleto(s.linha)} (sentido ${s.sentido}): ${s.estacoes[0].nome} → ${s.estacoes[s.estacoes.length - 1].nome}`));
    linhas.push(APP.urlApp);
    return linhas.join('\n');
  }

  /* ======================================================================
   * 6. MAPA SVG (zoom, pan, destaque dinâmico)
   * ==================================================================== */
  const M = {
    svg: null, caixa: null,
    vb0: [0, 0, 4725, 7087], vb: [0, 0, 4725, 7087],
    pecas: new Map(), // 'L1' -> [g...]
    todas: [],
    selecionadas: new Set(),
    ponteiros: new Map(), pinchDist: 0, carregado: false
  };

  async function carregarMapa() {
    const caixa = M.caixa = $('#mapa-caixa');
    try {
      const resp = await fetch('mapa.svg');
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const texto = await resp.text();
      const doc = new DOMParser().parseFromString(texto, 'image/svg+xml');
      const svg = document.importNode(doc.documentElement, true);
      if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('SVG inválido');
      const vb = (svg.getAttribute('viewBox') || '0 0 4725 7087').split(/\s+/).map(Number);
      M.vb0 = vb.slice(); M.vb = vb.slice();
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Mapa do Transporte Metropolitano de São Paulo. Use os chips de linha acima para destacar uma linha.');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      $('#mapa-carregando').remove();
      caixa.append(svg);
      M.svg = svg;
      indexarMapa(svg);
      aplicarViewBox();
      ligarGestos(caixa);
      M.carregado = true;
      if (E.rota) mapaDestacar(E.rota.linhas);
    } catch (e) {
      console.error('[SP Trilhos] mapa:', e);
      const p = $('#mapa-carregando'); if (p) p.textContent = 'Não foi possível carregar o mapa (mapa.svg).';
    }
  }

  /* O SVG não tem ids; classificamos cada peça pela cor do preenchimento/traço. */
  function indexarMapa(svg) {
    const cor = (el) => {
      const st = el.getAttribute('style') || '';
      const m = st.match(/(?:fill|stroke):\s*(rgb\(\d+,\d+,\d+\))/g) || [];
      for (const x of m) { const c = x.replace(/^(?:fill|stroke):\s*/, ''); if (COR_SVG[c]) return COR_SVG[c]; }
      return null;
    };
    svg.querySelectorAll('path, rect, ellipse, use').forEach((el) => {
      const g = el.parentNode && el.parentNode.nodeName === 'g' && el.parentNode.getAttribute('transform') ? el.parentNode : el;
      g.classList.add('mp');
      const linha = cor(el);
      if (linha) { g.dataset.linha = linha; if (!M.pecas.has(linha)) M.pecas.set(linha, []); M.pecas.get(linha).push(g); }
      else g.classList.add('base');
      M.todas.push(g);
    });
  }

  function mapaDestacar(linhas) {
    M.selecionadas = new Set(linhas);
    const ativo = M.selecionadas.size > 0;
    if (M.caixa) M.caixa.classList.toggle('destaque', ativo);
    if (M.carregado) {
      M.pecas.forEach((gs, l) => { const on = M.selecionadas.has(l); gs.forEach((g) => g.classList.toggle('on', on)); });
    }
    $$('.chip-linha').forEach((c) => c.setAttribute('aria-pressed', String(M.selecionadas.has(c.dataset.linha))));
  }

  function aplicarViewBox() {
    if (!M.svg) return;
    M.svg.setAttribute('viewBox', M.vb.map((n) => +n.toFixed(1)).join(' '));
  }
  function limitarVB() {
    const [x0, y0, w0, h0] = M.vb0;
    M.vb[2] = Math.min(Math.max(M.vb[2], w0 / 10), w0); M.vb[3] = M.vb[2] * (h0 / w0);
    M.vb[0] = Math.min(Math.max(M.vb[0], x0 - w0 * 0.1), x0 + w0 * 1.1 - M.vb[2]);
    M.vb[1] = Math.min(Math.max(M.vb[1], y0 - h0 * 0.1), y0 + h0 * 1.1 - M.vb[3]);
  }
  /** Zoom em torno de um ponto da caixa (fx, fy em 0..1). */
  function zoomMapa(fator, fx = 0.5, fy = 0.5) {
    const [x, y, w, hh] = M.vb;
    const nw = w / fator, nh = hh / fator;
    M.vb = [x + (w - nw) * fx, y + (hh - nh) * fy, nw, nh];
    limitarVB(); aplicarViewBox();
  }
  function resetMapa() { M.vb = M.vb0.slice(); aplicarViewBox(); }

  function ligarGestos(caixa) {
    const rect = () => caixa.getBoundingClientRect();
    /* O SVG usa "meet": convertemos pixels da caixa em unidades do viewBox pela escala efetiva. */
    const escala = () => { const r = rect(); return Math.max(M.vb[2] / r.width, M.vb[3] / r.height); };
    caixa.addEventListener('pointerdown', (e) => {
      caixa.setPointerCapture(e.pointerId);
      M.ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
      caixa.classList.add('arrastando');
      if (M.ponteiros.size === 2) M.pinchDist = distPonteiros();
    });
    caixa.addEventListener('pointermove', (e) => {
      if (!M.ponteiros.has(e.pointerId)) return;
      const ant = M.ponteiros.get(e.pointerId);
      const novo = { x: e.clientX, y: e.clientY };
      M.ponteiros.set(e.pointerId, novo);
      if (M.ponteiros.size === 1) {
        const s = escala();
        M.vb[0] -= (novo.x - ant.x) * s; M.vb[1] -= (novo.y - ant.y) * s;
        limitarVB(); aplicarViewBox();
      } else if (M.ponteiros.size === 2) {
        const d = distPonteiros();
        if (M.pinchDist) {
          const r = rect(), pts = [...M.ponteiros.values()];
          const cx = ((pts[0].x + pts[1].x) / 2 - r.left) / r.width, cy = ((pts[0].y + pts[1].y) / 2 - r.top) / r.height;
          zoomMapa(d / M.pinchDist, cx, cy);
        }
        M.pinchDist = d;
      }
    });
    const fim = (e) => { M.ponteiros.delete(e.pointerId); M.pinchDist = 0; if (!M.ponteiros.size) caixa.classList.remove('arrastando'); };
    caixa.addEventListener('pointerup', fim); caixa.addEventListener('pointercancel', fim);
    caixa.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = rect();
      zoomMapa(e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    }, { passive: false });
    caixa.addEventListener('keydown', (e) => {
      const passo = M.vb[2] * 0.08;
      const mover = (dx, dy) => { M.vb[0] += dx; M.vb[1] += dy; limitarVB(); aplicarViewBox(); e.preventDefault(); };
      if (e.key === 'ArrowLeft') mover(-passo, 0); else if (e.key === 'ArrowRight') mover(passo, 0);
      else if (e.key === 'ArrowUp') mover(0, -passo); else if (e.key === 'ArrowDown') mover(0, passo);
      else if (e.key === '+' || e.key === '=') { zoomMapa(1.25); e.preventDefault(); }
      else if (e.key === '-') { zoomMapa(1 / 1.25); e.preventDefault(); }
      else if (e.key === '0') { resetMapa(); e.preventDefault(); }
    });
  }
  function distPonteiros() { const p = [...M.ponteiros.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); }

  function montarChips() {
    const alvo = $('#chips-linhas');
    D.linhas.forEach((l) => {
      alvo.append(h('button', {
        type: 'button', class: 'chip-linha' + (linhaEscura(l.id) ? ' escuro' : ''), style: `--cor:${corLinha(l.id)}`,
        'aria-pressed': 'false', 'aria-label': l.nome, title: l.nome, dataset: { linha: l.id },
        onclick: () => {
          const s = new Set(M.selecionadas);
          s.has(l.id) ? s.delete(l.id) : s.add(l.id);
          mapaDestacar([...s]);
        }
      }, numLinha(l.id)));
    });
  }

  /* ======================================================================
   * 7. GUIA DO PASSAGEIRO
   * ==================================================================== */
  const FONTES = 'Referências: Prefeitura de SP (Bike no Metrô), CPTM, Lei estadual de transporte de pets (AASP), Diário do Transporte. Confirme sempre nos canais oficiais.';
  const GUIA = {
    metro: [
      { id: 'm-bike', ic: 'bike', t: 'Bicicletas no Metrô', k: 'bicicleta bike ciclista dobravel bicicletario',
        corpo: () => [
          h('ul', null,
            h('li', null, h('strong', null, 'Segunda a sexta: '), '10h às 16h e das 21h até o fechamento.'),
            h('li', null, h('strong', null, 'Sábados, domingos e feriados: '), 'durante todo o funcionamento (4h40 à meia-noite).'),
            h('li', null, 'Máximo de 4 bicicletas por trem, sempre no último vagão.'),
            h('li', null, 'Bicicletas dobráveis entram a qualquer horário, embaladas em capa ou bolsa e com até 150 × 60 × 30 cm.'),
            h('li', null, 'Bicicletários: Sé, Corinthians-Itaquera, Guilhermina-Esperança e Carrão (6h às 22h, leve cadeado). Pinheiros e Butantã (Linha 4) são operados pela ViaQuatro.')),
          h('p', { class: 'fonte' }, 'Fonte: Prefeitura de São Paulo, serviço "Bike no Metrô".')] },
      { id: 'm-pet', ic: 'paw', t: 'Animais de estimação (pets)', k: 'pet animal cachorro gato cao guia caixa',
        corpo: () => [
          h('ul', null,
            h('li', null, 'Pequenos animais de até 10 kg, dentro de caixa de transporte adequada.'),
            h('li', null, 'Somente fora dos picos: 4h40-6h, 10h-16h e 19h-0h.'),
            h('li', null, 'Cão-guia acompanha a pessoa com deficiência em qualquer horário, sem caixa.'),
            h('li', null, 'Animais que ofereçam risco ou incômodo aos demais passageiros não são aceitos.')),
          h('p', { class: 'fonte' }, 'Regra baseada na lei estadual divulgada pela AASP (2019). Confirme com a operadora antes de viajar.')] },
      { id: 'm-bag', ic: 'bag', t: 'Bagagens e volumes', k: 'bagagem mala volume carrinho patinete',
        corpo: () => [
          h('ul', null,
            h('li', null, 'Prefira horários fora do pico e posicione a mala junto às pernas, sem bloquear portas ou corredores.'),
            h('li', null, 'Volumes grandes devem usar elevadores e áreas de acesso livre, sem ocupar assentos.'),
            h('li', null, 'Cada operadora define limites de tamanho e itens proibidos. Consulte a Central do Metrô: 0800 770 7722.'))] },
      { id: 'm-ach', ic: 'search', t: 'Achados e perdidos', k: 'achados perdidos objeto esqueci',
        corpo: () => [
          h('ul', null,
            h('li', null, h('strong', null, 'Metrô (L1, L2, L3, L15): '), 'Posto Central na estação Sé, seg-sex 7h às 20h (fecha em feriados). Guarda por até 60 dias.'),
            h('li', null, h('strong', null, 'Linha 4: '), 'Posto do Metrô na estação Sé (60 dias).'),
            h('li', null, h('strong', null, 'Linha 5: '), 'Estação Adolfo Pinheiro, seg-sex 7h às 19h (90 dias).'),
            h('li', null, 'Telefone: 0800 770 7722, que também consulta se o objeto foi achado em qualquer estação.'),
            h('li', null, 'Itens não reclamados seguem para o Fundo Social de Solidariedade; documentos voltam aos órgãos emissores.')),
          h('p', { class: 'fonte' }, 'Fonte: Metrô/CPTM, jan/2026. Horários podem mudar.')] },
      { id: 'm-bil', ic: 'ticket', t: 'Bilhetagem e tarifas', k: 'bilhete unico tarifa preco pix cartao integracao',
        corpo: () => [
          h('ul', null,
            h('li', null, 'Tarifa de metrô, trem e monotrilho: ', h('strong', null, 'R$ 5,40'), ' (desde 6/jan/2026).'),
            h('li', null, 'Integração ônibus SPTrans + metrô/trem: ', h('strong', null, 'R$ 9,38'), ' (ônibus municipal: R$ 5,30).'),
            h('li', null, 'Meios: Bilhete Único e bilhetes avulsos nas bilheterias e máquinas. Desde out/2026 as máquinas da Linha 1 aceitam Pix.'),
            h('li', null, 'A integração entre operadoras é regida por convênio, renovado periodicamente (último: out/2026).')),
          h('p', { class: 'fonte' }, 'Fonte: Diário do Transporte. Valores sujeitos a reajuste.')] },
      { id: 'm-acc', ic: 'access', t: 'Acessibilidade e prioridade', k: 'acessibilidade cadeirante elevador prioridade idoso gestante',
        corpo: () => [h('ul', null,
          h('li', null, 'Assentos e áreas preferenciais para idosos, gestantes, pessoas com deficiência e com crianças de colo.'),
          h('li', null, 'Estações possuem elevadores, pisos táteis e guichês de atendimento. Peça apoio a um agente de estação.'),
          h('li', null, 'Cão-guia tem acesso garantido por lei federal.'))] }
    ],
    trens: [
      { id: 't-op', ic: 'train', t: 'Linhas e operadoras (do app)', k: 'operadora concessionaria linha cptm viamobilidade tic trens',
        corpo: () => {
          const tb = h('table', { class: 'tabela-op' }, h('thead', null, h('tr', null, h('th', null, 'Linha'), h('th', null, 'Operadora'), h('th', null, 'Estações'))),
            h('tbody', null, D.linhas.map((l) => h('tr', null, h('td', null, pilula(l.id), ' ', l.nome.split('-').slice(1).join('-').trim()), h('td', null, l.concessionaria), h('td', null, l.estacoes.length)))));
          return [tb, h('p', { class: 'fonte' }, 'Dados do arquivo dados.json.')];
        } },
      { id: 't-bike', ic: 'bike', t: 'Bicicletas na CPTM', k: 'bicicleta bike ciclista dobravel bicicletario eletrica',
        corpo: () => [
          h('ul', null,
            h('li', null, h('strong', null, 'Segunda a sexta: '), '10h às 16h e após as 21h. Sábados, domingos e feriados: o dia todo.'),
            h('li', null, 'Até 4 bicicletas por viagem, no último carro, com prioridade para os demais passageiros.'),
            h('li', null, 'Dobráveis: qualquer horário, embaladas, até 150 × 60 × 30 cm.'),
            h('li', null, 'Elétricas: só as de tamanho convencional (duas rodas, propulsão humana com motor elétrico na roda).'),
            h('li', null, 'Grupos de 5 ou mais: avise a Central de Relacionamento com 10 dias úteis de antecedência.'),
            h('li', null, 'Bicicletários: todos os dias, 4h às 0h, com cadastro (documento, comprovante de endereço) e cadeado próprio. Menores de 18 só com adulto.')),
          h('p', { class: 'fonte' }, 'Fonte: CPTM, página "Bicicletas na CPTM". Atendimento: 0800 055 0121.')] },
      { id: 't-pet', ic: 'paw', t: 'Pets nos trens', k: 'pet animal cachorro gato caixa',
        corpo: () => [h('ul', null,
          h('li', null, 'Mesma regra do Metrô: até 10 kg, em caixa apropriada, fora dos picos (4h40-6h, 10h-16h, 19h-0h).'),
          h('li', null, 'Exceção no pico: procedimento cirúrgico agendado, com requerimento assinado por veterinário.'),
          h('li', null, 'Cão-guia é permitido sempre.'))] },
      { id: 't-bag', ic: 'bag', t: 'Bagagens, aeroporto e Expresso', k: 'bagagem mala aeroporto expresso guarulhos',
        corpo: () => [h('ul', null,
          h('li', null, 'Linha 13-Jade liga Engenheiro Goulart ao Aeroporto de Guarulhos. O mapa oficial também mostra o Expresso Aeroporto (tarifa própria, consulte a operadora).'),
          h('li', null, 'Malas: use as portas e áreas mais livres e evite horários de pico para não obstruir a circulação.'),
          h('li', null, 'Limites de volume variam por operadora; consulte os canais abaixo.'))] },
      { id: 't-ach', ic: 'search', t: 'Achados e perdidos', k: 'achados perdidos objeto esqueci',
        corpo: () => [h('ul', null,
          h('li', null, h('strong', null, 'CPTM: '), 'estação Palmeiras-Barra Funda, seg-sex 8h às 16h (fecha em feriados). 0800 055 0121 · WhatsApp (11) 99767-7030. Guarda por até 60 dias.'),
          h('li', null, h('strong', null, 'Linha 7 (TIC Trens): '), 'mesmo posto da CPTM em Barra Funda. 0800 007 0670.'),
          h('li', null, h('strong', null, 'Linhas 8 e 9: '), 'estação Osasco (90 dias). Pergunte também a qualquer agente.'),
          h('li', null, 'Site: cptm.sp.gov.br.'))] },
      { id: 't-bil', ic: 'ticket', t: 'Bilhetagem e tarifas', k: 'bilhete unico tarifa preco integracao ribeirao pires rio grande da serra',
        corpo: () => [h('ul', null,
          h('li', null, 'Tarifa única de metrô, trem e monotrilho: ', h('strong', null, 'R$ 5,40'), ' (jan/2026). A integração entre linhas e operadoras ferroviárias é feita na catraca.'),
          h('li', null, 'Ônibus SPTrans + trilhos: R$ 9,38.'),
          h('li', null, 'Rio Grande da Serra: ônibus intermunicipal + Linha 10: R$ 9,05.'),
          h('li', null, 'Grajaú: integração SPTrans + linhas metropolitanas: R$ 6,30.'))] },
      { id: 't-con', ic: 'phone', t: 'Contatos das operadoras', k: 'telefone contato sac 0800 central',
        corpo: () => [h('table', { class: 'tabela-op' }, h('tbody', null,
          [['Metrô', '0800 770 7722'], ['CPTM', '0800 055 0121'], ['Motiva (L4, L5)', '0800 770 7100'], ['ViaMobilidade (L8, L9)', '0800 770 7106'],
           ['TIC Trens (L7)', '0800 007 0670'], ['Trivia (L11, L12, L13)', '0800 074 6733'], ['ARTESP', '0800 727 8377'], ['SPTrans', '156']]
            .map(([n, t]) => h('tr', null, h('td', null, n), h('td', null, h('a', { href: 'tel:' + t.replace(/\D/g, '') }, t)))))),
          h('p', { class: 'fonte' }, 'Telefones conforme o mapa oficial fornecido. Confirme antes de ligar.')] }
    ],
    onibus: [
      { id: 'o-term', ic: 'bus', t: 'Terminais de ônibus integrados', k: 'terminal onibus integracao',
        corpo: () => {
          const n = [...D.clusters.values()].filter((c) => c.terminal).length;
          return [h('p', null, `No app, as estações com o ícone 🚌 têm terminal de ônibus integrado (${n} estações na base). Ative "Sugerir apenas estações com terminal de ônibus" para filtrar a busca.`),
            h('p', null, 'O mapa oficial identifica terminais de ônibus integrados, terminais rodoviários e o acesso a aeroportos.')];
        } },
      { id: 'o-cor', ic: 'route', t: 'Corredores metropolitanos (ARTESP)', k: 'corredor sao mateus jabaquara guarulhos itapevi artesp',
        corpo: () => [h('ul', null,
          h('li', null, h('strong', null, 'Corredor A: '), 'São Mateus-Jabaquara.'),
          h('li', null, h('strong', null, 'Corredor B: '), 'Guarulhos-SP.'),
          h('li', null, h('strong', null, 'Corredor C: '), 'Itapevi-SP.')),
          h('p', { class: 'fonte' }, 'Conforme a legenda do mapa oficial.')] },
      { id: 'o-tar', ic: 'ticket', t: 'Tarifas e bilhetagem', k: 'tarifa preco bilhete unico integracao emtu artesp',
        corpo: () => [h('ul', null,
          h('li', null, 'Linhas comuns: de R$ 4,15 a R$ 12,00. Seletivas: de R$ 9,05 a R$ 30,65 (jan/2026).'),
          h('li', null, 'Guarulhos-Tatuapé (comum): R$ 8,35. Seletivas de Guarulhos a Congonhas e outros destinos: R$ 68,05.'),
          h('li', null, 'Integração com metrô/trem varia por linha. Consulte a ARTESP: 0800 727 8377.')),
          h('p', { class: 'fonte' }, 'Fonte: Diário do Transporte, jan/2026.')] },
      { id: 'o-pet', ic: 'paw', t: 'Pets nos ônibus metropolitanos', k: 'pet animal cachorro gato caixa',
        corpo: () => [h('ul', null,
          h('li', null, 'A lei estadual cobre também os ônibus intermunicipais da EMTU: até 10 kg, em caixa de transporte, fora dos horários de pico.'),
          h('li', null, 'Cão-guia é permitido sempre.'))] },
      { id: 'o-bike', ic: 'bike', t: 'Bicicletas e bagagens', k: 'bicicleta bike bagagem mala bagageiro',
        corpo: () => [h('ul', null,
          h('li', null, 'As regras variam por linha e operadora. Bicicletas dobráveis embaladas costumam ser aceitas; as demais dependem da disponibilidade de bagageiro.'),
          h('li', null, 'Linhas seletivas e de aeroporto têm bagageiro para malas. Em linhas comuns, evite volumes que obstruam o corredor.'),
          h('li', null, 'Confirme com a operadora da linha ou com a ARTESP: 0800 727 8377.'))] },
      { id: 'o-ach', ic: 'search', t: 'Achados e perdidos', k: 'achados perdidos objeto esqueci',
        corpo: () => [h('ul', null,
          h('li', null, 'Procure a operadora da linha em que viajou (consta no bilhete e no ônibus) ou o terminal onde o ônibus encerra a viagem.'),
          h('li', null, 'ARTESP: 0800 727 8377. Informe linha, horário, prefixo do veículo e descrição do objeto.'),
          h('li', null, 'Se perdeu na estação de metrô/trem, veja as abas Metrô e Trens.'))] }
    ]
  };
  const G = { aba: 'metro', termo: '' };

  function cartaoGuia(c) {
    const idCorpo = 'g-' + c.id;
    const corpo = h('div', { class: 'corpo', id: idCorpo, hidden: true, role: 'region', 'aria-labelledby': idCorpo + '-b' }, c.corpo());
    const btn = h('button', { type: 'button', id: idCorpo + '-b', 'aria-expanded': 'false', 'aria-controls': idCorpo },
      icone(c.ic), h('span', null, c.t), icone('chevron', 'seta'));
    btn.addEventListener('click', () => {
      const aberto = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!aberto)); corpo.hidden = aberto;
    });
    return h('article', { class: 'cartao' }, h('h3', null, btn), corpo);
  }
  function renderGuia() {
    const painel = $('#pnl-guia');
    painel.textContent = '';
    const termo = chaveNome(G.termo);
    const casa = (c) => !termo || chaveNome(c.t + ' ' + c.k).includes(termo);
    const lista = GUIA[G.aba].filter(casa);
    lista.forEach((c) => { const el = cartaoGuia(c); painel.append(el); if (termo) { const b = $('button', el); b.click(); } });
    if (!lista.length) painel.append(h('p', { class: 'vazio' }, 'Nenhum cartão encontrado nesta aba.'));
    const nomes = { metro: 'Metrô', trens: 'Trens', onibus: 'Ônibus' };
    const outras = Object.keys(GUIA).filter((a) => a !== G.aba).map((a) => [a, GUIA[a].filter(casa).length]).filter(([, n]) => n);
    $('#guia-status').textContent = termo
      ? `${lista.length} resultado(s) em ${nomes[G.aba]}` + (outras.length ? ` · também em: ${outras.map(([a, n]) => `${nomes[a]} (${n})`).join(', ')}` : '')
      : FONTES;
    $$('.abas [role="tab"]').forEach((t) => { const sel = t.dataset.aba === G.aba; t.setAttribute('aria-selected', String(sel)); t.tabIndex = sel ? 0 : -1; });
    painel.setAttribute('aria-labelledby', 'tab-' + G.aba);
  }

  /* ======================================================================
   * 8. PROJETOS: estado, persistência, exportar/importar/backup/imprimir
   * ==================================================================== */
  const lerProjetos = () => { const v = lerLS(LS.projetos, []); return Array.isArray(v) ? v : []; };
  const gravarProjetos = (lista) => gravarLS(LS.projetos, lista);
  const projetoPorId = (id) => lerProjetos().find((p) => p.id === id) || null;

  /** Captura TODO o estado do projeto: formulário, resultado, destaque e visão do mapa. */
  function capturarEstado() {
    return {
      origemTexto: $('#in-origem').value, destinoTexto: $('#in-destino').value,
      origemId: acharCluster($('#in-origem').value), destinoId: acharCluster($('#in-destino').value),
      criterio: ($('input[name="criterio"]:checked') || {}).value || 'rapida',
      apenasTerminais: $('#chk-terminais').checked,
      rota: E.rota ? JSON.parse(JSON.stringify(E.rota)) : null,
      mapa: { viewBox: M.vb.slice(), linhasDestacadas: [...M.selecionadas] },
      guia: { aba: G.aba, termo: G.termo }
    };
  }

  function aplicarEstado(est) {
    if (!est) return;
    $('#in-origem').value = est.origemTexto || '';
    $('#in-destino').value = est.destinoTexto || '';
    const r = $(`input[name="criterio"][value="${est.criterio}"]`); if (r) r.checked = true;
    $('#chk-terminais').checked = !!est.apenasTerminais; popularLista(!!est.apenasTerminais);
    E.rota = null;
    if (est.origemId && est.destinoId && D.clusters.has(est.origemId) && D.clusters.has(est.destinoId)) E.rota = calcularRota(est.origemId, est.destinoId, est.criterio);
    if (!E.rota && est.rota) E.rota = est.rota; // mantém o instantâneo salvo se a base mudou
    renderResultado(E.rota);
    if (est.mapa) {
      if (Array.isArray(est.mapa.viewBox) && est.mapa.viewBox.length === 4 && est.mapa.viewBox.every(Number.isFinite)) { M.vb = est.mapa.viewBox.slice(); limitarVB(); aplicarViewBox(); }
      mapaDestacar(E.rota ? E.rota.linhas : (est.mapa.linhasDestacadas || []).filter((l) => D.porLinha.has(l)));
    } else mapaDestacar(E.rota ? E.rota.linhas : []);
    if (est.guia && GUIA[est.guia.aba]) { G.aba = est.guia.aba; G.termo = est.guia.termo || ''; $('#busca-guia').value = G.termo; renderGuia(); }
  }

  function atualizarInfoProjeto() {
    const p = E.projetoId ? projetoPorId(E.projetoId) : null;
    $('#projeto-ativo-info').textContent = p ? `Projeto ativo: ${p.nome}` : 'Sem projeto ativo. Salve para guardar esta rota.';
  }
  function definirAtivo(id) { E.projetoId = id; gravarLS(LS.ativo, id); atualizarInfoProjeto(); }

  function salvarProjetoAtual(nomeNovo, notas) {
    const lista = lerProjetos();
    let p = E.projetoId ? lista.find((x) => x.id === E.projetoId) : null;
    if (!p) {
      const padrao = E.rota ? `${E.rota.origem} → ${E.rota.destino}` : 'Projeto sem título';
      p = { id: novoId(), nome: (nomeNovo || padrao).slice(0, 80), notas: notas || '', criadoEm: agora() };
      lista.unshift(p);
    }
    if (nomeNovo) p.nome = nomeNovo.slice(0, 80);
    if (notas !== undefined) p.notas = notas;
    p.estado = capturarEstado(); p.atualizadoEm = agora();
    if (gravarProjetos(lista)) { definirAtivo(p.id); renderProjetos(); toast(`Projeto "${p.nome}" salvo.`); }
  }
  function persistirAtivoSilencioso() {
    if (!E.projetoId) return;
    const lista = lerProjetos(), p = lista.find((x) => x.id === E.projetoId);
    if (p) { p.estado = capturarEstado(); p.atualizadoEm = agora(); gravarProjetos(lista); }
  }

  function abrirNovoProjeto() {
    const dlg = $('#dlg-projeto');
    $('#proj-nome').value = ''; $('#proj-notas').value = '';
    fecharMenu();
    dlg.showModal(); $('#proj-nome').focus();
  }
  function criarProjetoNovo(ev) {
    ev.preventDefault();
    const nome = $('#proj-nome').value.trim();
    if (!nome) { $('#proj-nome').focus(); return; }
    const notas = $('#proj-notas').value;
    $('#dlg-projeto').close();
    // projeto novo = estado limpo
    limparRota(); definirAtivo(null);
    $('#chk-terminais').checked = false; popularLista(false);
    const lista = lerProjetos();
    const p = { id: novoId(), nome: nome.slice(0, 80), notas, criadoEm: agora(), atualizadoEm: agora(), estado: capturarEstado() };
    lista.unshift(p); gravarProjetos(lista); definirAtivo(p.id); renderProjetos();
    toast(`Projeto "${p.nome}" criado.`); irPara('rota');
  }

  function abrirProjeto(id) {
    const p = projetoPorId(id); if (!p) return;
    definirAtivo(id); aplicarEstado(p.estado); irPara('rota'); toast(`Projeto "${p.nome}" aberto.`);
  }
  function excluirProjeto(id) {
    const p = projetoPorId(id); if (!p) return;
    if (!confirm(`Excluir o projeto "${p.nome}"? Esta ação não pode ser desfeita.`)) return;
    gravarProjetos(lerProjetos().filter((x) => x.id !== id));
    if (E.projetoId === id) definirAtivo(null);
    renderProjetos(); toast('Projeto excluído.');
  }
  function duplicarProjeto(id) {
    const lista = lerProjetos(), p = lista.find((x) => x.id === id); if (!p) return;
    const c = JSON.parse(JSON.stringify(p)); c.id = novoId(); c.nome = (p.nome + ' (cópia)').slice(0, 80); c.criadoEm = c.atualizadoEm = agora();
    lista.unshift(c); gravarProjetos(lista); renderProjetos(); toast('Projeto duplicado.');
  }

  function renderProjetos() {
    const ul = $('#lista-projetos'); ul.textContent = '';
    const lista = lerProjetos();
    if (!lista.length) { ul.append(h('li', { class: 'vazio' }, 'Nenhum projeto ainda. Calcule uma rota e toque em "Salvar projeto", ou crie um Novo Projeto.')); return; }
    lista.forEach((p) => {
      const r = p.estado && p.estado.rota;
      ul.append(h('li', { class: 'proj' + (p.id === E.projetoId ? ' ativo' : '') },
        h('h3', null, p.nome, p.id === E.projetoId ? ' (ativo)' : ''),
        h('p', { class: 'meta' }, 'Atualizado em ' + fmtData(p.atualizadoEm || p.criadoEm)),
        r ? h('p', { class: 'rota-txt' }, `${r.origem} → ${r.destino} · ≈ ${r.minutos} min · ${r.baldeacoes} baldeação(ões)`) : h('p', { class: 'rota-txt dica' }, 'Sem rota calculada.'),
        r ? h('div', { class: 'linhas' }, (r.linhas || []).map(pilula)) : null,
        p.notas ? h('p', { class: 'dica' }, p.notas) : null,
        h('div', { class: 'botoes' },
          h('button', { type: 'button', class: 'btn mini primario', onclick: () => abrirProjeto(p.id) }, icone('open'), 'Abrir'),
          h('button', { type: 'button', class: 'btn mini', onclick: () => exportarProjeto(p.id) }, icone('download'), 'Exportar'),
          h('button', { type: 'button', class: 'btn mini', onclick: () => imprimirProjeto(p.id) }, icone('printer'), 'Imprimir'),
          h('button', { type: 'button', class: 'btn mini', onclick: () => duplicarProjeto(p.id) }, icone('copy'), 'Duplicar'),
          h('button', { type: 'button', class: 'btn mini perigo', onclick: () => excluirProjeto(p.id) }, icone('trash'), 'Excluir'))));
    });
  }

  /* --- arquivos --- */
  function baixarArquivo(nome, conteudo, tipo) {
    const blob = new Blob([conteudo], { type: tipo || 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: nome }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const slug = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'projeto';
  const dia = () => new Date().toISOString().slice(0, 10);

  /** Pega o projeto pedido, ou o ativo (sincronizado com a tela), ou um instantâneo da tela. */
  function projetoParaAcao(id) {
    if (id) return projetoPorId(id);
    if (E.projetoId) { persistirAtivoSilencioso(); return projetoPorId(E.projetoId); }
    if (!E.rota && !$('#in-origem').value) return null;
    return { id: novoId(), nome: E.rota ? `${E.rota.origem} → ${E.rota.destino}` : 'Projeto sem título', notas: '', criadoEm: agora(), atualizadoEm: agora(), estado: capturarEstado() };
  }
  function envelopeProjeto(p) {
    return { formato: FORMATO_PROJETO, versao: VERSAO_FORMATO, app: { nome: APP.nome, versao: APP.versao, url: APP.urlApp }, exportadoEm: agora(),
      base: { linhas: D.linhas.length, estacoes: D.nos.size }, projeto: p };
  }
  function exportarProjeto(id) {
    const p = projetoParaAcao(id);
    if (!p) { toast('Não há projeto para exportar. Calcule uma rota ou crie um projeto.'); return; }
    baixarArquivo(`sptrilhos-${slug(p.nome)}-${dia()}.json`, JSON.stringify(envelopeProjeto(p), null, 2));
    toast('Projeto exportado.');
  }
  function backupCompleto() {
    persistirAtivoSilencioso();
    const dados = { formato: FORMATO_BACKUP, versao: VERSAO_FORMATO, app: { nome: APP.nome, versao: APP.versao, url: APP.urlApp }, exportadoEm: agora(),
      preferencias: { tema: document.documentElement.getAttribute('data-tema') }, projetoAtivoId: E.projetoId, projetos: lerProjetos() };
    baixarArquivo(`sptrilhos-backup-completo-${dia()}.json`, JSON.stringify(dados, null, 2));
    toast(`Backup completo gerado (${dados.projetos.length} projeto(s)).`);
  }

  /** Valida e normaliza um projeto importado (nunca confia no arquivo). */
  function sanearProjeto(p) {
    if (!p || typeof p !== 'object') return null;
    const s = { id: novoId(), nome: String(p.nome || 'Projeto importado').slice(0, 80), notas: String(p.notas || '').slice(0, 2000),
      criadoEm: typeof p.criadoEm === 'string' ? p.criadoEm : agora(), atualizadoEm: agora() };
    const e = p.estado && typeof p.estado === 'object' ? p.estado : {};
    s.estado = {
      origemTexto: String(e.origemTexto || '').slice(0, 120), destinoTexto: String(e.destinoTexto || '').slice(0, 120),
      origemId: typeof e.origemId === 'string' ? e.origemId : null, destinoId: typeof e.destinoId === 'string' ? e.destinoId : null,
      criterio: e.criterio === 'baldeacoes' ? 'baldeacoes' : 'rapida', apenasTerminais: !!e.apenasTerminais,
      rota: e.rota && typeof e.rota === 'object' && Array.isArray(e.rota.segmentos) ? e.rota : null,
      mapa: e.mapa && typeof e.mapa === 'object' ? { viewBox: Array.isArray(e.mapa.viewBox) ? e.mapa.viewBox.map(Number) : null, linhasDestacadas: Array.isArray(e.mapa.linhasDestacadas) ? e.mapa.linhasDestacadas.map(String) : [] } : null,
      guia: e.guia && typeof e.guia === 'object' ? { aba: String(e.guia.aba || 'metro'), termo: String(e.guia.termo || '').slice(0, 80) } : null
    };
    return s;
  }
  async function importarArquivo(arquivo) {
    if (!arquivo) return;
    try {
      if (arquivo.size > 20 * 1024 * 1024) throw new Error('Arquivo muito grande.');
      const dados = JSON.parse(await arquivo.text());
      let novos = [];
      if (dados.formato === FORMATO_BACKUP && Array.isArray(dados.projetos)) novos = dados.projetos.map(sanearProjeto).filter(Boolean);
      else if (dados.formato === FORMATO_PROJETO && dados.projeto) novos = [sanearProjeto(dados.projeto)].filter(Boolean);
      else throw new Error('Formato não reconhecido. Use um arquivo exportado pelo SP Trilhos.');
      if (!novos.length) throw new Error('O arquivo não contém projetos.');
      const lista = lerProjetos();
      novos.forEach((n) => lista.unshift(n));
      if (!gravarProjetos(lista)) return;
      if (dados.formato === FORMATO_BACKUP && dados.preferencias && dados.preferencias.tema) aplicarTema(dados.preferencias.tema === 'dark' ? 'dark' : 'light');
      renderProjetos(); irPara('projetos');
      toast(`${novos.length} projeto(s) importado(s).`);
    } catch (e) { toast('Falha ao importar: ' + e.message); }
    finally { $('#arquivo-importar').value = ''; }
  }

  /* --- impressão: todos os dados do projeto --- */
  function imprimirProjeto(id) {
    const p = projetoParaAcao(id);
    if (!p) { toast('Não há projeto para imprimir. Calcule uma rota primeiro.'); return; }
    const est = p.estado || {}, r = est.rota;
    const area = $('#area-impressao'); area.textContent = '';
    area.append(
      h('h1', null, `${APP.nome} · ${p.nome}`),
      h('p', null, `Criado em ${fmtData(p.criadoEm)} · Atualizado em ${fmtData(p.atualizadoEm)} · Impresso em ${fmtData(agora())}`),
      h('h2', null, 'Dados do projeto'),
      h('table', null, h('tbody', null,
        h('tr', null, h('th', null, 'Origem'), h('td', null, est.origemTexto || '-')),
        h('tr', null, h('th', null, 'Destino'), h('td', null, est.destinoTexto || '-')),
        h('tr', null, h('th', null, 'Preferência'), h('td', null, est.criterio === 'baldeacoes' ? 'Menos baldeações' : 'Mais rápida')),
        h('tr', null, h('th', null, 'Somente terminais de ônibus'), h('td', null, est.apenasTerminais ? 'Sim' : 'Não')),
        h('tr', null, h('th', null, 'Linhas em destaque no mapa'), h('td', null, ((est.mapa && est.mapa.linhasDestacadas) || []).map((l) => nomeLinhaCompleto(l)).join('; ') || '-')),
        h('tr', null, h('th', null, 'Anotações'), h('td', null, p.notas || '-')))));
    if (r && r.segmentos) {
      area.append(h('h2', null, 'Rota'),
        h('p', null, `≈ ${r.minutos} min (estimativa) · ${r.paradas} paradas · ${r.baldeacoes} baldeação(ões)`),
        faixaRota(r), listaEtapas(r));
      $$('details', area).forEach((d) => (d.open = true));
    } else area.append(h('p', null, 'Este projeto ainda não tem rota calculada.'));
    area.append(h('h2', null, 'Fonte'), h('p', null, `${APP.urlApp} · Tempos estimados; confira os canais oficiais das operadoras.`));
    fecharMenu();
    setTimeout(() => window.print(), 60);
  }

  /* --- compartilhar (Web Share API) --- */
  async function compartilhar() {
    fecharMenu();
    const p = projetoParaAcao(E.projetoId);
    const texto = E.rota ? textoRota(E.rota) : `${APP.nome}: guia de metrô e trem de São Paulo, com rotas offline.\n${APP.urlApp}`;
    const dados = { title: p ? p.nome : APP.nome, text: texto, url: APP.urlApp };
    try {
      if (p && navigator.canShare) {
        const arq = new File([JSON.stringify(envelopeProjeto(p), null, 2)], `sptrilhos-${slug(p.nome)}.json`, { type: 'application/json' });
        if (navigator.canShare({ files: [arq] })) { await navigator.share({ ...dados, files: [arq] }); return; }
      }
      if (navigator.share) { await navigator.share(dados); return; }
      await navigator.clipboard.writeText(texto);
      toast('Compartilhamento nativo indisponível: texto copiado.');
    } catch (e) { if (e && e.name !== 'AbortError') toast('Não foi possível compartilhar.'); }
  }

  /* ======================================================================
   * 9. MENU, NAVEGAÇÃO, TEMA, TELA CHEIA, INSTALAÇÃO
   * ==================================================================== */
  let focoAntesMenu = null;
  function abrirMenu() {
    const m = $('#menu'); focoAntesMenu = document.activeElement;
    m.inert = false; m.removeAttribute('aria-hidden'); m.classList.add('aberto'); $('#menu-fundo').hidden = false;
    $('#btn-menu').setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#btn-menu-fechar').focus(), 50);
  }
  function fecharMenu() {
    const m = $('#menu'); if (!m.classList.contains('aberto')) return;
    m.classList.remove('aberto'); m.setAttribute('aria-hidden', 'true'); m.inert = true; $('#menu-fundo').hidden = true;
    $('#btn-menu').setAttribute('aria-expanded', 'false');
    if (focoAntesMenu && document.contains(focoAntesMenu)) focoAntesMenu.focus();
  }

  function irPara(destino, opts) {
    const alvo = destino === 'mapa' ? 'rota' : destino;
    E.view = alvo;
    if (destino === 'mapa') E.painel = 'mapa'; else if (destino === 'rota') E.painel = 'form';
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-' + alvo));
    const vr = $('#view-rota'); vr.dataset.painel = E.painel;
    const desktop = window.matchMedia('(min-width:1024px)').matches;
    const aba = destino === 'mapa' && desktop ? 'rota' : destino;
    $$('.abas-baixo [data-tab]').forEach((b) => { if (b.dataset.tab === aba) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (alvo === 'projetos') renderProjetos();
    if (alvo === 'guia') renderGuia();
    fecharMenu();
    if (!opts || !opts.semHash) { try { history.replaceState(null, '', '#' + destino); } catch (e) { /* ignore */ } }
    window.scrollTo({ top: 0 });
    const titulo = $(destino === 'mapa' ? '#t-mapa' : '#view-' + alvo + ' .titulo-vista');
    if (titulo) { titulo.tabIndex = -1; titulo.focus({ preventScroll: true }); }
  }
  const irInicio = () => irPara('rota');

  function aplicarTema(t) {
    document.documentElement.setAttribute('data-tema', t);
    try { localStorage.setItem(LS.tema, t); } catch (e) { /* ignore */ }
    const escuro = t === 'dark';
    const b = $('#btn-tema'); b.setAttribute('aria-checked', String(escuro));
    $('#btn-tema-txt').textContent = escuro ? 'Modo claro' : 'Modo escuro';
    const ic = $('[data-icone]', b); ic.textContent = ''; ic.append(icone(escuro ? 'sun' : 'moon'));
    const meta = $('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', escuro ? '#151c2a' : '#0b3d91');
  }
  const alternarTema = () => aplicarTema(document.documentElement.getAttribute('data-tema') === 'dark' ? 'light' : 'dark');

  function alternarTelaCheia() {
    if (!document.fullscreenEnabled) { toast('Seu navegador não permite tela cheia aqui.'); return; }
    if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => toast('Não foi possível entrar em tela cheia.'));
  }
  function atualizarTelaCheia() {
    const fs = !!document.fullscreenElement;
    $$('.txt-tela-cheia').forEach((el) => (el.textContent = fs ? 'Sair da tela cheia' : 'Tela cheia'));
    $$('[data-acao="tela-cheia"] [data-icone]').forEach((el) => { el.textContent = ''; el.append(icone(fs ? 'exitfs' : 'fullscreen')); });
    const top = $('#btn-tela-cheia-top'); top.textContent = ''; top.append(icone(fs ? 'exitfs' : 'fullscreen'));
  }

  async function instalarPWA() {
    if (E.deferredPrompt) {
      E.deferredPrompt.prompt();
      const { outcome } = await E.deferredPrompt.userChoice;
      E.deferredPrompt = null; atualizarBotaoInstalar();
      toast(outcome === 'accepted' ? 'Instalando o SP Trilhos…' : 'Instalação cancelada.');
    } else if (window.matchMedia('(display-mode: standalone)').matches) toast('O SP Trilhos já está instalado neste aparelho.');
    else toast('Instalação indisponível agora. No Chrome, use o menu ⋮ > "Instalar app".');
  }
  function atualizarBotaoInstalar() {
    const b = $('#btn-instalar'); if (!b) return;
    const standalone = window.matchMedia('(display-mode: standalone)').matches;
    b.disabled = !E.deferredPrompt && standalone;
    b.lastChild.textContent = standalone ? 'App instalado' : 'Instalar PWA';
  }

  function tratarAcao(acao) {
    switch (acao) {
      case 'novo-projeto': abrirNovoProjeto(); break;
      case 'salvar-projeto': fecharMenu(); salvarProjetoAtual(); break;
      case 'exportar': fecharMenu(); exportarProjeto(); break;
      case 'importar': fecharMenu(); $('#arquivo-importar').click(); break;
      case 'imprimir': imprimirProjeto(); break;
      case 'compartilhar': compartilhar(); break;
      case 'backup': fecharMenu(); backupCompleto(); break;
      case 'tema': alternarTema(); break;
      case 'tela-cheia': alternarTelaCheia(); break;
      case 'instalar': fecharMenu(); instalarPWA(); break;
      case 'sobre': fecharMenu(); $('#sobre-versao').textContent = `Versão ${APP.versao} · ${D.linhas.length} linhas · ${D.clusters.size} estações físicas`; $('#dlg-sobre').showModal(); break;
    }
  }

  /* ======================================================================
   * 10. INICIALIZAÇÃO
   * ==================================================================== */
  function ligarEventos() {
    $('#btn-logo').addEventListener('click', irInicio);
    $('#btn-menu').addEventListener('click', abrirMenu);
    $('#btn-menu-fechar').addEventListener('click', fecharMenu);
    $('#menu-fundo').addEventListener('click', fecharMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharMenu(); });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-acao]'); if (a && a.dataset.acao) tratarAcao(a.dataset.acao);
      const ir = e.target.closest('[data-ir]'); if (ir) irPara(ir.dataset.ir);
    });
    document.addEventListener('fullscreenchange', atualizarTelaCheia);

    $('#form-rota').addEventListener('submit', submeterRota);
    $('#btn-limpar').addEventListener('click', limparRota);
    $('#btn-trocar').addEventListener('click', () => { const o = $('#in-origem'), d = $('#in-destino'); [o.value, d.value] = [d.value, o.value]; if (o.value && d.value) submeterRota(); });
    $('#chk-terminais').addEventListener('change', (e) => popularLista(e.target.checked));
    $$('input[name="criterio"]').forEach((r) => r.addEventListener('change', () => { if ($('#in-origem').value && $('#in-destino').value) submeterRota(); }));

    $('#mz-mais').addEventListener('click', () => zoomMapa(1.4));
    $('#mz-menos').addEventListener('click', () => zoomMapa(1 / 1.4));
    $('#mz-reset').addEventListener('click', resetMapa);

    $('#busca-guia').addEventListener('input', (e) => { G.termo = e.target.value; renderGuia(); });
    $$('.abas [role="tab"]').forEach((t) => {
      t.addEventListener('click', () => { G.aba = t.dataset.aba; renderGuia(); });
      t.addEventListener('keydown', (e) => {
        const tabs = $$('.abas [role="tab"]'), i = tabs.indexOf(t);
        const ni = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : -1;
        if (ni >= 0) { e.preventDefault(); G.aba = tabs[ni].dataset.aba; renderGuia(); tabs[ni].focus(); }
      });
    });

    $('#form-projeto').addEventListener('submit', criarProjetoNovo);
    $('#proj-cancelar').addEventListener('click', () => $('#dlg-projeto').close());
    $('#arquivo-importar').addEventListener('change', (e) => importarArquivo(e.target.files[0]));

    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); E.deferredPrompt = e; atualizarBotaoInstalar(); });
    window.addEventListener('appinstalled', () => { E.deferredPrompt = null; atualizarBotaoInstalar(); toast('SP Trilhos instalado!'); });
    window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (['rota', 'mapa', 'guia', 'projetos'].includes(v) && v !== (E.painel === 'mapa' && E.view === 'rota' ? 'mapa' : E.view)) irPara(v, { semHash: true }); });
    window.addEventListener('beforeunload', persistirAtivoSilencioso);
  }

  async function carregarDados() {
    const resp = await fetch('dados.json');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    let dados = await resp.json();
    if (!dados || !Array.isArray(dados.linhas)) throw new Error('dados.json inválido');
    if (CORRIGIR_DADOS) dados = aplicarCorrecoes(dados);
    construirGrafo(dados);
  }

  function registrarSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const novo = reg.installing;
          if (novo) novo.addEventListener('statechange', () => { if (novo.state === 'installed' && navigator.serviceWorker.controller) toast('Nova versão instalada. Reabra o app para atualizar.'); });
        });
      }).catch((e) => console.warn('[SP Trilhos] SW:', e));
    });
  }

  async function iniciar() {
    const inicioSplash = performance.now();
    hidratarIcones();
    ligarEventos();
    registrarSW();

    let falhou = null;
    try { await carregarDados(); } catch (e) { falhou = e; console.error(e); }

    if (!falhou) {
      popularLista(false); montarChips(); hidratarIcones();
      carregarMapa();
      aplicarTema(document.documentElement.getAttribute('data-tema') === 'dark' ? 'dark' : 'light');
      renderGuia();
      const id = lerLS(LS.ativo, null);
      const p = id ? projetoPorId(id) : null;
      if (p) { E.projetoId = p.id; aplicarEstado(p.estado); }
      atualizarInfoProjeto(); renderProjetos();
    }

    // A splash dura exatamente 3 s desde a abertura.
    const resta = Math.max(0, 3000 - (performance.now() - inicioSplash));
    setTimeout(() => {
      $('#app').hidden = false;
      const splash = $('#splash'); splash.classList.add('saindo');
      setTimeout(() => splash.remove(), 500);
      const v = location.hash.slice(1);
      irPara(['rota', 'mapa', 'guia', 'projetos'].includes(v) ? v : 'rota', { semHash: true });
      atualizarTelaCheia(); atualizarBotaoInstalar();
      if (falhou) { $('#erro-rota').textContent = 'Não foi possível carregar a base de dados (dados.json). Abra o app com internet uma vez para habilitar o modo offline.'; }
    }, resta);
  }

  /* API de teste (somente leitura/cálculo; não altera a interface). */
  window.SPTrilhos = { calcularRota: (o, d, c) => calcularRota(acharCluster(o), acharCluster(d), c || 'rapida'), D, APP };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
