// Configuração do Geoportal RMP.
// Para publicar com os dados no GitHub, basta trocar BASE_DADOS por uma URL
// (ex.: "https://raw.githubusercontent.com/<usuario>/<repo>/main/dados/")
// ou manter "dados/" se o site e os dados ficarem no mesmo repositório (GitHub Pages).
const CONFIG = {
  BASE_DADOS: "dados/",
  arquivos: {
    municipios: "municipios_rmp.geojson",
    setores: "setores_rmp.geojson",
    resumo: "resumo.json",
    rasters: "web/rasters.json",
    uso_stats: "uso_terra/estatisticas.json",
    uso_png: "web/uso_{ano}.png",
    trans_stats: "uso_terra/transicoes.json",
    trans_png: "web/transicao.png",
    trans_mud_png: "web/transicao_mudancas.png",
    relevo_png: "web/relevo_hipso.webp",
    altitude_png: "web/relevo_altitude.png",
    curvas: "relevo/curvas_50m.geojson",
    rios: "hidrografia/cursos_dagua.geojson",
    massas: "hidrografia/massas_dagua.geojson",
    rodovias: "vias/rodovias.geojson",
    ruas: "vias/ruas_{cd}.geojson",
    resumo_vias: "vias/resumo_vias.json",
    ts_stats: "temperatura/ts2025.json",
    ts_setores: "temperatura/ts2025_setores.json",
    ts_png: "web/ts2025_classe.png",
    ts_valor_png: "web/ts2025_valor.png",
    economia: "economia/economia.json",
    equipamentos: "infraestrutura/equipamentos.geojson",
    equip_stats: "infraestrutura/equipamentos.json",
  },
  // Indicadores econômicos municipais: cores (5 classes por quantis entre os 24 municípios)
  cores_economia: ["#fbf7d5", "#e6dc8a", "#c4b93f", "#8e8a1f", "#55520b"],
  // Equipamentos urbanos: grupo, cor e se começa ligado
  equipamentos: {
    "Escola":                            { grupo: "Educação", cor: "#2563eb", on: true },
    "Creche / educação infantil":        { grupo: "Educação", cor: "#60a5fa", on: true },
    "Universidade / faculdade":          { grupo: "Educação", cor: "#1e3a8a", on: true },
    "Hospital":                          { grupo: "Saúde", cor: "#dc2626", on: true },
    "UBS / posto de saúde":              { grupo: "Saúde", cor: "#f97373", on: true },
    "Pronto atendimento / UPA":          { grupo: "Saúde", cor: "#991b1b", on: true },
    "CAPS":                              { grupo: "Saúde", cor: "#fb923c", on: true },
    "Clínica / centro de especialidades":{ grupo: "Saúde", cor: "#fdba74", on: false },
    "Praça / parque":                    { grupo: "Lazer e cultura", cor: "#16a34a", on: true },
    "Esporte":                           { grupo: "Lazer e cultura", cor: "#84cc16", on: true },
    "Cultura":                           { grupo: "Lazer e cultura", cor: "#9333ea", on: true },
    "Segurança pública":                 { grupo: "Serviços públicos", cor: "#374151", on: true },
    "Administração pública":             { grupo: "Serviços públicos", cor: "#a16207", on: true },
    "Assistência social":                { grupo: "Serviços públicos", cor: "#db2777", on: true },
    "Terminal de ônibus":                { grupo: "Serviços públicos", cor: "#0891b2", on: true },
  },
  // ---------- Downloads (aba "Download") ----------
  // BASE_DOWNLOAD: pasta/URL de onde saem os arquivos para baixar (padrão = mesma pasta dos dados).
  // Quando os dados forem para a nuvem, troque BASE_DOWNLOAD ou preencha "url" em cada item (tem prioridade).
  // "por_municipio": arquivo com {cd} = código IBGE; a página mostra um seletor de município.
  BASE_DOWNLOAD: "dados/",
  downloads: [
    { tema: "Limites Territoriais", cor: "#3f8fa8", itens: [
      { nome: "Municípios da RMP", desc: "24 limites municipais com população, domicílios, área e densidade", formato: "GeoJSON", arquivo: "municipios_rmp.geojson", fonte: "IBGE 2024 / Censo 2022", url: "" },
      { nome: "Municípios + setores censitários", desc: "As duas camadas num único arquivo", formato: "GeoPackage", arquivo: "rmp_wgs84.gpkg", fonte: "IBGE", url: "" },
    ]},
    { tema: "Demografia", cor: "#e0883a", itens: [
      { nome: "Setores censitários – Censo 2022", desc: "População, domicílios ocupados, média de moradores e densidade por setor", formato: "GeoJSON", arquivo: "setores_rmp.geojson", fonte: "IBGE – Censo 2022", url: "" },
    ]},
    { tema: "Economia e Infraestrutura", cor: "#b5b13f", itens: [
      { nome: "Indicadores econômicos por município", desc: "PIB, PIB per capita, VAB por setor, empresas, pessoal ocupado, salário médio, população estimada", formato: "CSV", arquivo: "economia/economia_municipios.csv", fonte: "IBGE – PIB dos Municípios, CEMPRE", url: "" },
      { nome: "Equipamentos urbanos", desc: "Escolas, universidades, saúde, praças, cultura, esporte, segurança e serviços públicos (pontos)", formato: "GeoJSON", arquivo: "infraestrutura/equipamentos.geojson", fonte: "INEP, CNES e OpenStreetMap", url: "" },
      { nome: "Equipamentos urbanos por município", desc: "Contagem por categoria", formato: "CSV", arquivo: "infraestrutura/equipamentos_municipios.csv", fonte: "INEP, CNES e OpenStreetMap", url: "" },
      { nome: "Rodovias e vias principais", desc: "Toda a RMP: rodovias, vias arteriais e coletoras", formato: "GeoJSON", arquivo: "vias/rodovias.geojson", fonte: "OpenStreetMap", url: "" },
      { nome: "Ruas, avenidas e estradas (por município)", desc: "Todo o sistema viário de um município", formato: "GeoJSON", por_municipio: "vias/ruas_{cd}.geojson", fonte: "OpenStreetMap", url: "" },
      { nome: "Extensão de vias por município", desc: "km por classe de via", formato: "JSON", arquivo: "vias/resumo_vias.json", fonte: "OpenStreetMap", url: "" },
    ]},
    { tema: "Meio Ambiente", cor: "#4fa87e", itens: [
      { nome: "Uso e cobertura da terra 1990", desc: "MapBiomas Coleção 11, 30 m, legenda oficial", formato: "GeoTIFF", arquivo: "uso_terra/mapbiomas_rmp_1990.tif", fonte: "MapBiomas", url: "" },
      { nome: "Uso e cobertura da terra 2025", desc: "MapBiomas Coleção 11, 30 m, legenda oficial", formato: "GeoTIFF", arquivo: "uso_terra/mapbiomas_rmp_2025.tif", fonte: "MapBiomas", url: "" },
      { nome: "Legenda MapBiomas Coleção 11", desc: "Código, nome e cor das classes", formato: "CSV", arquivo: "uso_terra/legenda_mapbiomas_c11.csv", fonte: "MapBiomas", url: "" },
      { nome: "Área de uso da terra por município", desc: "km² por classe, 1990 e 2025", formato: "CSV", arquivo: "uso_terra/estatisticas_uso_terra.csv", fonte: "MapBiomas", url: "" },
      { nome: "Mapa de transições 1990 → 2025", desc: "12 categorias de mudança", formato: "GeoTIFF", arquivo: "uso_terra/transicao_1990_2025.tif", fonte: "MapBiomas", url: "" },
      { nome: "Transições por categoria e município", desc: "km² por categoria de mudança", formato: "CSV", arquivo: "uso_terra/transicoes_categorias.csv", fonte: "MapBiomas", url: "" },
      { nome: "Matriz de transição classe → classe", desc: "Por município e RMP", formato: "CSV", arquivo: "uso_terra/transicoes_matriz.csv", fonte: "MapBiomas", url: "" },
      { nome: "Temperatura de superfície 2025 – área urbana", desc: "°C, mediana da estação seca, 30 m", formato: "GeoTIFF", arquivo: "temperatura/ts_seca_2025_urbano_wgs84.tif", fonte: "Landsat 8/9", url: "" },
      { nome: "ΔTS 2025 – área urbana", desc: "°C em relação à mediana urbana do município", formato: "GeoTIFF", arquivo: "temperatura/dts_seca_2025_urbano_wgs84.tif", fonte: "Landsat 8/9", url: "" },
      { nome: "Classes de ΔTS 2025", desc: "6 classes (< −2 … > 4 °C)", formato: "GeoTIFF", arquivo: "temperatura/classe_dts_seca_2025_wgs84.tif", fonte: "Landsat 8/9", url: "" },
      { nome: "Temperatura de superfície por município", desc: "Ranking, mediana, p10/p90 e % por classe", formato: "CSV", arquivo: "temperatura/ts2025_municipios.csv", fonte: "Landsat 8/9", url: "" },
      { nome: "Temperatura de superfície por setor urbano", desc: "TS e ΔTS médios por setor censitário", formato: "CSV", arquivo: "temperatura/ts2025_setores_urbanos.csv", fonte: "Landsat 8/9", url: "" },
      { nome: "Modelo digital de elevação 30 m", desc: "Altitude em metros", formato: "GeoTIFF", arquivo: "relevo/mde_rmp_wgs84.tif", fonte: "Copernicus GLO-30", url: "" },
      { nome: "Curvas de nível (50 m)", desc: "Equidistância de 50 m", formato: "GeoJSON", arquivo: "relevo/curvas_50m.geojson", fonte: "Copernicus GLO-30", url: "" },
      { nome: "Cursos d'água", desc: "Rios, córregos e canais", formato: "GeoJSON", arquivo: "hidrografia/cursos_dagua.geojson", fonte: "OpenStreetMap", url: "" },
      { nome: "Represas e lagos", desc: "Polígonos com área em hectares", formato: "GeoJSON", arquivo: "hidrografia/massas_dagua.geojson", fonte: "OpenStreetMap", url: "" },
    ]},
  ],
  // Variáveis dos setores censitários disponíveis no seletor
  variaveis: {
    pop_total:   { nome: "População total", unidade: "hab.", casas: 0,
                   desc: "Total de pessoas residentes (V0001).", cores: ["#fff5eb","#fdd0a2","#fd8d3c","#d94801","#7f2704"] },
    dens_demog:  { nome: "Densidade demográfica", unidade: "hab./km²", casas: 1,
                   desc: "População total dividida pela área do setor.", cores: ["#f7fcf5","#c7e9c0","#74c476","#238b45","#00441b"] },
    dom_ocup:    { nome: "Domicílios particulares ocupados", unidade: "dom.", casas: 0,
                   desc: "Total de domicílios particulares ocupados (V0007).", cores: ["#f7fbff","#c6dbef","#6baed6","#2171b5","#08306b"] },
    media_morad: { nome: "Média de moradores por domicílio", unidade: "mor./dom.", casas: 2,
                   desc: "Média de moradores em domicílios particulares ocupados (V0005).", cores: ["#fcfbfd","#dadaeb","#9e9ac8","#6a51a3","#3f007d"] },
  },
  // Temperatura de superfície 2025 por setor urbano (tema Meio Ambiente; juntada pelo CD_SETOR de temperatura/ts2025_setores.json)
  ts_setores: {
    dts_2025: { nome: "ΔTS 2025 – diferença térmica intraurbana", unidade: "°C", casas: 2,
                desc: "Média do setor da TS (estação seca 2025) menos a mediana urbana do município. Classes fixas do estudo de Piracicaba.",
                fixas: [-2, -1, 1, 2, 4], cores: ["#1c5cab","#86b6ef","#f0efec","#f19a90","#e34948","#7d1a1c"] },
    ts_2025:  { nome: "Temperatura de superfície 2025", unidade: "°C", casas: 1,
                desc: "Média do setor da TS mediana da estação seca (abr–set) de 2025, Landsat 8/9. Classes por quantis.",
                cores: ["#fdf1df","#f9c98f","#ef8d4a","#c9541f","#7a2e0b"] },
  },
  // Estilo das vias por classe
  vias: {
    "Rodovia principal":       { cor: "#c0392b", peso: 3.2 },
    "Rodovia / via arterial":  { cor: "#e67e22", peso: 2.6 },
    "Via arterial / avenida":  { cor: "#f1c40f", peso: 2.0 },
    "Via coletora / avenida":  { cor: "#7f8c8d", peso: 1.6 },
    "Rua":                     { cor: "#95a5a6", peso: 1.0 },
    "Estrada vicinal":         { cor: "#a1887f", peso: 1.2 },
    "Estrada rural (terra)":   { cor: "#bcaaa4", peso: 0.9, tracejado: "4 3" },
  },
  zoom_ruas: 13,
  // Capa: municípios coloridos – uma cor única por município (precisa de pelo menos 24 cores)
  // e fundo OpenStreetMap. As cores são distribuídas para que vizinhos fiquem o mais diferentes possível.
  cores_municipios: ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4",
                     "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990", "#dcbeff",
                     "#9a6324", "#fffac8", "#800000", "#aaffc3", "#808000", "#ffd8b1",
                     "#1f3f99", "#a9a9a9", "#ff7f7f", "#7fb3ff", "#c9a0dc", "#2e8b57"],
  transparencia_municipios: 0.30,   // 0 = cor sólida, 1 = invisível
  transparencia_fundo: 0.40,
  fundo_inicial: "OpenStreetMap",
  centro: [-22.6, -47.6],
  zoom: 9,
};
