/* Geoportal RMP – "Monte seu mapa": compõe título, mapa, legenda, norte, escala e fontes e exporta em JPG.
   O mapa é copiado do próprio Leaflet (blocos do fundo, imagens raster e canvas vetoriais),
   sem bibliotecas externas. Em "Alta", o mapa é redesenhado temporariamente com o dobro do tamanho
   e um nível de zoom a mais (mesma área, resolução 2×). */
(function () {
  const $ = id => document.getElementById(id);
  const fmt = (v, c = 0) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
  const FONTE = '"Ubuntu", "Segoe UI", sans-serif';
  const fora = new Set();   // camadas desmarcadas da legenda

  // ---------- Lista de camadas ligadas ----------
  function atualizaLista() {
    if (!window.GEO) return;
    const lst = GEO.camadasAtivas();
    $("mm-camadas").innerHTML = lst.length
      ? lst.map(c => `<label class="chk"><input type="checkbox" data-id="${c.id}" ${fora.has(c.id) ? "" : "checked"}><span>${c.titulo}</span></label>`).join("")
      : `<p class="vazio">Nenhuma camada temática ligada. Ligue camadas na aba <b>Camadas</b>.</p>`;
    $("mm-camadas").querySelectorAll("input").forEach(i => i.onchange = () => i.checked ? fora.delete(i.dataset.id) : fora.add(i.dataset.id));
  }
  document.addEventListener("aba-monte", atualizaLista);
  document.addEventListener("geo-pronto", () => GEO.mapa.on("layeradd layerremove", () => { if (!$("painel-monte").hidden) atualizaLista(); }));

  // ---------- Itens de legenda (lidos das legendas do painel) ----------
  function itensDaLegenda(c) {
    if (c.gradiente) return [{ tipo: "grad", ...c.gradiente }];
    if (c.itens) return c.itens.map(i => i.linha ? { tipo: "linha", cor: i.linha, larg: i.larg, rotulo: i.rotulo }
                                       : i.ponto ? { tipo: "ponto", cor: i.ponto, rotulo: i.rotulo }
                                                 : { tipo: "area", cor: i.cor, borda: i.borda, rotulo: i.rotulo });
    const out = [];
    c.el.querySelectorAll(".grupo-leg, .item").forEach(n => {
      if (n.classList.contains("grupo-leg")) {
        const t = n.textContent.trim(); if (!t.includes(" · ")) out.push({ tipo: "grupo", rotulo: t }); return;
      }
      const cl = n.cloneNode(true); cl.querySelectorAll(".cod").forEach(x => x.remove());
      const rot = cl.textContent.trim().replace(/\s+/g, " ");
      if (c.filtroItens && !c.filtroItens(rot)) return;
      const sw = n.querySelector(".cor"), ln = n.querySelector(".linha");
      if (sw) out.push({ tipo: "area", cor: sw.style.backgroundColor || sw.style.background, rotulo: rot });
      else if (ln) out.push({ tipo: "linha", cor: ln.style.borderTopColor, larg: parseFloat(ln.style.borderTopWidth) || 1.5,
                              trac: ln.style.borderTopStyle === "dashed", rotulo: rot });
    });
    // grupo sem itens depois dele (ex.: filtrado) sai
    return out.filter((it, i) => it.tipo !== "grupo" || (out[i + 1] && out[i + 1].tipo !== "grupo"));
  }

  // ---------- Espera o mapa terminar de desenhar ----------
  const espera = ms => new Promise(r => setTimeout(r, ms));
  async function esperaMapa() {
    // espera todos os blocos do fundo carregarem (até 12 s)
    await espera(150);
    const cont = GEO.mapa.getContainer(), t0 = Date.now();
    while (Date.now() - t0 < 12000) {
      const t = GEO.fundoAtivo(), tiles = [...cont.querySelectorAll("img.leaflet-tile")];
      const ok = tiles.length > 0 && tiles.every(i => i.complete) && !(t && t.isLoading && t.isLoading());
      if (ok) break;
      await espera(150);
    }
    const imgs = [...GEO.mapa.getContainer().querySelectorAll(".leaflet-image-layer")].filter(i => !i.complete);
    await Promise.race([Promise.all(imgs.map(i => new Promise(r => { i.onload = i.onerror = r; }))), espera(8000)]);
    await espera(400);   // fade dos blocos + redesenho dos canvas
  }

  // ---------- Copia o mapa (DOM do Leaflet) para um canvas ----------
  function rasteriza(k) {
    const mapa = GEO.mapa, cont = mapa.getContainer(), r0 = cont.getBoundingClientRect();
    const W = Math.round(r0.width), H = Math.round(r0.height);
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#e6e9e8"; ctx.fillRect(0, 0, W, H);
    const opac = el => {
      let o = 1;
      for (let n = el; n && n !== cont; n = n.parentElement) {
        const s = getComputedStyle(n); if (s.display === "none" || s.visibility === "hidden") return 0;
        // a opacidade do próprio bloco é só a animação de "fade" (pode estar parada em aba de fundo)
        if (!(n === el && el.classList.contains("leaflet-tile-loaded"))) o *= parseFloat(s.opacity);
      }
      return o;
    };
    const desenha = el => {
      if (el.tagName === "IMG" && (!el.complete || !el.naturalWidth)) return;
      const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
      const o = opac(el); if (o <= 0.01) return;
      ctx.globalAlpha = o;
      ctx.imageSmoothingEnabled = !el.classList.contains("pixelado");
      ctx.drawImage(el, r.left - r0.left, r.top - r0.top, r.width, r.height);
    };
    const zi = el => parseInt(getComputedStyle(el).zIndex) || 0;
    const panes = [...mapa.getPane("mapPane").children].filter(p => p.classList.contains("leaflet-pane"))
      .sort((a, b) => zi(a) - zi(b));
    for (const p of panes) {
      if (p.classList.contains("leaflet-popup-pane") || p.classList.contains("leaflet-shadow-pane")) continue;
      if (p.classList.contains("leaflet-tooltip-pane")) {
        // só os nomes dos municípios (rótulos permanentes)
        ctx.globalAlpha = 1; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = `500 ${11 * k}px ${FONTE}`; ctx.lineJoin = "round";
        p.querySelectorAll(".rotulo-mun").forEach(t => {
          const r = t.getBoundingClientRect(), x = r.left - r0.left + r.width / 2, y = r.top - r0.top + r.height / 2;
          if (x < 0 || y < 0 || x > W || y > H) return;
          ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 3.5 * k; ctx.strokeText(t.textContent, x, y);
          ctx.fillStyle = "#1f2933"; ctx.fillText(t.textContent, x, y);
        });
        continue;
      }
      if (p.classList.contains("leaflet-tile-pane")) {
        [...p.querySelectorAll(".leaflet-layer")].forEach(camada =>
          [...camada.querySelectorAll(".leaflet-tile-container")].sort((a, b) => zi(a) - zi(b))
            .forEach(c => c.querySelectorAll("img.leaflet-tile").forEach(desenha)));
        continue;
      }
      p.querySelectorAll("img, canvas").forEach(desenha);
    }
    ctx.globalAlpha = 1;
    // metros por pixel no centro (para a escala)
    const a = mapa.containerPointToLatLng([W / 2 - 50, H / 2]), b = mapa.containerPointToLatLng([W / 2 + 50, H / 2]);
    return { canvas: cv, W, H, mpp: mapa.distance(a, b) / 100 };
  }

  // ---------- Modo "alta": mapa 2× maior, zoom +1, linhas 2× mais grossas ----------
  async function ampliar() {
    const mapa = GEO.mapa, cont = mapa.getContainer(), r = cont.getBoundingClientRect();
    const centro = mapa.getCenter(), z = mapa.getZoom(), estilo = cont.getAttribute("style") || "";
    const pesos = [];
    mapa.eachLayer(l => {
      if (!(l instanceof L.Path)) return;
      const o = l.options; pesos.push([l, o.weight, o.dashArray]);
      l.setStyle({ weight: o.weight * 2, dashArray: o.dashArray ? String(o.dashArray).split(/[ ,]+/).map(n => n * 2).join(" ") : o.dashArray });
    });
    cont.style.cssText = estilo + `;position:fixed;left:0;top:0;width:${r.width * 2}px;height:${r.height * 2}px;flex:none;`;
    mapa.invalidateSize({ pan: false, animate: false });
    mapa.setView(centro, z + 1, { animate: false });
    await esperaMapa();
    return () => {
      cont.setAttribute("style", estilo);
      pesos.forEach(([l, w, d]) => l.setStyle({ weight: w, dashArray: d }));
      mapa.invalidateSize({ pan: false, animate: false });
      mapa.setView(centro, z, { animate: false });
    };
  }

  // ---------- Desenho dos elementos ----------
  function quebraTexto(ctx, txt, larg) {
    const linhas = []; let atual = "";
    for (const p of String(txt).split(/\s+/)) {
      const t = atual ? atual + " " + p : p;
      if (ctx.measureText(t).width > larg && atual) { linhas.push(atual); atual = p; } else atual = t;
    }
    if (atual) linhas.push(atual);
    return linhas;
  }
  function norte(ctx, x, y, k) {        // x,y = centro
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = 1 * k;
    ctx.beginPath(); ctx.arc(0, 0, 26 * k, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -17 * k); ctx.lineTo(8 * k, 9 * k); ctx.lineTo(0, 4 * k); ctx.closePath(); ctx.fillStyle = "#263238"; ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -17 * k); ctx.lineTo(-8 * k, 9 * k); ctx.lineTo(0, 4 * k); ctx.closePath(); ctx.fillStyle = "#9aa5a2"; ctx.fill();
    ctx.fillStyle = "#263238"; ctx.font = `700 ${11 * k}px ${FONTE}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", 0, 17 * k);
    ctx.restore();
  }
  function escala(ctx, x, y, mpp, larguraMapa, k) {   // x,y = canto inferior esquerdo
    const alvo = larguraMapa * 0.22 * mpp, pot = Math.pow(10, Math.floor(Math.log10(alvo)));
    const m = [1, 2, 2.5, 5, 10].map(f => f * pot).filter(v => v <= alvo).pop() || pot;
    const px = m / mpp, km = m >= 1000, rot = v => km ? fmt(v / 1000, (v / 1000) % 1 ? 1 : 0) : fmt(v);
    const h = 7 * k, pad = 10 * k;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fillRect(x, y - h - 30 * k, px + 2 * pad + 26 * k, h + 30 * k + pad * 0.6);
    const bx = x + pad, by = y - h - pad * 0.6;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? "#fff" : "#263238"; ctx.fillRect(bx + (px / 4) * i, by, px / 4, h);
    }
    ctx.strokeStyle = "#263238"; ctx.lineWidth = 1 * k; ctx.strokeRect(bx, by, px, h);
    ctx.fillStyle = "#263238"; ctx.font = `${10.5 * k}px ${FONTE}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    [0, 0.5, 1].forEach(f => ctx.fillText(rot(m * f), bx + px * f, by - 4 * k));
    ctx.textAlign = "left"; ctx.fillText(km ? "km" : "m", bx + px + 6 * k, by + h + 1 * k);
    ctx.restore();
  }
  // mede (desenha=false) ou desenha a legenda em colunas; retorna largura usada
  function legenda(ctx, blocos, x0, y0, altMax, k, desenha) {
    const colW = 250 * k, gap = 22 * k, sw = 24 * k, swH = 14 * k, lin = 19 * k;
    let col = 0, y = y0;
    const X = () => x0 + col * (colW + gap);
    const garante = h => { if (y + h > y0 + altMax && y > y0) { col++; y = y0; } };
    for (const b of blocos) {
      ctx.font = `700 ${13 * k}px ${FONTE}`;
      const tit = quebraTexto(ctx, b.titulo, colW);
      garante(tit.length * 17 * k + lin);
      tit.forEach(t => { if (desenha) { ctx.fillStyle = "#263238"; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(t, X(), y); } y += 17 * k; });
      y += 4 * k;
      for (const it of b.itens) {
        if (it.tipo === "grupo") {
          garante(lin * 2); ctx.font = `500 ${10 * k}px ${FONTE}`;
          if (desenha) { ctx.fillStyle = "#6b7775"; ctx.textBaseline = "top"; ctx.fillText(it.rotulo.toUpperCase(), X(), y + 3 * k); }
          y += lin; continue;
        }
        if (it.tipo === "grad") {
          garante(40 * k);
          if (desenha) {
            const g = ctx.createLinearGradient(X(), 0, X() + colW * 0.85, 0);
            it.cores.forEach((c, i) => g.addColorStop(i / (it.cores.length - 1), c));
            ctx.fillStyle = g; ctx.fillRect(X(), y, colW * 0.85, 12 * k);
            ctx.font = `${10.5 * k}px ${FONTE}`; ctx.fillStyle = "#263238"; ctx.textBaseline = "top";
            it.rotulos.forEach((r, i) => {
              ctx.textAlign = i === 0 ? "left" : i === it.rotulos.length - 1 ? "right" : "center";
              ctx.fillText(r, X() + colW * 0.85 * i / (it.rotulos.length - 1), y + 16 * k);
            });
            ctx.textAlign = "left";
          }
          y += 36 * k; continue;
        }
        ctx.font = `${11.5 * k}px ${FONTE}`;
        const linhas = quebraTexto(ctx, it.rotulo, colW - sw - 8 * k), h = Math.max(lin, linhas.length * 14 * k + 5 * k);
        garante(h);
        if (desenha) {
          const cy = y + lin / 2;
          if (it.tipo === "ponto") {
            ctx.beginPath(); ctx.arc(X() + sw / 2, cy, 5.5 * k, 0, 7); ctx.fillStyle = it.cor; ctx.fill();
            ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.4 * k; ctx.stroke();
          } else if (it.tipo === "area") {
            ctx.fillStyle = it.cor; ctx.fillRect(X(), cy - swH / 2, sw, swH);
            ctx.strokeStyle = it.borda || "rgba(0,0,0,.25)"; ctx.lineWidth = 1 * k; ctx.strokeRect(X(), cy - swH / 2, sw, swH);
          } else {
            ctx.strokeStyle = it.cor; ctx.lineWidth = Math.max(1, it.larg) * k; ctx.setLineDash(it.trac ? [4 * k, 3 * k] : []);
            ctx.beginPath(); ctx.moveTo(X(), cy); ctx.lineTo(X() + sw, cy); ctx.stroke(); ctx.setLineDash([]);
          }
          ctx.fillStyle = "#263238"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
          linhas.forEach((t, i) => ctx.fillText(t, X() + sw + 8 * k, cy + i * 14 * k));
        }
        y += h;
      }
      y += 14 * k;
    }
    return (col + 1) * colW + col * gap;
  }

  // ---------- Composição final ----------
  async function gerar() {
    const btn = $("mm-gerar"), st = $("mm-status"), q = Number($("mm-qualidade").value), k = q;
    const mapa = GEO.mapa;
    btn.disabled = true; st.textContent = "Gerando o mapa…"; mapa.closePopup();
    const cobre = $("carregando"); cobre.textContent = "Gerando o mapa…"; cobre.classList.remove("oculto");
    let restaura = null, rm;
    try {
      await document.fonts.load(`700 20px Ubuntu`).catch(() => {});
      if (q > 1) restaura = await ampliar(); else await esperaMapa();
      rm = rasteriza(k);
    } finally {
      if (restaura) restaura();
      cobre.classList.add("oculto");
      btn.disabled = false;
    }
    try {
      const titulo = $("mm-titulo").value.trim(), sub = $("mm-subtitulo").value.trim(), autor = $("mm-autor").value.trim();
      const usaLeg = $("mm-legenda").checked, usaNorte = $("mm-norte").checked, usaEsc = $("mm-escala").checked, usaFontes = $("mm-fontes").checked;
      const camadas = GEO.camadasAtivas();
      const blocos = usaLeg ? camadas.filter(c => !fora.has(c.id)).map(c => ({ titulo: c.titulo, itens: itensDaLegenda(c) })).filter(b => b.itens.length) : [];

      const M = 32 * k, gapLeg = 28 * k;
      const med = document.createElement("canvas").getContext("2d");
      // cabeçalho
      const legW = blocos.length ? legenda(med, blocos, 0, 0, rm.H, k, false) : 0;
      const Wt = M + rm.W + (legW ? gapLeg + legW : 0) + M;
      med.font = `700 ${26 * k}px ${FONTE}`; const linT = titulo ? quebraTexto(med, titulo, Wt - 2 * M) : [];
      med.font = `${16 * k}px ${FONTE}`; const linS = sub ? quebraTexto(med, sub, Wt - 2 * M) : [];
      const cabH = (linT.length ? linT.length * 32 * k : 0) + (linS.length ? linS.length * 22 * k + 4 * k : 0) + (linT.length || linS.length ? 18 * k : 0);
      // rodapé
      const fontes = [...new Set(camadas.map(c => c.fonte))];
      const fundo = GEO.fundoAtivo(); if (fundo && fundo.options.fonte) fontes.push("Mapa de fundo: " + fundo.options.fonte);
      const hoje = new Date().toLocaleDateString("pt-BR");
      const txtFontes = usaFontes ? "Fontes: " + fontes.join("; ") + "." : "";
      const txtDir = (usaFontes ? `Geoportal RMP · ${hoje} · ` : "") + "Projeção Web Mercator (EPSG:3857), datum WGS 84";
      med.font = `${11.5 * k}px ${FONTE}`;
      const linF = [autor ? "Elaboração: " + autor : "", ...(txtFontes ? quebraTexto(med, txtFontes, Wt - 2 * M) : []), txtDir].filter(Boolean);
      const rodH = 14 * k + linF.length * 16 * k;
      const Ht = M + cabH + rm.H + rodH + M * 0.8;

      const cv = document.createElement("canvas"); cv.width = Math.round(Wt); cv.height = Math.round(Ht);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
      let y = M;
      ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillStyle = "#1d2a2a";
      ctx.font = `700 ${26 * k}px ${FONTE}`; linT.forEach(t => { ctx.fillText(t, M, y); y += 32 * k; });
      if (linS.length) { y += 4 * k; ctx.font = `${16 * k}px ${FONTE}`; ctx.fillStyle = "#56625f"; linS.forEach(t => { ctx.fillText(t, M, y); y += 22 * k; }); }
      if (linT.length || linS.length) {
        y += 8 * k; ctx.fillStyle = "#3f9a78"; ctx.fillRect(M, y, 60 * k, 3 * k); y += 10 * k;
      }
      // mapa
      const mx = M, my = y;
      ctx.drawImage(rm.canvas, mx, my);
      ctx.strokeStyle = "#263238"; ctx.lineWidth = 1 * k; ctx.strokeRect(mx, my, rm.W, rm.H);
      if (usaNorte) norte(ctx, mx + rm.W - 40 * k, my + 40 * k, k);
      if (usaEsc) escala(ctx, mx + 12 * k, my + rm.H - 12 * k, rm.mpp, rm.W, k);
      if (blocos.length) legenda(ctx, blocos, mx + rm.W + gapLeg, my + 2 * k, rm.H, k, true);
      // rodapé
      y = my + rm.H + 14 * k;
      ctx.font = `${11.5 * k}px ${FONTE}`; ctx.fillStyle = "#56625f"; ctx.textBaseline = "top"; ctx.textAlign = "left";
      linF.forEach(t => { ctx.fillText(t, M, y); y += 16 * k; });

      const dataUrl = cv.toDataURL("image/jpeg", 0.92);
      $("mm-img").src = dataUrl; $("mm-baixar").href = dataUrl;
      const nomeArq = (titulo || "mapa_rmp").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
      $("mm-baixar").download = (nomeArq || "mapa_rmp") + ".jpg";
      $("mm-previa").hidden = false;
      st.textContent = `Pronto: ${cv.width} × ${cv.height} px. Confira a prévia e clique em “Baixar JPG”.`;
    } catch (e) {
      console.error(e);
      st.textContent = e.name === "SecurityError"
        ? "O mapa de fundo escolhido não permite exportar a imagem. Troque o mapa de fundo (ícone de camadas no canto do mapa) e tente de novo."
        : "Não foi possível gerar o mapa: " + e.message;
    }
  }
  $("mm-gerar").onclick =() => gerar().catch(e => { console.error(e); $("mm-status").textContent = "Erro: " + e.message; });
})();
