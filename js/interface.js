/* Geoportal RMP – navegação entre abas, página de Download e Mais informações */
(function () {
  const $ = id => document.getElementById(id);
  const fmt = (v, c = 0) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- Aviso rápido ----------
  let tAviso;
  window.avisoRapido = msg => {
    const el = $("aviso-flutuante"); el.textContent = msg; el.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => (el.hidden = true), 2600);
  };

  // ---------- Abas ----------
  const ABAS = ["camadas", "download", "monte", "info"];
  function abrirAba(aba) {
    if (!ABAS.includes(aba)) aba = "camadas";
    document.querySelectorAll(".nav-item").forEach(b => {
      const at = b.dataset.aba === aba; b.classList.toggle("ativo", at);
      at ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current");
    });
    $("pagina-download").hidden = aba !== "download";
    $("pagina-info").hidden = aba !== "info";
    $("painel-camadas").hidden = aba !== "camadas";
    $("painel-monte").hidden = aba !== "monte";
    $("btn-painel").textContent = aba === "monte" ? "Monte seu mapa" : "Camadas";
    $("nav").classList.remove("aberto"); $("btn-menu").setAttribute("aria-expanded", "false");
    if (aba === "monte") document.dispatchEvent(new CustomEvent("aba-monte"));
    if (aba === "info") animaContadores();
    if (window.GEO) setTimeout(() => GEO.mapa.invalidateSize(), 0);
    if (aba === "camadas" || aba === "monte") $("painel").scrollTop = 0;
    // em tela pequena, as abas do painel abrem a gaveta
    if (matchMedia("(max-width: 820px)").matches) $("painel").classList.toggle("aberto", aba === "camadas" || aba === "monte");
  }
  document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => abrirAba(b.dataset.aba)));
  $("btn-menu").onclick = () => {
    const ab = $("nav").classList.toggle("aberto"); $("btn-menu").setAttribute("aria-expanded", String(ab));
  };
  window.abrirAba = abrirAba;

  $("btn-link").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); avisoRapido("Link da vista atual copiado"); }
    catch { prompt("Copie o link:", location.href); }
  };

  // ---------- Download ----------
  const ICONES = {
    "Limites Territoriais": '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    "Demografia": '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="17" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 14c3 0 5 2 5 5" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    "Economia e Infraestrutura": '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    "Meio Ambiente": '<path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15M5 19l7-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const SETA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12m-5-5 5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const linkDe = (it, cd) => it.url ? it.url.replace("{cd}", cd || "") : CONFIG.BASE_DOWNLOAD + (it.arquivo || it.por_municipio.replace("{cd}", cd));
  const tamTxt = b => b == null ? "" : b < 1024 * 1024 ? fmt(b / 1024, 0) + " KB" : fmt(b / 1024 / 1024, 1) + " MB";

  function montaDownloads() {
    const munOpts = (window.GEO && GEO.municipios || []).map(([cd, nm]) => `<option value="${cd}">${esc(nm)}</option>`).join("");
    $("lista-downloads").innerHTML = CONFIG.downloads.map((g, gi) => `
      <section class="grupo-dl" style="--cor-tema:${g.cor}" data-grupo="${gi}">
        <h3><span class="tema-ico"><svg viewBox="0 0 24 24">${ICONES[g.tema] || ""}</svg></span>${esc(g.tema)}<small>${g.itens.length} ${g.itens.length > 1 ? "arquivos" : "arquivo"}</small></h3>
        <table class="tab-dl">
          <thead><tr><th>Camada</th><th>Formato</th><th>Fonte</th><th>Tamanho</th><th></th></tr></thead>
          <tbody>${g.itens.map((it, ii) => `
            <tr data-busca="${esc((it.nome + " " + it.desc + " " + it.formato + " " + it.fonte + " " + g.tema).toLowerCase())}">
              <td><b>${esc(it.nome)}</b><small>${esc(it.desc || "")}</small></td>
              <td><span class="fmt fmt-${it.formato.toLowerCase()}">${esc(it.formato)}</span></td>
              <td>${esc(it.fonte || "")}</td>
              <td class="tam" data-tam="${gi}-${ii}"></td>
              <td>${it.por_municipio
                ? `<select class="sel-dl" data-dl="${gi}-${ii}" aria-label="Município">${munOpts}</select><a class="btn-dl" data-dl-btn="${gi}-${ii}" href="${esc(linkDe(it, (GEO.municipios[0] || [])[0]))}" download>${SETA}Baixar</a>`
                : `<a class="btn-dl" href="${esc(linkDe(it))}" download>${SETA}Baixar</a>`}</td>
            </tr>`).join("")}</tbody>
        </table>
      </section>`).join("");
    // seletor de município (ruas)
    document.querySelectorAll(".sel-dl").forEach(s => s.onchange = () => {
      const [gi, ii] = s.dataset.dl.split("-").map(Number), it = CONFIG.downloads[gi].itens[ii];
      const a = document.querySelector(`[data-dl-btn="${s.dataset.dl}"]`); a.href = linkDe(it, s.value);
      tamanho(a.href).then(b => (document.querySelector(`[data-tam="${s.dataset.dl}"]`).textContent = tamTxt(b)));
    });
    // tamanhos (HEAD) – sem bloquear a página
    CONFIG.downloads.forEach((g, gi) => g.itens.forEach((it, ii) => {
      const href = linkDe(it, it.por_municipio ? (GEO.municipios[0] || [])[0] : "");
      tamanho(href).then(b => {
        const el = document.querySelector(`[data-tam="${gi}-${ii}"]`);
        if (el) el.textContent = b == null ? "—" : tamTxt(b);
        if (b == null && el) el.title = "Arquivo não encontrado neste endereço";
      });
    }));
  }
  const tamanhos = {};
  function tamanho(href) {
    if (!(href in tamanhos)) tamanhos[href] = fetch(href, { method: "HEAD" })
      .then(r => r.ok ? Number(r.headers.get("content-length")) || null : null).catch(() => null);
    return tamanhos[href];
  }
  $("dl-busca").oninput = e => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".grupo-dl").forEach(sec => {
      let n = 0;
      sec.querySelectorAll("tbody tr").forEach(tr => { const ok = !q || tr.dataset.busca.includes(q); tr.hidden = !ok; n += ok; });
      sec.hidden = n === 0;
    });
  };

  // ---------- Mais informações: contadores ----------
  let contadoresFeitos = false;
  function montaContadores() {
    const r = GEO.resumo || {};
    const nArq = CONFIG.downloads.reduce((s, g) => s + g.itens.length, 0);
    const itens = [
      ["Municípios", r.municipios, 0, "", "#3f8fa8"],
      ["População (2022)", r.pop_total, 0, "habitantes", "#e0883a"],
      ["Área total", r.area_km2, 0, "km²", "#b5b13f"],
      ["Conjuntos de dados", nArq, 0, "para download", "#4fa87e"],
    ];
    $("contadores").innerHTML = itens.map(([n, v, c, u, cor]) =>
      `<div class="contador" style="--c:${cor}"><span>${n}</span><b data-alvo="${v || 0}" data-casas="${c}">0</b><small>${u}</small></div>`).join("");
  }
  function animaContadores() {
    if (contadoresFeitos || !window.GEO || !GEO.resumo) return;
    contadoresFeitos = true;
    const reduz = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.querySelectorAll(".contador b").forEach(el => {
      const alvo = Number(el.dataset.alvo), t0 = performance.now(), dur = reduz ? 0 : 1100;
      const passo = t => {
        const p = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(alvo * e, Number(el.dataset.casas));
        if (p < 1) requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    });
  }

  document.addEventListener("geo-pronto", () => {
    montaDownloads(); montaContadores();
    if (!$("pagina-info").hidden) animaContadores();
  });
})();
