/* Geoportal RMP – Leaflet */
(function () {
  const $ = id => document.getElementById(id);
  const fmt = (v, casas = 0) =>
    v == null || isNaN(v) ? "–" :
    Number(v).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const url = (chave, subs = {}) =>
    CONFIG.BASE_DADOS + Object.entries(subs).reduce((s, [k, v]) => s.replace(`{${k}}`, v), CONFIG.arquivos[chave]);
  const getJSON = (chave, subs) => fetch(url(chave, subs)).then(r => {
    if (!r.ok) throw new Error(`${chave}: HTTP ${r.status}`); return r.json();
  });
  const getJSONopc = (chave, subs) => getJSON(chave, subs).catch(() => null);
  const semPontos = f => !/Point/.test(f.geometry && f.geometry.type);  // evita marcadores em camadas de linha/polígono

  // ---------- Estado ----------
  const estado = { variavel: "pop_total", classe: "quantil", opacidade: 0.75, municipio: "", quebras: [],
                   usoAno: "", usoOpac: 0.85 };
  let ecoDados = null, equipStats = null, temTSset = false;
  let camadaMun, camadaSet, camadaMunCor, corMun = {}, rotulos, dadosMun, dadosSet, rasters = {}, usoStats = null, resumoVias = null, transStats = null, tsStats = null;

  // ---------- Mapa, painéis (ordem de desenho) e mapas de fundo ----------
  const mapa = L.map("mapa", { zoomControl: true, preferCanvas: true }).setView(CONFIG.centro, CONFIG.zoom);
  [["relevo", 300], ["uso", 320], ["municor", 390], ["eco", 395], ["setores", 400], ["tsset", 405], ["curvas", 410], ["agua", 420],
   ["vias", 430], ["limites", 450], ["equip", 460]]
    .forEach(([n, z]) => { mapa.createPane(n).style.zIndex = z; });
  mapa.getPane("relevo").style.pointerEvents = mapa.getPane("uso").style.pointerEvents = "none";
  const rCanvas = {};
  ["municor", "eco", "setores", "tsset", "curvas", "agua", "vias", "limites", "equip"].forEach(p => rCanvas[p] = L.canvas({ pane: p, padding: 0.3 }));

  // crossOrigin: necessário para o "Monte seu mapa" conseguir copiar os blocos do fundo para a imagem
  const fundos = {
    "Cinza claro (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, maxNativeZoom: 16, crossOrigin: "anonymous", fonte: "Esri World Light Gray",
      attribution: "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap" }),
    "OpenStreetMap": L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, crossOrigin: "anonymous", fonte: "© colaboradores do OpenStreetMap",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }),
    "Imagem de satélite (Esri)": L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19, crossOrigin: "anonymous", fonte: "Esri World Imagery", attribution: "Tiles &copy; Esri" }),
  };
  (fundos[CONFIG.fundo_inicial] || fundos["Cinza claro (Esri)"]).addTo(mapa);
  // transparência do fundo vale para qualquer mapa de fundo escolhido
  let opacFundo = 1 - (CONFIG.transparencia_fundo || 0);
  Object.values(fundos).forEach(l => l.setOpacity(opacFundo));
  L.control.layers(fundos, null, { position: "topright" }).addTo(mapa);
  L.control.scale({ imperial: false }).addTo(mapa);

  const hover = L.control({ position: "bottomright" });
  hover.onAdd = function () { this._div = L.DomUtil.create("div", "info-hover"); this.update(); return this._div; };
  hover.update = function (p) {
    const v = CONFIG.variaveis[estado.variavel];
    this._div.innerHTML = p
      ? `<h4>${p.NM_MUN}${p.NM_BAIRRO ? " · " + p.NM_BAIRRO : ""}</h4>
         Setor ${p.CD_SETOR} (${p.SITUACAO})<br>
         <b>${v.nome}:</b> ${fmt(p[estado.variavel], v.casas)} ${v.unidade}`
      : "Clique no mapa para consultar";
  };
  hover.addTo(mapa);

  // ---------- Classificação dos setores ----------
  function quebrasQuantil(vals, k) {
    const q = []; for (let i = 1; i < k; i++) q.push(vals[Math.floor((i / k) * (vals.length - 1))]); return q;
  }
  function quebrasIguais(vals, k) {
    const min = vals[0], max = vals[vals.length - 1], q = [];
    for (let i = 1; i < k; i++) q.push(min + ((max - min) * i) / k); return q;
  }
  function quebrasJenks(vals, k) {
    let d = vals;
    if (d.length > 1500) { const p = d.length / 1500; d = Array.from({ length: 1500 }, (_, i) => vals[Math.floor(i * p)]); }
    const n = d.length, lim = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(0));
    const vari = Array.from({ length: n + 1 }, () => new Array(k + 1).fill(Infinity));
    for (let j = 1; j <= k; j++) { lim[1][j] = 1; vari[1][j] = 0; }
    for (let l = 2; l <= n; l++) {
      let s1 = 0, s2 = 0, w = 0, v = 0;
      for (let m = 1; m <= l; m++) {
        const i3 = l - m + 1, val = d[i3 - 1];
        s2 += val * val; s1 += val; w++; v = s2 - (s1 * s1) / w;
        const i4 = i3 - 1;
        if (i4 !== 0) for (let j = 2; j <= k; j++)
          if (vari[l][j] >= v + vari[i4][j - 1]) { lim[l][j] = i3; vari[l][j] = v + vari[i4][j - 1]; }
      }
      lim[l][1] = 1; vari[l][1] = v;
    }
    const q = []; let kk = n;
    for (let j = k; j >= 2; j--) { const id = lim[kk][j] - 2; q.unshift(d[id]); kk = lim[kk][j] - 1; }
    return q;
  }
  function calcularQuebras() {
    const vals = dadosSet.features
      .filter(f => !estado.municipio || f.properties.CD_MUN === estado.municipio)
      .map(f => f.properties[estado.variavel]).filter(v => v != null && !isNaN(v)).sort((a, b) => a - b);
    const fn = { quantil: quebrasQuantil, jenks: quebrasJenks, igual: quebrasIguais }[estado.classe];
    const fixas = CONFIG.variaveis[estado.variavel].fixas;
    estado.quebras = fixas ? fixas.slice() : vals.length ? [...new Set(fn(vals, 5))] : [];
    $("sel-classe").disabled = !!fixas;
    estado.min = vals[0]; estado.max = vals[vals.length - 1];
  }
  function cor(v) {
    const c = CONFIG.variaveis[estado.variavel].cores;
    if (v == null || isNaN(v)) return "#cccccc";
    let i = 0; while (i < estado.quebras.length && v > estado.quebras[i]) i++;
    return c[Math.min(i, c.length - 1)];
  }
  const estiloSetor = f => {
    const fora = estado.municipio && f.properties.CD_MUN !== estado.municipio;
    return { fillColor: cor(f.properties[estado.variavel]), fillOpacity: fora ? estado.opacidade * 0.25 : estado.opacidade,
             color: "#ffffff", weight: 0.4, opacity: fora ? 0.2 : 0.7 };
  };
  const estiloMun = f => ({
    fill: false, color: f.properties.CD_MUN === estado.municipio ? "#d1495b" : "#1f2933",
    weight: f.properties.CD_MUN === estado.municipio ? 3 : 1.4, opacity: 0.9,
  });
  function legendaSetores() {
    const v = CONFIG.variaveis[estado.variavel];
    const lim = [estado.min, ...estado.quebras, estado.max];
    let html = `<div class="nota" style="margin-bottom:6px">${v.unidade}${v.fixas ? " · classes fixas" : ""}</div>`;
    if (v.fixas) {
      const q = v.fixas, f = x => fmt(x, 0).replace("-", "−");
      v.cores.forEach((c, i) => {
        const rot = i === 0 ? `< ${f(q[0])}` : i === q.length ? `> ${f(q[q.length - 1])}` : `${f(q[i - 1])} a ${f(q[i])}`;
        html += `<div class="item"><span class="cor" style="background:${c}"></span>${rot}</div>`;
      });
    } else
    for (let i = 0; i < lim.length - 1; i++)
      html += `<div class="item"><span class="cor" style="background:${cor(lim[i + 1])}"></span>${fmt(lim[i], v.casas)} – ${fmt(lim[i + 1], v.casas)}</div>`;
    html += `<div class="item"><span class="cor" style="background:#cccccc"></span>Sem dado / sigilo</div>`;
    $("legenda").innerHTML = html; $("desc-var").textContent = v.desc;
  }
  function redesenhar() {
    calcularQuebras(); camadaSet.setStyle(estiloSetor); camadaMun.setStyle(estiloMun); legendaSetores(); hover.update();
  }

  // ---------- Rasters (imagens em EPSG:3857) + consulta de pixel ----------
  const imgCache = {};
  function carregaImagem(src) {
    if (!imgCache[src]) imgCache[src] = new Promise((ok, erro) => {
      const im = new Image(); im.crossOrigin = "anonymous";
      im.onload = () => ok(im); im.onerror = erro; im.src = src;
    });
    return imgCache[src];
  }
  const pxCanvas = document.createElement("canvas"); pxCanvas.width = pxCanvas.height = 1;
  const pxCtx = pxCanvas.getContext("2d", { willReadFrequently: true });
  async function lePixel(chave, src, latlng) {
    const m = rasters[chave]; if (!m) return null;
    const [[s, w], [n, e]] = m.bounds;
    const p0 = L.CRS.EPSG3857.project(L.latLng(n, w)), p1 = L.CRS.EPSG3857.project(L.latLng(s, e));
    const p = L.CRS.EPSG3857.project(latlng);
    const x = Math.floor((p.x - p0.x) / (p1.x - p0.x) * m.largura), y = Math.floor((p.y - p0.y) / (p1.y - p0.y) * m.altura);
    if (x < 0 || y < 0 || x >= m.largura || y >= m.altura) return null;
    const im = await carregaImagem(src);
    pxCtx.imageSmoothingEnabled = false; pxCtx.clearRect(0, 0, 1, 1);
    pxCtx.drawImage(im, x, y, 1, 1, 0, 0, 1, 1);
    return pxCtx.getImageData(0, 0, 1, 1).data;
  }
  const overlay = (chave, src, pane, opac, cls) => rasters[chave]
    ? L.imageOverlay(src, rasters[chave].bounds, { pane, opacity: opac, className: cls || "", interactive: false }) : null;

  // ---------- Uso e cobertura da terra ----------
  const usoCamadas = {};
  let corParaClasse = {};
  function montaUso() {
    const disponivel = usoStats && rasters.uso_1990 && rasters.uso_2025;
    if (!disponivel) {
      $("uso-indisp").hidden = false; $("uso-controles").hidden = true;
      $("uso-indisp").textContent = "Dados do MapBiomas ainda não processados (ver README: exportação pelo Google Earth Engine).";
      return;
    }
    for (const [c, info] of Object.entries(usoStats.classes)) corParaClasse[info.cor.toLowerCase()] = c;
    ["1990", "2025"].forEach(a => usoCamadas[a] = overlay("uso_" + a, url("uso_png", { ano: a }), "uso", estado.usoOpac, "pixelado"));
    // legenda por grupo
    const porGrupo = {};
    Object.entries(usoStats.classes).forEach(([c, i]) => (porGrupo[i.grupo] = porGrupo[i.grupo] || []).push([c, i]));
    $("legenda-uso").innerHTML = Object.entries(porGrupo).map(([g, itens]) =>
      `<div class="grupo-leg">${g}</div>` + itens.map(([c, i]) =>
        `<div class="item"><span class="cor" style="background:${i.cor}"></span>${i.nome} <small class="cod">${c}</small></div>`).join("")).join("");
    // Transições 1990 -> 2025 (duas imagens: todas as categorias / só mudanças)
    const temTrans = transStats && rasters.transicao;
    if (temTrans) {
      usoCamadas.transicao = overlay("transicao", url("trans_png"), "uso", estado.usoOpac, "pixelado");
      usoCamadas.transicao_mud = overlay("transicao", url("trans_mud_png"), "uso", estado.usoOpac, "pixelado");
      for (const [k, c] of Object.entries(transStats.categorias)) corParaTrans[c.cor.toLowerCase()] = k;
    } else document.querySelector('input[name="uso-ano"][value="transicao"]').parentElement.hidden = true;
    const aplicaUso = () => {
      Object.values(usoCamadas).forEach(l => mapa.removeLayer(l));
      const t = estado.usoAno === "transicao";
      $("lbl-so-mud").hidden = !t; $("legenda-trans").hidden = !t; $("legenda-uso").hidden = t;
      if (t) usoCamadas[$("chk-so-mud").checked ? "transicao_mud" : "transicao"].addTo(mapa);
      else if (estado.usoAno) usoCamadas[estado.usoAno].addTo(mapa);
    };
    document.querySelectorAll('input[name="uso-ano"]').forEach(r => r.onchange = e => { estado.usoAno = e.target.value; aplicaUso(); });
    $("chk-so-mud").onchange = aplicaUso;
    $("rng-uso").oninput = e => {
      estado.usoOpac = e.target.value / 100; $("val-uso").textContent = e.target.value + "%";
      Object.values(usoCamadas).forEach(l => l.setOpacity(estado.usoOpac));
    };
  }
  const corParaTrans = {};
  function legendaTrans() {
    if (!transStats) return;
    const d = (transStats.dados[estado.municipio || "RMP"] || {}).categorias || {};
    const itens = Object.entries(transStats.categorias).sort((a, b) => (a[1].estavel - b[1].estavel) || ((d[b[0]] || 0) - (d[a[0]] || 0)));
    let html = `<div class="grupo-leg">Mudanças · km² em ${estado.municipio ? $("sel-mun").selectedOptions[0].text : "toda a RMP"}</div>`;
    let estaveis = false;
    for (const [k, c] of itens) {
      if (c.estavel && !estaveis) { html += `<div class="grupo-leg">Sem mudança de classe</div>`; estaveis = true; }
      html += `<div class="item"><span class="cor" style="background:${c.cor}"></span>${c.nome}<small class="cod">${fmt(d[k] || 0, 1)}</small></div>`;
    }
    $("legenda-trans").innerHTML = html;
  }
  function transMunicipio() {
    const el = $("trans-mun");
    const d = transStats && transStats.dados[estado.municipio || "RMP"];
    if (!d) { el.innerHTML = ""; return; }
    el.innerHTML = `<h3>Principais mudanças 1990 → 2025</h3>
      <p class="nota" style="margin-top:0">${fmt(d.mudou_km2, 1)} km² (${fmt(d.mudou_km2 / d.total_km2 * 100, 1)}% da área) mudaram de classe.</p>
      <table class="tab-trans">${d.principais.map(([de, para, km2]) =>
        `<tr><td>${de} → ${para}</td><td>${fmt(km2, 1)} km²</td></tr>`).join("")}</table>
      <p class="nota">Comparação pixel a pixel entre dois anos: parte das trocas entre classes agrícolas (ex.: mosaico de usos ↔ cana) reflete rotação de culturas e incerteza do mapeamento.</p>`;
  }
  function categoriaDoPixel(rgba) {
    if (!rgba || rgba[3] < 128) return null;
    const hex = "#" + [rgba[0], rgba[1], rgba[2]].map(v => v.toString(16).padStart(2, "0")).join("");
    const k = corParaTrans[hex]; return k ? transStats.categorias[k] : null;
  }
  function classeDoPixel(rgba) {
    if (!rgba || rgba[3] < 128) return null;
    const hex = "#" + [rgba[0], rgba[1], rgba[2]].map(v => v.toString(16).padStart(2, "0")).join("");
    const c = corParaClasse[hex]; return c ? { codigo: c, ...usoStats.classes[c] } : null;
  }
  function usoMunicipio() {
    const el = $("uso-mun");
    if (!usoStats) { el.innerHTML = ""; return; }
    const d = usoStats.dados[estado.municipio || "RMP"]; if (!d) { el.innerHTML = ""; return; }
    const grupos = {};
    ["1990", "2025"].forEach(a => Object.entries(d[a] || {}).forEach(([c, km2]) => {
      const g = (usoStats.classes[c] || {}).grupo || "Outros";
      grupos[g] = grupos[g] || { "1990": 0, "2025": 0 }; grupos[g][a] += km2;
    }));
    const total = Object.values(grupos).reduce((s, g) => s + g["2025"], 0) || 1;
    const max = Math.max(...Object.values(grupos).flatMap(g => [g["1990"], g["2025"]]));
    el.innerHTML = `<h3>Uso da terra 1990 → 2025 (km²)</h3>` + Object.entries(grupos)
      .sort((a, b) => b[1]["2025"] - a[1]["2025"]).map(([g, v]) => {
        const dif = v["2025"] - v["1990"], corG = usoStats.grupos[g] || "#999";
        return `<div class="barra-uso"><div class="rot">${g}<span class="${dif >= 0 ? "pos" : "neg"}">${dif >= 0 ? "+" : ""}${fmt(dif, 1)}</span></div>
          <div class="barras"><span style="width:${v["1990"] / max * 100}%;background:${corG};opacity:.45" title="1990: ${fmt(v["1990"], 1)} km²"></span></div>
          <div class="barras"><span style="width:${v["2025"] / max * 100}%;background:${corG}" title="2025: ${fmt(v["2025"], 1)} km²"></span></div>
          <div class="nums">${fmt(v["1990"], 1)} → ${fmt(v["2025"], 1)} (${fmt(v["2025"] / total * 100, 1)}%)</div></div>`;
      }).join("") + `<p class="nota">Barra clara = 1990; barra escura = 2025.</p>`;
  }

  // ---------- Temperatura de superfície 2025 (área urbana) ----------
  let camadaTS = null;
  function montaTS() {
    if (!tsStats || !rasters.ts2025) {
      $("ts-indisp").hidden = false; $("chk-ts").disabled = true; return;
    }
    camadaTS = overlay("ts2025", url("ts_png"), "uso", 0.9, "pixelado");
    $("chk-ts").onchange = e => e.target.checked ? camadaTS.addTo(mapa) : mapa.removeLayer(camadaTS);
    $("rng-ts").oninput = e => { $("val-ts").textContent = e.target.value + "%"; camadaTS.setOpacity(e.target.value / 100); };
  }
  function legendaTS() {
    if (!tsStats) return;
    const d = estado.municipio ? tsStats.municipios[estado.municipio] : tsStats.RMP;
    const pct = (d && d.pct_classes) || [];
    $("legenda-ts").innerHTML = `<div class="grupo-leg">ΔTS (°C) · % da área urbana em ${estado.municipio ? $("sel-mun").selectedOptions[0].text : "toda a RMP"}</div>` +
      tsStats.classes.map((c, i) => `<div class="item"><span class="cor" style="background:${c.cor}"></span>${c.nome}<small class="cod">${fmt(pct[i], 1)}%</small></div>`).join("");
  }
  function tsMunicipio() {
    const el = $("ts-mun");
    if (!tsStats) { el.innerHTML = ""; return; }
    if (!estado.municipio) {
      const r = Object.entries(tsStats.municipios).sort((a, b) => a[1].ranking - b[1].ranking);
      const nome = cd => (dadosMun.features.find(f => f.properties.CD_MUN === cd) || { properties: {} }).properties.NM_MUN;
      el.innerHTML = `<h3>Temperatura de superfície urbana 2025</h3>
        <p class="nota" style="margin-top:0">Mediana da área urbana da RMP: <b>${fmt(tsStats.RMP.TS_mediana_urbana_C, 1)} °C</b> (estação seca).</p>
        <table class="tab-trans">${r.map(([cd, v]) => `<tr><td>${v.ranking}º ${nome(cd)}</td><td>${fmt(v.TS_mediana, 1)} °C</td></tr>`).join("")}</table>`;
      return;
    }
    const v = tsStats.municipios[estado.municipio];
    if (!v) { el.innerHTML = ""; return; }
    el.innerHTML = `<h3>Temperatura de superfície urbana 2025</h3><table>
      <tr><td>Mediana urbana (estação seca)</td><td>${fmt(v.TS_mediana, 1)} °C</td></tr>
      <tr><td>Posição na RMP (mais quente = 1º)</td><td>${v.ranking}º de ${Object.keys(tsStats.municipios).length}</td></tr>
      <tr><td>10% mais frios / 10% mais quentes</td><td>${fmt(v.p10, 1)} / ${fmt(v.p90, 1)} °C</td></tr>
      <tr><td>Área urbana analisada</td><td>${fmt(v.area_urbana_km2, 1)} km²</td></tr>
      <tr><td>Observações válidas por pixel (mediana)</td><td>${v.obs}</td></tr></table>`;
  }

  // ---------- Temperatura de superfície por setor urbano (Meio Ambiente) ----------
  let camadaTSSet = null, varTS = "dts_2025", quebrasTS = [];
  const nomeMunSel = () => estado.municipio ? $("sel-mun").selectedOptions[0].text : "toda a RMP";
  function calcQuebrasTS() {
    const v = CONFIG.ts_setores[varTS];
    if (v.fixas) { quebrasTS = v.fixas.slice(); return; }
    const vals = dadosSet.features.filter(f => (!estado.municipio || f.properties.CD_MUN === estado.municipio) && f.properties[varTS] != null)
      .map(f => f.properties[varTS]).sort((a, b) => a - b);
    quebrasTS = vals.length ? [...new Set(quebrasQuantil(vals, 5))] : [];
    quebrasTS.min = vals[0]; quebrasTS.max = vals[vals.length - 1];
  }
  const corTS = x => { const c = CONFIG.ts_setores[varTS].cores; let i = 0; while (i < quebrasTS.length && x > quebrasTS[i]) i++; return c[Math.min(i, c.length - 1)]; };
  const estiloTSSet = f => {
    const fora = estado.municipio && f.properties.CD_MUN !== estado.municipio;
    return { fillColor: corTS(f.properties[varTS]), fillOpacity: fora ? 0.25 : 0.85, color: "#ffffff", weight: 0.4, opacity: fora ? 0.2 : 0.7 };
  };
  function legendaTSSet() {
    const v = CONFIG.ts_setores[varTS], q = quebrasTS, f = x => fmt(x, v.fixas ? 0 : 1).replace("-", "−");
    let html = `<div class="nota" style="margin-bottom:6px">${v.unidade}${v.fixas ? " · classes fixas" : " · quantis em " + nomeMunSel()}</div>`;
    const lim = v.fixas ? null : [q.min, ...q, q.max];
    v.cores.slice(0, v.fixas ? v.cores.length : lim.length - 1).forEach((c, i) => {
      const rot = v.fixas ? (i === 0 ? `< ${f(q[0])}` : i === q.length ? `> ${f(q[q.length - 1])}` : `${f(q[i - 1])} a ${f(q[i])}`)
                          : `${f(lim[i])} – ${f(lim[i + 1])}`;
      html += `<div class="item"><span class="cor" style="background:${c}"></span>${rot}</div>`;
    });
    $("legenda-ts-set").innerHTML = html; $("desc-ts-set").textContent = v.desc;
  }
  function montaTSSet() {
    const sel = $("sel-ts-set");
    sel.innerHTML = Object.entries(CONFIG.ts_setores).map(([k, v]) => `<option value="${k}">${v.nome}</option>`).join("");
    if (!temTSset) { $("chk-ts-set").disabled = sel.disabled = true; return; }
    const urb = { type: "FeatureCollection", features: dadosSet.features.filter(f => f.properties.dts_2025 != null) };
    camadaTSSet = L.geoJSON(urb, { renderer: rCanvas.tsset, style: estiloTSSet,
      onEachFeature: (f, l) => l.on({
        mouseover: e => e.target.setStyle({ weight: 2, color: "#222" }),
        mouseout: e => camadaTSSet.resetStyle(e.target),
        click: e => { L.DomEvent.stop(e); consulta(e.latlng, f.properties); },
      }) });
    calcQuebrasTS(); legendaTSSet();
    $("chk-ts-set").onchange = e => e.target.checked ? camadaTSSet.addTo(mapa) : mapa.removeLayer(camadaTSSet);
    sel.onchange = e => { varTS = e.target.value; calcQuebrasTS(); camadaTSSet.setStyle(estiloTSSet); legendaTSSet(); };
  }

  // ---------- Indicadores econômicos por município ----------
  let camadaEco = null, varEco = "pib_per_capita", quebrasEco = [], opacEco = 0.8;
  const valEco = cd => ((ecoDados && ecoDados.dados[cd]) || {})[varEco];
  const corEco = x => { if (x == null) return "#cccccc"; let i = 0; while (i < quebrasEco.length && x > quebrasEco[i]) i++; return CONFIG.cores_economia[Math.min(i, 4)]; };
  const estiloEco = f => ({ fillColor: corEco(valEco(f.properties.CD_MUN)), fillOpacity: opacEco, color: "#ffffff", weight: 0.8 });
  function calcQuebrasEco() {
    const vals = dadosMun.features.map(f => valEco(f.properties.CD_MUN)).filter(v => v != null).sort((a, b) => a - b);
    quebrasEco = [...new Set(quebrasQuantil(vals, 5))]; quebrasEco.min = vals[0]; quebrasEco.max = vals[vals.length - 1];
  }
  function legendaEco() {
    const v = ecoDados.variaveis[varEco], q = quebrasEco, lim = [q.min, ...q, q.max];
    let html = `<div class="nota" style="margin-bottom:6px">${v.unidade} · quantis entre os 24 municípios</div>`;
    for (let i = 0; i < lim.length - 1; i++)
      html += `<div class="item"><span class="cor" style="background:${CONFIG.cores_economia[i]}"></span>${fmt(lim[i], v.casas)} – ${fmt(lim[i + 1], v.casas)}</div>`;
    $("legenda-eco").innerHTML = html;
    $("desc-eco").textContent = (v.desc ? v.desc + " " : "") + "Fonte: " + v.fonte + ".";
  }
  function montaEco() {
    if (!ecoDados) { $("eco-indisp").hidden = false; $("chk-eco").disabled = $("sel-eco").disabled = true; return; }
    $("sel-eco").innerHTML = Object.entries(ecoDados.variaveis).map(([k, v]) => `<option value="${k}">${v.nome}</option>`).join("");
    $("sel-eco").value = varEco;
    camadaEco = L.geoJSON(dadosMun, { renderer: rCanvas.eco, style: estiloEco,
      onEachFeature: (f, l) => l.bindTooltip(() => {
        const v = ecoDados.variaveis[varEco];
        return `<b>${f.properties.NM_MUN}</b><br>${v.nome}: ${fmt(valEco(f.properties.CD_MUN), v.casas)} ${v.unidade}`;
      }, { sticky: true }) });
    calcQuebrasEco(); legendaEco();
    $("chk-eco").onchange = e => e.target.checked ? camadaEco.addTo(mapa) : mapa.removeLayer(camadaEco);
    $("sel-eco").onchange = e => { varEco = e.target.value; calcQuebrasEco(); camadaEco.setStyle(estiloEco); legendaEco(); };
    $("rng-eco").oninput = e => { opacEco = e.target.value / 100; $("val-eco").textContent = e.target.value + "%"; camadaEco.setStyle(estiloEco); };
  }
  function ecoMunicipio() {
    const el = $("eco-mun");
    if (!ecoDados) { el.innerHTML = ""; return; }
    const d = ecoDados.dados[estado.municipio || "RMP"]; if (!d) { el.innerHTML = ""; return; }
    const V = ecoDados.variaveis, a = ecoDados.anos;
    const linha = (k, rot) => `<tr><td>${rot || V[k].nome}</td><td>${fmt(d[k], V[k].casas)} ${V[k].unidade}</td></tr>`;
    // posição no ranking do PIB per capita
    const rk = estado.municipio ? Object.entries(ecoDados.dados).filter(([c]) => c !== "RMP").sort((x, y) => y[1].pib_per_capita - x[1].pib_per_capita).findIndex(([c]) => c === estado.municipio) + 1 : 0;
    const set = [["Agropecuária", d.pct_agro, "#c4b93f"], ["Indústria", d.pct_ind, "#8e8a1f"], ["Serviços", d.pct_serv, "#3f8fa8"], ["Adm. pública", d.pct_adm, "#9aa5a2"]];
    el.innerHTML = `<h3>Economia – ${estado.municipio ? d.NM_MUN : "toda a RMP"}</h3><table>
      ${linha("pib_milhoes")}${linha("pib_per_capita")}
      ${rk ? `<tr><td>Posição no PIB per capita da RMP</td><td>${rk}º de 24</td></tr>` : ""}
      ${linha("empresas")}${linha("pessoal_ocupado")}${linha("salario_medio_sm")}${linha("pop_estimada")}${linha("cresc_pop_pct")}</table>
      <h3>Composição do valor adicionado (${a.vab})</h3>
      <div class="barra-vab">${set.map(([n, p, c]) => `<span style="width:${p || 0}%;background:${c}" title="${n}: ${fmt(p, 1)}%"></span>`).join("")}</div>
      <div class="leg-vab">${set.map(([n, p, c]) => `<span><i style="background:${c}"></i>${n} ${fmt(p, 1)}%</span>`).join("")}</div>`;
  }

  // ---------- Equipamentos urbanos ----------
  let camadaEquip = null; const gruposEquip = {}, equipOn = {};
  Object.entries(CONFIG.equipamentos).forEach(([c, e]) => (equipOn[c] = e.on));
  function montaEquip() {
    if (!equipStats) { $("equip-indisp").hidden = false; $("chk-equip").disabled = true; return; }
    const tot = equipStats.dados.RMP, porGrupo = {};
    Object.entries(CONFIG.equipamentos).forEach(([c, e]) => (porGrupo[e.grupo] = porGrupo[e.grupo] || []).push([c, e]));
    $("lista-equip").innerHTML = Object.entries(porGrupo).map(([g, itens]) => `<div class="grupo-leg">${g}</div>` + itens.map(([c, e]) =>
      `<label class="chk"><input type="checkbox" data-cat="${c}" ${e.on ? "checked" : ""}><span class="pto" style="background:${e.cor}"></span><span>${c}</span><small>${fmt(tot[c] || 0)}</small></label>`).join("")).join("");
    $("lista-equip").classList.add("desligado");
    $("lista-equip").querySelectorAll("input").forEach(i => i.onchange = () => {
      equipOn[i.dataset.cat] = i.checked;
      if (camadaEquip && mapa.hasLayer(camadaEquip)) {
        const g = gruposEquip[i.dataset.cat]; if (g) i.checked ? camadaEquip.addLayer(g) : camadaEquip.removeLayer(g);
      }
    });
    $("chk-equip").onchange = async e => {
      $("lista-equip").classList.toggle("desligado", !e.target.checked);
      if (!camadaEquip) {
        const g = await getJSONopc("equipamentos"); if (!g) { alert("Camada ainda não disponível."); return; }
        g.features.forEach(f => {
          const c = f.properties.categoria, est = CONFIG.equipamentos[c] || { cor: "#666" };
          const forte = /Hospital|Universidade|Pronto/.test(c);
          const m = L.circleMarker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
            renderer: rCanvas.equip, radius: forte ? 6 : 4.5, color: "#ffffff", weight: 1.3, fillColor: est.cor, fillOpacity: 0.95 });
          const p = f.properties;
          m.bindTooltip(`${p.nome || c}`, { direction: "top", offset: [0, -4] });
          m.on("click", ev => {
            L.DomEvent.stop(ev);
            L.popup({ maxWidth: 280 }).setLatLng(ev.latlng).setContent(`<div class="popup"><b>${p.nome || "(sem nome)"}</b><br>
              <small><span class="pt" style="background:${est.cor};border-radius:50%"></span>${c}</small><table>
              ${p.endereco ? `<tr><td>Endereço</td><td>${p.endereco}</td></tr>` : ""}
              ${p.rede ? `<tr><td>Esfera / rede</td><td>${p.rede}</td></tr>` : ""}
              ${p.niveis ? `<tr><td>Etapas de ensino</td><td>${p.niveis}</td></tr>` : ""}
              ${p.porte ? `<tr><td>Porte</td><td>${p.porte}</td></tr>` : ""}
              ${p.sus ? `<tr><td>Atende SUS (ambulatório)</td><td>${p.sus}</td></tr>` : ""}
              <tr><td>Município</td><td>${p.NM_MUN}</td></tr><tr><td>Fonte</td><td>${p.fonte}</td></tr></table></div>`).openOn(mapa);
          });
          (gruposEquip[c] = gruposEquip[c] || L.layerGroup()).addLayer(m);
        });
        camadaEquip = L.layerGroup();
      }
      Object.entries(gruposEquip).forEach(([c, g]) => equipOn[c] ? camadaEquip.addLayer(g) : camadaEquip.removeLayer(g));
      e.target.checked ? camadaEquip.addTo(mapa) : mapa.removeLayer(camadaEquip);
    };
  }
  function equipMunicipio() {
    const el = $("equip-mun");
    if (!equipStats) { el.innerHTML = ""; return; }
    const d = equipStats.dados[estado.municipio || "RMP"]; if (!d) { el.innerHTML = ""; return; }
    const f = dadosMun.features.find(x => x.properties.CD_MUN === estado.municipio);
    const pop = f ? f.properties.pop_total : dadosMun.features.reduce((s, x) => s + x.properties.pop_total, 0);
    const linhas = Object.keys(CONFIG.equipamentos).filter(c => d[c]).map(c =>
      `<tr><td><span class="pto-mini" style="background:${CONFIG.equipamentos[c].cor}"></span>${c}</td><td>${fmt(d[c])}</td><td>${fmt(d[c] / pop * 10000, 1)}</td></tr>`).join("");
    el.innerHTML = `<h3>Equipamentos – ${estado.municipio ? f.properties.NM_MUN : "toda a RMP"}</h3>
      <table class="tab-equip"><tr><th></th><th>nº</th><th>por 10 mil hab.</th></tr>${linhas}</table>`;
  }

  // ---------- Relevo ----------
  let camadaHipso = null, camadaCurvas = null;
  function montaRelevo() {
    const m = rasters.relevo;
    if (!m) { $("legenda-relevo").textContent = "Relevo indisponível."; return; }
    camadaHipso = overlay("relevo", url("relevo_png"), "relevo", 0.85);
    $("legenda-relevo").innerHTML = `<div class="grad-relevo"></div>
      <div class="grad-rot"><span>${fmt(m.escala_min)} m</span><span>${fmt((m.escala_min + m.escala_max) / 2)} m</span><span>${fmt(m.escala_max)} m</span></div>
      <p class="nota">Altitude na RMP: ${fmt(m.min)} a ${fmt(m.max)} m.</p>`;
    $("chk-hipso").onchange = e => e.target.checked ? camadaHipso.addTo(mapa) : mapa.removeLayer(camadaHipso);
    $("chk-curvas").onchange = async e => {
      if (!camadaCurvas) {
        const g = await getJSON("curvas");
        camadaCurvas = L.geoJSON(g, { filter: semPontos,
          renderer: rCanvas.curvas,
          style: f => ({ color: "#7b5b3a", weight: f.properties.altitude % 100 === 0 ? 1.2 : 0.5, opacity: 0.8 }),
          onEachFeature: (f, l) => l.bindTooltip(`${fmt(f.properties.altitude)} m`, { sticky: true }),
        });
      }
      e.target.checked ? camadaCurvas.addTo(mapa) : mapa.removeLayer(camadaCurvas);
    };
  }

  // ---------- Hidrografia ----------
  const hidro = {};
  async function alternaHidro(chave, ligado) {
    if (!hidro[chave]) {
      const g = await getJSONopc(chave);
      if (!g) { alert("Camada ainda não disponível."); return; }
      hidro[chave] = chave === "rios"
        ? L.geoJSON(g, { filter: semPontos, renderer: rCanvas.agua,
            style: f => ({ color: "#2b7bb9", weight: f.properties.tipo === "Rio" ? 2.4 : f.properties.tipo === "Canal" ? 1.2 : 0.8, opacity: 0.9 }),
            onEachFeature: (f, l) => l.bindTooltip(`${f.properties.nome || f.properties.tipo}`, { sticky: true }) })
        : L.geoJSON(g, { filter: semPontos, renderer: rCanvas.agua,
            style: { color: "#2b7bb9", weight: 0.6, fillColor: "#6baed6", fillOpacity: 0.7 },
            onEachFeature: (f, l) => l.bindTooltip(`${f.properties.nome || "Corpo d'água"} · ${fmt(f.properties.area_ha, 1)} ha`, { sticky: true }) });
    }
    ligado ? hidro[chave].addTo(mapa) : mapa.removeLayer(hidro[chave]);
  }

  // ---------- Sistema viário ----------
  const estiloVia = f => {
    const e = CONFIG.vias[f.properties.classe] || { cor: "#999", peso: 1 };
    return { color: e.cor, weight: e.peso, opacity: 0.95, dashArray: e.tracejado || null };
  };
  const tooltipVia = (f, l) => {
    const p = f.properties, nome = [p.ref, p.nome].filter(Boolean).join(" – ");
    l.bindTooltip(`${nome || "(sem nome)"}<br><small>${p.classe}${p.pavimento ? " · " + p.pavimento : ""}</small>`, { sticky: true });
  };
  let camadaRodovias = null;
  const camadaRuas = L.layerGroup(), ruasCache = {};
  async function alternaRodovias(ligado) {
    if (!camadaRodovias) {
      const g = await getJSONopc("rodovias"); if (!g) { alert("Camada ainda não disponível."); return; }
      camadaRodovias = L.geoJSON(g, { filter: semPontos, renderer: rCanvas.vias, style: estiloVia, onEachFeature: tooltipVia });
    }
    ligado ? camadaRodovias.addTo(mapa) : mapa.removeLayer(camadaRodovias);
  }
  function atualizaRuas() {
    if (!$("chk-ruas").checked) return;
    const perto = mapa.getZoom() >= CONFIG.zoom_ruas;
    $("nota-ruas").classList.toggle("alerta", !perto);
    if (!perto) { mapa.removeLayer(camadaRuas); return; }
    camadaRuas.addTo(mapa);
    const vista = mapa.getBounds();
    camadaMun.eachLayer(l => {
      const cd = l.feature.properties.CD_MUN;
      if (!vista.intersects(l.getBounds()) || ruasCache[cd]) return;
      ruasCache[cd] = getJSONopc("ruas", { cd }).then(g => {
        if (g) camadaRuas.addLayer(L.geoJSON(g, { filter: semPontos, renderer: rCanvas.vias, style: estiloVia, onEachFeature: tooltipVia }));
      });
    });
  }
  function legendaVias() {
    $("legenda-vias").innerHTML = Object.entries(CONFIG.vias).map(([n, e]) =>
      `<div class="item"><span class="linha" style="border-top:${Math.max(e.peso, 1.5)}px ${e.tracejado ? "dashed" : "solid"} ${e.cor}"></span>${n}</div>`).join("");
  }

  // ---------- Consulta por clique ----------
  async function consulta(latlng, setor) {
    const linhas = [];
    if (setor) {
      const p = setor;
      linhas.push(`<b>${p.NM_MUN}</b> · ${p.NM_BAIRRO || p.NM_DIST || ""}<br><small>Setor ${p.CD_SETOR} · ${p.SITUACAO}</small>
        <table><tr><td>População</td><td>${fmt(p.pop_total)}</td></tr>
        <tr><td>Domicílios ocupados</td><td>${fmt(p.dom_ocup)}</td></tr>
        <tr><td>Média moradores</td><td>${fmt(p.media_morad, 2)}</td></tr>
        <tr><td>Densidade (hab./km²)</td><td>${fmt(p.dens_demog, 1)}</td></tr>
        <tr><td>Área (km²)</td><td>${fmt(p.area_km2, 3)}</td></tr>
        ${p.ts_2025 != null ? `<tr><td>TS média do setor 2025</td><td>${fmt(p.ts_2025, 1)} °C</td></tr>
        <tr><td>ΔTS do setor 2025</td><td>${p.dts_2025 > 0 ? "+" : ""}${fmt(p.dts_2025, 1)} °C</td></tr>` : ""}</table>`);
    }
    const extras = [];
    if (rasters.relevo) {
      const px = await lePixel("relevo", url("altitude_png"), latlng).catch(() => null);
      if (px && px[3] > 128) extras.push(`<tr><td>Altitude</td><td>${fmt((px[0] * 256 + px[1]) / 10, 0)} m</td></tr>`);
    }
    if (usoStats && rasters.uso_1990) for (const a of ["1990", "2025"]) {
      const c = classeDoPixel(await lePixel("uso_" + a, url("uso_png", { ano: a }), latlng).catch(() => null));
      if (c) extras.push(`<tr><td>Uso ${a}</td><td><span class="pt" style="background:${c.cor}"></span>${c.nome}</td></tr>`);
    }
    if (tsStats && rasters.ts2025) {
      const px = await lePixel("ts2025", url("ts_valor_png"), latlng).catch(() => null);
      if (px && px[3] > 128) {
        const dts = ((px[0] * 256 + px[1]) - 32768) / 100, med = tsStats.mediana_por_idx[String(px[2])];
        const cls = tsStats.classes[[-2, -1, 1, 2, 4].filter(q => dts >= q).length];
        extras.push(`<tr><td>Temp. superfície 2025</td><td>${med != null ? fmt(dts + med, 1) + " °C" : "–"}</td></tr>
          <tr><td>ΔTS 2025</td><td><span class="pt" style="background:${cls.cor}"></span>${dts > 0 ? "+" : ""}${fmt(dts, 1)} °C</td></tr>`);
      }
    }
    if (transStats && rasters.transicao) {
      const t = categoriaDoPixel(await lePixel("transicao", url("trans_png"), latlng).catch(() => null));
      if (t) extras.push(`<tr><td>Mudança</td><td><span class="pt" style="background:${t.cor}"></span>${t.nome}</td></tr>`);
    }
    if (extras.length) linhas.push(`<table>${extras.join("")}</table>`);
    if (!linhas.length) return;
    linhas.push(`<small class="coord">${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}</small>`);
    L.popup({ maxWidth: 300 }).setLatLng(latlng).setContent(`<div class="popup">${linhas.join("")}</div>`).openOn(mapa);
  }
  mapa.on("click", e => consulta(e.latlng, null));

  // ---------- Painel do município ----------
  function cartoes(r) {
    $("resumo").innerHTML = [
      [fmt(r.municipios), "municípios"], [fmt(r.pop_total), "habitantes (2022)"],
      [fmt(r.setores), "setores censitários"], [fmt(r.area_km2, 0) + " km²", "área total"],
    ].map(([b, s]) => `<div class="cartao"><b>${b}</b><span>${s}</span></div>`).join("");
  }
  function infoMunicipio() {
    const el = $("info-mun");
    const f = dadosMun.features.find(x => x.properties.CD_MUN === estado.municipio);
    let vias = "";
    if (resumoVias) {
      const linhas = estado.municipio ? [resumoVias[estado.municipio] || {}] : Object.values(resumoVias);
      const km = linhas.reduce((s, o) => s + Object.values(o).reduce((a, b) => a + b, 0), 0);
      vias = `<tr><td>Extensão de vias (OSM)</td><td>${fmt(km, 0)} km</td></tr>`;
    }
    transMunicipio(); legendaTrans(); tsMunicipio(); legendaTS(); ecoMunicipio(); equipMunicipio();
    if (camadaTSSet) { calcQuebrasTS(); camadaTSSet.setStyle(estiloTSSet); legendaTSSet(); }
    if (camadaEco) camadaEco.setStyle(estiloEco);
    if (!f) { el.innerHTML = vias ? `<table>${vias}</table>` : ""; usoMunicipio(); return; }
    const p = f.properties;
    el.innerHTML = `<table>
      <tr><td>Código IBGE</td><td>${p.CD_MUN}</td></tr>
      <tr><td>População (2022)</td><td>${fmt(p.pop_total)}</td></tr>
      <tr><td>Domicílios ocupados</td><td>${fmt(p.dom_ocup)}</td></tr>
      <tr><td>Área</td><td>${fmt(p.area_km2, 2)} km²</td></tr>
      <tr><td>Densidade</td><td>${fmt(p.dens_demog, 1)} hab./km²</td></tr>
      <tr><td>Setores</td><td>${fmt(p.n_setores)}</td></tr>${vias}</table>`;
    usoMunicipio();
  }
  function selecionarMunicipio(cd) {
    estado.municipio = cd; $("sel-mun").value = cd; infoMunicipio(); redesenhar();
    mapa.invalidateSize();
    if (cd) camadaMun.eachLayer(l => { if (l.feature.properties.CD_MUN === cd) mapa.fitBounds(l.getBounds(), { padding: [20, 20] }); });
    else mapa.fitBounds(camadaMun.getBounds());
  }

  // ---------- Carregamento inicial ----------
  Promise.all([getJSON("municipios"), getJSON("setores"), getJSON("resumo"),
               getJSONopc("rasters"), getJSONopc("uso_stats"), getJSONopc("resumo_vias"), getJSONopc("trans_stats"),
               getJSONopc("ts_stats"), getJSONopc("ts_setores"), getJSONopc("economia"), getJSONopc("equip_stats")])
    .then(([mun, set, resumo, ras, uso, rv, tr, ts, tsSet, eco, eqs]) => {
      dadosMun = mun; dadosSet = set; rasters = ras || {}; usoStats = uso; resumoVias = rv; transStats = tr; tsStats = ts;
      ecoDados = eco; equipStats = eqs;
      // junta TS 2025 aos setores (CD_SETOR)
      if (tsSet) set.features.forEach(f => {
        const v = tsSet[f.properties.CD_SETOR];
        f.properties.ts_2025 = v ? v[0] : null; f.properties.dts_2025 = v ? v[1] : null;
      });
      temTSset = !!tsSet;
      cartoes(resumo);

      camadaSet = L.geoJSON(set, {
        renderer: rCanvas.setores, style: estiloSetor,
        onEachFeature: (f, l) => l.on({
          mouseover: e => { e.target.setStyle({ weight: 2, color: "#222" }); hover.update(f.properties); },
          mouseout: e => { camadaSet.resetStyle(e.target); hover.update(); },
          click: e => { L.DomEvent.stop(e); consulta(e.latlng, f.properties); },
        }),
      });
      if ($("chk-set").checked) camadaSet.addTo(mapa);

      // Municípios coloridos: cada município recebe uma cor única da paleta; a cor escolhida é a ainda livre
      // mais diferente das cores dos vizinhos já pintados (vizinho = retângulos envolventes que se tocam)
      const paleta = CONFIG.cores_municipios, caixas = mun.features.map(f => L.geoJSON(f).getBounds());
      const viz = caixas.map((b, i) => caixas.map((c, j) => i !== j && b.intersects(c) ? j : -1).filter(j => j >= 0));
      const rgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
      const dist = (a, b) => { const [p, q] = [rgb(a), rgb(b)]; return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
      corMun = {};
      const livres = paleta.slice();
      mun.features.map((f, i) => i).sort((a, b) => viz[b].length - viz[a].length).forEach(i => {
        const cv = viz[i].map(j => corMun[mun.features[j].properties.CD_MUN]).filter(Boolean);
        if (!livres.length) livres.push(...paleta);   // paleta menor que o nº de municípios: repete
        let melhor = 0, nota = -1;
        livres.forEach((c, k) => { const d = cv.length ? Math.min(...cv.map(v => dist(c, v))) : 999; if (d > nota) { nota = d; melhor = k; } });
        corMun[mun.features[i].properties.CD_MUN] = livres.splice(melhor, 1)[0];
      });
      estado.opacMunCor = 1 - CONFIG.transparencia_municipios;
      const estiloMunCor = f => ({ stroke: false, fillColor: corMun[f.properties.CD_MUN], fillOpacity: estado.opacMunCor });
      camadaMunCor = L.geoJSON(mun, { renderer: rCanvas.municor, style: estiloMunCor, interactive: false });
      if ($("chk-mun-cor").checked) camadaMunCor.addTo(mapa);
      $("rng-mun-cor").oninput = e => {
        $("val-mun-cor").textContent = e.target.value + "%"; estado.opacMunCor = 1 - e.target.value / 100; camadaMunCor.setStyle(estiloMunCor);
      };
      $("rng-fundo").value = Math.round((1 - opacFundo) * 100); $("val-fundo").textContent = $("rng-fundo").value + "%";
      $("rng-fundo").oninput = e => {
        $("val-fundo").textContent = e.target.value + "%"; opacFundo = 1 - e.target.value / 100;
        Object.values(fundos).forEach(l => l.setOpacity(opacFundo));
      };

      camadaMun = L.geoJSON(mun, { renderer: rCanvas.limites, style: estiloMun, interactive: false }).addTo(mapa);
      rotulos = L.layerGroup(mun.features.map(f =>
        L.tooltip({ permanent: true, direction: "center", className: "rotulo-mun" })
          .setLatLng(L.geoJSON(f).getBounds().getCenter()).setContent(f.properties.NM_MUN))).addTo(mapa);

      // Controles do Censo
      const selVar = $("sel-var");
      selVar.innerHTML = Object.entries(CONFIG.variaveis).map(([k, v]) => `<option value="${k}">${v.nome}</option>`).join("");
      selVar.onchange = e => { estado.variavel = e.target.value; redesenhar(); };
      $("sel-classe").onchange = e => { estado.classe = e.target.value; redesenhar(); };
      $("rng-opac").oninput = e => {
        estado.opacidade = e.target.value / 100; $("val-opac").textContent = e.target.value + "%"; camadaSet.setStyle(estiloSetor);
      };
      const selMun = $("sel-mun");
      [...mun.features].sort((a, b) => a.properties.NM_MUN.localeCompare(b.properties.NM_MUN, "pt-BR"))
        .forEach(f => selMun.insertAdjacentHTML("beforeend", `<option value="${f.properties.CD_MUN}">${f.properties.NM_MUN}</option>`));
      selMun.onchange = e => selecionarMunicipio(e.target.value);
      const alterna = (id, camada) => $(id).onchange = e => e.target.checked ? camada.addTo(mapa) : mapa.removeLayer(camada);
      alterna("chk-mun", camadaMun); alterna("chk-set", camadaSet); alterna("chk-mun-cor", camadaMunCor); alterna("chk-rot", rotulos);

      // Novas camadas
      montaUso(); montaRelevo(); montaTS(); montaTSSet(); montaEco(); montaEquip(); legendaVias();
      $("chk-rios").onchange = e => alternaHidro("rios", e.target.checked);
      $("chk-massas").onchange = e => alternaHidro("massas", e.target.checked);
      $("chk-rodovias").onchange = e => alternaRodovias(e.target.checked);
      $("chk-ruas").onchange = e => {
        if (e.target.checked) { atualizaRuas(); if (mapa.getZoom() < CONFIG.zoom_ruas) $("nota-ruas").classList.add("alerta"); }
        else { mapa.removeLayer(camadaRuas); $("nota-ruas").classList.remove("alerta"); }
      };
      mapa.on("moveend", atualizaRuas);

      GEO.resumo = resumo; GEO.municipios = mun.features.map(f => [f.properties.CD_MUN, f.properties.NM_MUN])
        .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
      document.dispatchEvent(new CustomEvent("geo-pronto"));

      // Vista inicial: #zoom/lat/lon no endereço (link compartilhável) ou a RMP inteira
      // (se a página carregar com o mapa invisível/tamanho zero, espera ele ganhar tamanho)
      const h = location.hash.slice(1).split("/").map(Number);
      const vistaInicial = () => {
        vistaPendente = false;
        if (h.length === 3 && h.every(n => !isNaN(n)) && h[0] >= 7) mapa.setView([h[1], h[2]], h[0]);
        else mapa.fitBounds(camadaMun.getBounds());
        vistaPendente = false;
      };
      vistaPendente = true;
      if (mapa.getSize().x > 50) vistaInicial();
      else { mapa.setView(CONFIG.centro, CONFIG.zoom); vistaPendente = vistaInicial; }
      mapa.on("moveend", () => {
        if (vistaPendente) return;
        const c = mapa.getCenter();
        history.replaceState(null, "", `#${mapa.getZoom()}/${c.lat.toFixed(5)}/${c.lng.toFixed(5)}`);
      });
      infoMunicipio(); redesenhar(); atualizaRuas();
      $("carregando").classList.add("oculto");
    })
    .catch(err => {
      $("carregando").innerHTML = `<div style="max-width:460px;padding:16px;text-align:center">Não foi possível carregar os dados (${err.message}).<br><br>
         Abra o geoportal pelo arquivo <b>iniciar_geoportal.bat</b> (servidor local) em vez de clicar direto no index.html.</div>`;
      console.error(err);
    });

  // ---------- Camadas ligadas (usado pelo "Monte seu mapa") ----------
  // Cada item: título, fonte e de onde tirar a legenda (elemento da legenda do painel, itens fixos ou gradiente).
  function camadasAtivas() {
    const on = l => l && mapa.hasLayer(l), lst = [];
    const nomeMun = estado.municipio ? $("sel-mun").selectedOptions[0].text : "";
    if (on(camadaSet)) {
      const v = CONFIG.variaveis[estado.variavel];
      lst.push({ id: "setores", titulo: `${v.nome}${v.unidade && !v.nome.includes(v.unidade) ? " (" + v.unidade + ")" : ""}`,
                 el: $("legenda"), fonte: v.ts != null ? "Landsat 8/9 C2 L2 (USGS) e IBGE – Censo 2022" : "IBGE – Censo Demográfico 2022" });
    }
    if (estado.usoAno === "transicao" && transStats)
      lst.push({ id: "uso", titulo: "Mudanças de uso e cobertura 1990 → 2025", el: $("legenda-trans"), fonte: "MapBiomas Coleção 11" });
    else if (estado.usoAno)
      lst.push({ id: "uso", titulo: `Uso e cobertura da terra ${estado.usoAno}`, el: $("legenda-uso"), fonte: "MapBiomas Coleção 11" });
    if (on(camadaTSSet)) {
      const v = CONFIG.ts_setores[varTS];
      lst.push({ id: "tsset", titulo: `${v.nome} por setor urbano (°C)`, el: $("legenda-ts-set"), fonte: "Landsat 8/9 C2 L2 (USGS) e IBGE – Censo 2022" });
    }
    if (on(camadaEco)) {
      const v = ecoDados.variaveis[varEco];
      lst.push({ id: "eco", titulo: `${v.nome} (${v.unidade})`, el: $("legenda-eco"), fonte: v.fonte });
    }
    if (on(camadaEquip)) lst.push({ id: "equip", titulo: "Equipamentos urbanos", fonte: "INEP – Catálogo de Escolas 2023; CNES/Ministério da Saúde; © colaboradores do OpenStreetMap",
      itens: Object.entries(CONFIG.equipamentos).filter(([c]) => equipOn[c] && gruposEquip[c]).map(([c, e]) => ({ ponto: e.cor, rotulo: c })) });
    if (on(camadaTS)) lst.push({ id: "ts", titulo: "ΔTS 2025 – área urbana (°C)", el: $("legenda-ts"), fonte: "Landsat 8/9 C2 L2 (USGS/NASA)" });
    if (on(camadaHipso)) {
      const m = rasters.relevo;
      lst.push({ id: "hipso", titulo: "Altitude (m)", fonte: "Copernicus DEM GLO-30 (ESA)",
        gradiente: { cores: ["rgb(56,128,77)", "rgb(139,179,96)", "rgb(231,214,128)", "rgb(196,140,80)", "rgb(135,90,60)"],
                     rotulos: [fmt(m.escala_min), fmt((m.escala_min + m.escala_max) / 2), fmt(m.escala_max)] } });
    }
    if (on(camadaCurvas)) lst.push({ id: "curvas", titulo: "Curvas de nível", fonte: "Copernicus DEM GLO-30 (ESA)",
      itens: [{ linha: "#7b5b3a", larg: 1.4, rotulo: "Curva mestra (100 m)" }, { linha: "#7b5b3a", larg: 0.7, rotulo: "Curva intermediária (50 m)" }] });
    if (on(hidro.rios) || on(hidro.massas)) {
      const itens = [];
      if (on(hidro.rios)) itens.push({ linha: "#2b7bb9", larg: 2.4, rotulo: "Rio" }, { linha: "#2b7bb9", larg: 0.9, rotulo: "Córrego / canal" });
      if (on(hidro.massas)) itens.push({ cor: "#6baed6", borda: "#2b7bb9", rotulo: "Represa / lago" });
      lst.push({ id: "hidro", titulo: "Hidrografia", itens, fonte: "© colaboradores do OpenStreetMap" });
    }
    if (on(camadaRodovias) || on(camadaRuas)) lst.push({ id: "vias", titulo: "Sistema viário", el: $("legenda-vias"), fonte: "© colaboradores do OpenStreetMap",
      filtroItens: on(camadaRuas) ? null : n => /Rodovia|arterial/.test(n) });
    if (on(camadaMunCor)) {
      const rgba = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
      lst.push({ id: "municor", titulo: "Municípios", fonte: "IBGE – Malha Municipal 2024",
        itens: (GEO.municipios || []).map(([cd, nm]) => ({ cor: rgba(corMun[cd], Math.max(estado.opacMunCor, 0.15)), rotulo: nm })) });
    }
    if (on(camadaMun)) lst.push({ id: "mun", titulo: "Limites", fonte: "IBGE – Malha Municipal 2024",
      itens: [{ linha: "#1f2933", larg: 1.4, rotulo: "Limite municipal" }].concat(estado.municipio ? [{ linha: "#d1495b", larg: 3, rotulo: nomeMun }] : []) });
    return lst;
  }
  const fundoAtivo = () => Object.values(fundos).find(l => mapa.hasLayer(l));
  window.GEO = { mapa, camadasAtivas, fundoAtivo, estado, rotulos: () => rotulos };

  $("btn-painel").onclick = () => $("painel").classList.toggle("aberto");
  let vistaPendente = false;
  if (window.ResizeObserver) new ResizeObserver(() => {
    mapa.invalidateSize();
    if (typeof vistaPendente === "function" && mapa.getSize().x > 50) vistaPendente();
  }).observe($("mapa"));
})();
