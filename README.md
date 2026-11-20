# Geoportal RMP – Região Metropolitana de Piracicaba

Geoportal web (Leaflet) com dados dos 24 municípios da RMP: Censo 2022 por setor censitário,
uso e cobertura da terra (MapBiomas 1990 e 2025), relevo, hidrografia e sistema viário.

## Estrutura

```
index.html                 página do geoportal (abas Camadas · Download · Monte seu mapa · Mais informações)
css/style.css
js/config.js               endereços dos dados, lista de downloads, variáveis e estilos
js/app.js                  mapa e camadas
js/interface.js            abas, página de Download e contadores de "Mais informações"
js/monte-mapa.js           "Monte seu mapa": composição e exportação em JPG
dados/                     dados publicados (WGS84 / EPSG:4326)
  municipios_rmp.geojson · setores_rmp.geojson · rmp_wgs84.gpkg · resumo.json
  uso_terra/               MapBiomas Col. 11 – GeoTIFF 1990/2025, legenda e estatísticas
  relevo/                  MDE 30 m (GeoTIFF) e curvas de nível 50 m
  hidrografia/             cursos d'água e represas/lagos
  vias/                    rodovias (toda a RMP) e ruas_<código IBGE>.geojson por município
  web/                     imagens EPSG:3857 usadas só pelo mapa (uso, hipsometria, altitude)
scripts/                   scripts que geram a pasta dados/
dados_brutos/              downloads originais (fora do Git)
iniciar_geoportal.bat      abre o geoportal localmente
```

## Camadas e fontes

| Camada | Fonte | Observações |
|---|---|---|
| Municípios e setores | IBGE – Censo 2022, Malha Municipal 2024, Composição das RMs 2025 | população, domicílios ocupados, média de moradores, densidade |
| Uso e cobertura da terra | MapBiomas Brasil Coleção 11 (30 m), 1990 e 2025 | legenda oficial da Col. 11; estatística em km² por município e por grupo (nível 1) |
| Relevo | Copernicus DEM GLO-30 (ESA, AWS Open Data) | hipsometria com sombreamento, curvas a cada 50 m, altitude por clique |
| Hidrografia | OpenStreetMap | rios, córregos, canais e represas/lagos |
| Vias | OpenStreetMap | rodovias, avenidas, ruas, estradas vicinais e rurais |

Licenças: MapBiomas (CC-BY 4.0), Copernicus DEM (licença ESA, uso livre com atribuição), OpenStreetMap (ODbL – atribuição "© colaboradores do OpenStreetMap").

## Usar localmente

Duplo clique em `iniciar_geoportal.bat` (abre http://localhost:8000).

## Gerar / atualizar os dados

Todos os scripts rodam com o Python do QGIS:

```
set PY="C:\Program Files\QGIS 3.44.15\bin\python-qgis-ltr.bat"
%PY% scripts\preparar_dados.py      # municípios e setores (IBGE)
%PY% scripts\preparar_relevo.py     # MDE, curvas e imagens de relevo
%PY% scripts\preparar_osm.py        # hidrografia e vias (Overpass API, ~30-40 min)
%PY% scripts\preparar_mapbiomas.py  # uso e cobertura da terra (precisa dos GeoTIFF do GEE)
%PY% scripts\preparar_transicoes.py # mapa e matriz de transições 1990 → 2025
```

### Economia e Infraestrutura

```
%PY% scripts\preparar_economia.py      # PIB, VAB, CEMPRE e população estimada (API do IBGE, ~1 min)
%PY% scripts\preparar_equipamentos.py  # equipamentos urbanos: INEP (escolas) + CNES (saúde) + OpenStreetMap (~5-10 min)
```

| Dado | Fonte | Observações |
|---|---|---|
| PIB e PIB per capita | IBGE – PIB dos Municípios (tabela 5938) | ano mais recente; per capita calculado com a população do Censo 2022 |
| Valor adicionado por setor | IBGE – PIB dos Municípios | o script usa o último ano em que o detalhamento por setor já foi publicado |
| Empresas, pessoal ocupado, salário médio | IBGE – CEMPRE (tabela 9509) | emprego formal |
| População estimada | IBGE – Estimativas (tabela 6579) | |
| Saúde (hospitais, UBS, UPA/pronto-socorro, CAPS, clínicas) | CNES – API de dados abertos do Ministério da Saúde | só estabelecimentos ativos com coordenadas |
| Escolas e creches | INEP – Catálogo de Escolas 2023 (arquivo do IPEA/geobr) | só escolas em funcionamento com coordenadas; "creche / educação infantil" = escolas só de educação infantil |
| Universidades, praças, esporte, cultura, segurança, administração, assistência social, terminais | OpenStreetMap | colaborativo, pode estar incompleto; universidades agrupadas por campus (pontos a < 250 m) |

Os anos usados são detectados automaticamente (último período publicado) e aparecem nos nomes dos indicadores.

### Temperatura de superfície 2025 – área urbana

`%PY% scripts\preparar_lst_2025.py` (~5 min; cenas em cache em `dados_brutos/lst2025`).
Mesmo método do estudo de Piracicaba 2015–2025 (`Artigo - Mudanças Climáticas Piracicaba\Dados\scripts\ts_0*.py`),
aplicado aos 24 municípios e só a 2025:

| Item | Valor |
|---|---|
| Fonte | Landsat 8/9 C2 L2, ST_B10, Planetary Computer, Tier 1, órbita 220 (pontos 075 e 076) |
| Período | estação seca, abril–setembro de 2025 (23 datas) |
| Máscaras | QA_PIXEL bits 0–5; incerteza ST_QA > 3 K; água recorrente (bit 7 em ≥ 50% das obs.) |
| Composto | mediana por pixel, mínimo de 3 observações limpas |
| Área urbana | setores urbanos do Censo 2022 (pixel pelo centro) |
| ΔTS | TS do pixel − mediana urbana do próprio município |
| Classes (°C) | < −2; −2 a −1; −1 a 1; 1 a 2; 2 a 4; > 4 |

A órbita 219 (borda leste) foi descartada para que todos os municípios usem as mesmas datas.
Comparações de TS absoluta entre municípios devem considerar que cada um tem um conjunto diferente de datas
sem nuvem (ver `obs_validas_mediana` em `ts2025_municipios.csv`); o ΔTS (relativo a cada município) é mais robusto.

### Transições 1990 → 2025

`preparar_transicoes.py` compara os dois anos pixel a pixel e agrupa as mudanças em categorias
(vegetação nativa → agropecuária, agropecuária → urbano, regeneração, troca de uso na agropecuária, ganho/perda
de água etc.). Gera o GeoTIFF `uso_terra/transicao_1990_2025.tif`, a área por categoria e município
(`transicoes_categorias.csv`) e a matriz completa classe → classe por município (`transicoes_matriz.csv`).
Observação: a comparação entre dois anos isolados inclui rotação de culturas e incerteza do mapeamento,
sobretudo entre "Mosaico de usos", "Pastagem" e "Cana".

### MapBiomas (Google Earth Engine)

A Coleção 11 do MapBiomas só é distribuída pelo Google Earth Engine. Há duas formas de obter os arquivos:

1. **Code Editor:** abra https://code.earthengine.google.com, cole `scripts/mapbiomas_gee_exportar.js`,
   clique em *Run* e depois em *RUN* nas duas tarefas da aba *Tasks*. Baixe `mapbiomas_rmp_1990.tif` e
   `mapbiomas_rmp_2025.tif` do seu Google Drive (pasta `geoportal_rmp`) para `dados_brutos/mapbiomas/`.
2. **Python:** autentique-se uma vez (`%PY% -c "import ee; ee.Authenticate()"`) e rode
   `%PY% scripts\mapbiomas_gee_baixar.py SEU_PROJETO_GCP`.

Depois rode `scripts\preparar_mapbiomas.py`.

## Publicar no GitHub Pages

Publicado em **https://jdgobboalves.github.io/geoportal-rmp/** (repositório `jdgobboalves/geoportal-rmp`,
branch `main`, pasta raiz). O `.gitignore` deixa `dados_brutos/` de fora; o `.nojekyll` faz o Pages servir
arquivos que começam com `_`.

Para atualizar o site depois de mudar arquivos (o Pages republica em 1–2 minutos):

```
git add -A
git commit -m "descrição da mudança"
git push
```

Ao mudar arquivos JS/CSS, aumente o `?v=N` em `index.html` para os navegadores não usarem a versão antiga.

Se os dados ficarem em outro repositório, troque `BASE_DADOS` em `js/config.js`.

### Links de download

A aba **Download** é montada a partir de `CONFIG.downloads` em `js/config.js` (agrupada pelos quatro temas).
Cada item tem `arquivo` (relativo a `BASE_DOWNLOAD`) e um campo `url`: quando os arquivos forem para a nuvem
(GitHub Releases, Zenodo, Google Drive etc.), preencha `url` com o link direto – ele tem prioridade. O tamanho
mostrado na tabela é lido do servidor (requisição HEAD); se aparecer "—", o arquivo não foi encontrado no endereço.

### Mais informações

Os textos entre colchetes em `index.html` (seção `pagina-info`) são espaços reservados para apresentação, autoria,
como citar e contato.
