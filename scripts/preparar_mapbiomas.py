"""
Uso e cobertura da terra – MapBiomas Coleção 11 (1990 e 2025) recortado para a RMP.

Entrada:  dados_brutos/mapbiomas/*.tif – qualquer GeoTIFF cujo nome contenha o ano (1990, 2025):
          o arquivo do Brasil inteiro ou o recorte exportado do GEE (mapbiomas_gee_exportar.js)
          dados_brutos/mapbiomas/legend_code_mapbiomas_brazil_collection_11.csv
Saídas:
  dados/uso_terra/mapbiomas_rmp_<ano>.tif   GeoTIFF classificado (WGS84, com tabela de cores)
  dados/uso_terra/legenda_mapbiomas_c11.csv  legenda (código, nome, cor, grupo)
  dados/uso_terra/estatisticas_uso_terra.csv área (km²) por município, ano e classe
  dados/uso_terra/estatisticas.json          idem, usado pelo geoportal
  dados/web/uso_<ano>.png                    imagem colorida (EPSG:3857) p/ o mapa
  dados/web/rasters.json                     limites das imagens (atualizado)
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from osgeo import gdal, ogr, osr
from PIL import Image

gdal.UseExceptions()
RAIZ = Path(__file__).resolve().parent.parent
BRUTOS = RAIZ / "dados_brutos" / "mapbiomas"
OUT = RAIZ / "dados" / "uso_terra"; OUT.mkdir(parents=True, exist_ok=True)
WEB = RAIZ / "dados" / "web"; WEB.mkdir(parents=True, exist_ok=True)
MUN = RAIZ / "dados" / "municipios_rmp.geojson"
LIMITE = RAIZ / "dados" / "relevo" / "_limite_rmp.geojson"  # criado por preparar_relevo.py
ANOS = (1990, 2025)

# Legenda oficial + agrupamento no nível 1
leg = pd.read_csv(BRUTOS / "legend_code_mapbiomas_brazil_collection_11.csv")
GRUPOS = {
    "Floresta": [3, 4, 5, 6, 49],
    "Formação natural não florestal": [7, 11, 12, 29, 32, 50, 77, 84, 13],
    "Agropecuária": [9, 15, 18, 19, 20, 21, 35, 36, 39, 40, 41, 46, 47, 48, 62],
    "Área não vegetada": [22, 23, 24, 25, 30, 75, 91],
    "Corpo d'água": [26, 31, 33],
}
COR_GRUPO = {"Floresta": "#1f8d49", "Formação natural não florestal": "#d6bc74", "Agropecuária": "#ffefc3",
             "Área não vegetada": "#d4271e", "Corpo d'água": "#2532e4"}
grupo_de = {c: g for g, cs in GRUPOS.items() for c in cs}
leg["grupo"] = leg["class_id"].map(grupo_de).fillna("Não observado")
leg.loc[leg["class_id"] == 27, "grupo"] = "Não observado"
leg.to_csv(OUT / "legenda_mapbiomas_c11.csv", index=False, encoding="utf-8-sig")
cores = {int(r.class_id): tuple(int(r.hex_code[i:i + 2], 16) for i in (1, 3, 5)) for r in leg.itertuples()}
nomes = {int(r.class_id): r.class_name_pt_br for r in leg.itertuples()}

meta_p = WEB / "rasters.json"
meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else {}
stats_linhas = []

def merc2ll(x, y):
    return float(np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)), float(x / 6378137.0 * 180 / np.pi)

def tabela_cores():
    ct = gdal.ColorTable()
    ct.SetColorEntry(0, (0, 0, 0, 0))
    for c, rgb in cores.items():
        ct.SetColorEntry(c, rgb + (255,))
    return ct

def localiza(ano):
    """Aceita o recorte da RMP ou o arquivo do Brasil inteiro, com qualquer nome que contenha o ano
    (ex.: brasil_coverage_1990.tif). Também aceita um único GeoTIFF multibanda (1 banda por ano)."""
    tifs = sorted(p for p in BRUTOS.glob("*.tif") if not p.name.startswith("_"))
    for p in tifs:
        if str(ano) in p.stem:
            return p, 1
    for p in tifs:  # multibanda: procura a banda pela descrição ou pela posição (1985 = banda 1)
        d = gdal.Open(str(p))
        if d.RasterCount > 1:
            for i in range(1, d.RasterCount + 1):
                if str(ano) in (d.GetRasterBand(i).GetDescription() or ""):
                    return p, i
            return p, ano - 1984
    raise SystemExit(f"Nenhum GeoTIFF do MapBiomas para {ano} em {BRUTOS}.")

for ano in ANOS:
    entrada, banda = localiza(ano)
    print(f"{ano}: {entrada.name} (banda {banda})")
    fonte = str(entrada)
    if banda != 1:
        fonte = gdal.Translate("", fonte, format="VRT", bandList=[banda])

    # 1) Recorte exato pela RMP (WGS84, resolução nativa; lê só a janela da RMP)
    tif = str(OUT / f"mapbiomas_rmp_{ano}.tif")
    gdal.Warp(tif, fonte, dstSRS="EPSG:4326", cutlineDSName=str(LIMITE), cropToCutline=True,
              dstNodata=0, outputType=gdal.GDT_Byte, resampleAlg="near", multithread=True,
              warpMemoryLimit=512, creationOptions=["COMPRESS=DEFLATE", "TILED=YES"])
    ds = gdal.Open(tif, gdal.GA_Update)
    b = ds.GetRasterBand(1)
    b.SetRasterColorTable(tabela_cores()); b.SetRasterColorInterpretation(gdal.GCI_PaletteIndex)
    b.SetDescription(f"MapBiomas Col.11 – {ano}")
    arr = b.ReadAsArray()
    gt = ds.GetGeoTransform()

    # 2) Estatística por município (área real de cada pixel conforme a latitude)
    mem = gdal.GetDriverByName("MEM").Create("", ds.RasterXSize, ds.RasterYSize, 1, gdal.GDT_UInt32)
    mem.SetGeoTransform(gt); mem.SetProjection(ds.GetProjection())
    vds = ogr.Open(str(MUN)); lyr = vds.GetLayer()
    codigos = {}
    for i, f in enumerate(lyr, 1):
        codigos[i] = (f.GetField("CD_MUN"), f.GetField("NM_MUN"))
    lyr.ResetReading()
    # campo numérico temporário = índice do município
    tmp = ogr.GetDriverByName("MEM").CreateDataSource("t")
    tl = tmp.CreateLayer("m", lyr.GetSpatialRef(), ogr.wkbMultiPolygon)
    tl.CreateField(ogr.FieldDefn("idx", ogr.OFTInteger))
    for i, f in enumerate(lyr, 1):
        nf = ogr.Feature(tl.GetLayerDefn()); nf.SetField("idx", i); nf.SetGeometry(f.GetGeometryRef().Clone()); tl.CreateFeature(nf)
    gdal.RasterizeLayer(mem, [1], tl, options=["ATTRIBUTE=idx"])
    idx = mem.GetRasterBand(1).ReadAsArray()
    lats = gt[3] + gt[5] * (np.arange(ds.RasterYSize) + 0.5)
    R = 6371007.2
    area_px = (np.radians(abs(gt[1])) * R) * (np.radians(abs(gt[5])) * R) * np.cos(np.radians(lats)) / 1e6  # km²
    area = np.broadcast_to(area_px[:, None], arr.shape)
    validos = (idx > 0) & (arr > 0)
    df = pd.DataFrame({"m": idx[validos], "c": arr[validos], "a": area[validos]})
    soma = df.groupby(["m", "c"])["a"].sum().reset_index()
    for r in soma.itertuples():
        cd, nm = codigos[int(r.m)]
        stats_linhas.append({"CD_MUN": cd, "NM_MUN": nm, "ano": ano, "classe": int(r.c),
                             "nome_classe": nomes.get(int(r.c), str(r.c)), "grupo": grupo_de.get(int(r.c), "Não observado"),
                             "area_km2": round(float(r.a), 4)})
    ds = None

    # 3) Versão web: EPSG:3857, PNG com paleta (sem perdas – permite consulta por clique)
    w3857 = gdal.Warp("", tif, format="MEM", dstSRS="EPSG:3857", xRes=30, yRes=30, resampleAlg="near", dstNodata=0)
    a = w3857.GetRasterBand(1).ReadAsArray()
    g3 = w3857.GetGeoTransform()
    pal = [0] * 768
    for c, rgb in cores.items():
        pal[c * 3:c * 3 + 3] = rgb
    im = Image.fromarray(a.astype("uint8"), "P"); im.putpalette(pal)
    im.save(WEB / f"uso_{ano}.png", optimize=True, transparency=0)
    x0, y0 = g3[0], g3[3]; x1 = x0 + g3[1] * w3857.RasterXSize; y1 = y0 + g3[5] * w3857.RasterYSize
    meta[f"uso_{ano}"] = {"bounds": [merc2ll(x0, y1), merc2ll(x1, y0)],
                          "largura": w3857.RasterXSize, "altura": w3857.RasterYSize}
    print(ano, "ok", f"{(WEB / f'uso_{ano}.png').stat().st_size/1e6:.1f} MB")

meta_p.write_text(json.dumps(meta, indent=2), encoding="utf-8")

st = pd.DataFrame(stats_linhas)
st.to_csv(OUT / "estatisticas_uso_terra.csv", index=False, encoding="utf-8-sig")

# JSON para o geoportal: {mun|RMP: {ano: {classe: km2}}}
saida = {"classes": {}, "grupos": COR_GRUPO, "dados": {}}
presentes = sorted(st["classe"].unique())
for c in presentes:
    linha = leg[leg["class_id"] == c].iloc[0]
    saida["classes"][str(c)] = {"nome": linha.class_name_pt_br, "cor": linha.hex_code, "grupo": linha.grupo}
for chave, g in [("RMP", st)] + list(st.groupby("CD_MUN")):
    saida["dados"][chave] = {str(a): {str(int(r.classe)): round(r.area_km2, 3)
                                      for r in ga.groupby("classe")["area_km2"].sum().reset_index().itertuples()}
                             for a, ga in g.groupby("ano")}
(OUT / "estatisticas.json").write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")

tot = st.groupby(["ano", "grupo"])["area_km2"].sum().unstack(0).round(1)
print(tot)
