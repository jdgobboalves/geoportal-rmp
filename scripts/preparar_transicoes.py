"""
Transições de uso e cobertura da terra 1990 -> 2025 (MapBiomas Col. 11) na RMP.

Entrada:  dados/uso_terra/mapbiomas_rmp_1990.tif e _2025.tif (gerados por preparar_mapbiomas.py)
Saídas:
  dados/uso_terra/transicao_1990_2025.tif     categorias de transição (WGS84, com tabela de cores)
  dados/uso_terra/transicoes_categorias.csv    área (km²) por município e categoria
  dados/uso_terra/transicoes_matriz.csv        matriz classe->classe (km²) por município
  dados/uso_terra/transicoes.json              idem, usado pelo geoportal
  dados/web/transicao.png / transicao_mudancas.png   imagens EPSG:3857 (todas / só mudanças)
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from osgeo import gdal, ogr
from PIL import Image

gdal.UseExceptions()
RAIZ = Path(__file__).resolve().parent.parent
UT = RAIZ / "dados" / "uso_terra"
WEB = RAIZ / "dados" / "web"
MUN = RAIZ / "dados" / "municipios_rmp.geojson"

leg = pd.read_csv(UT / "legenda_mapbiomas_c11.csv")
grupo = {int(r.class_id): r.grupo for r in leg.itertuples()}
nome = {int(r.class_id): r.class_name_pt_br for r in leg.itertuples()}
NATIVA = {"Floresta", "Formação natural não florestal"}

# Categorias de transição (código: nome, cor)
CAT = {
    1:  ("Vegetação nativa mantida",             "#b7d9c0"),
    2:  ("Agropecuária mantida (mesma classe)",  "#f3ecd2"),
    3:  ("Área urbana / não vegetada mantida",   "#d9b3b0"),
    4:  ("Água mantida",                          "#b9c3f0"),
    5:  ("Vegetação nativa → agropecuária",       "#e6550d"),
    6:  ("Vegetação nativa → urbano / não veg.",  "#7f0000"),
    7:  ("Agropecuária → urbano / não vegetado",  "#d7301f"),
    8:  ("Regeneração de vegetação nativa",       "#1a9641"),
    9:  ("Troca de uso na agropecuária",          "#fdae61"),
    10: ("Ganho de água",                          "#2171b5"),
    11: ("Perda de água",                          "#9ecae1"),
    12: ("Outras transições",                      "#969696"),
}
ESTAVEIS = {1, 2, 3, 4}

def categoria(a, b):
    ga, gb = grupo.get(a), grupo.get(b)
    if a == b:
        return {"Floresta": 1, "Formação natural não florestal": 1, "Agropecuária": 2,
                "Área não vegetada": 3, "Corpo d'água": 4}.get(ga, 12)
    if ga in NATIVA and gb in NATIVA: return 1          # troca entre classes nativas
    if ga in NATIVA and gb == "Agropecuária": return 5
    if ga in NATIVA and gb == "Área não vegetada": return 6
    if ga == "Agropecuária" and gb == "Área não vegetada": return 7
    if gb in NATIVA and ga in ("Agropecuária", "Área não vegetada"): return 8
    if ga == "Agropecuária" and gb == "Agropecuária": return 9
    if ga == "Área não vegetada" and gb == "Área não vegetada": return 3
    if gb == "Corpo d'água" and ga != "Corpo d'água": return 10
    if ga == "Corpo d'água" and gb != "Corpo d'água": return 11
    return 12

d90 = gdal.Open(str(UT / "mapbiomas_rmp_1990.tif"))
d25 = gdal.Open(str(UT / "mapbiomas_rmp_2025.tif"))
assert d90.GetGeoTransform() == d25.GetGeoTransform(), "grades de 1990 e 2025 diferentes"
a = d90.GetRasterBand(1).ReadAsArray().astype("int32")
b = d25.GetRasterBand(1).ReadAsArray().astype("int32")
gt = d90.GetGeoTransform()

# Tabela de consulta par (classe1990, classe2025) -> categoria
lut = np.zeros((256, 256), dtype="uint8")
for c1 in range(1, 256):
    for c2 in range(1, 256):
        if c1 in grupo and c2 in grupo:
            lut[c1, c2] = categoria(c1, c2)
valido = (a > 0) & (b > 0)
cat = np.where(valido, lut[a, b], 0).astype("uint8")

# GeoTIFF de saída
tif = str(UT / "transicao_1990_2025.tif")
out = gdal.GetDriverByName("GTiff").Create(tif, d90.RasterXSize, d90.RasterYSize, 1, gdal.GDT_Byte,
                                           options=["COMPRESS=DEFLATE", "TILED=YES"])
out.SetGeoTransform(gt); out.SetProjection(d90.GetProjection())
bd = out.GetRasterBand(1)
ct = gdal.ColorTable(); ct.SetColorEntry(0, (0, 0, 0, 0))
for k, (_, h) in CAT.items():
    ct.SetColorEntry(k, tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
bd.SetRasterColorTable(ct); bd.SetRasterColorInterpretation(gdal.GCI_PaletteIndex)
bd.SetNoDataValue(0); bd.SetDescription("Transição MapBiomas 1990-2025")
bd.WriteArray(cat)
out = None

# Área por pixel (km²) e índice dos municípios
R = 6371007.2
lats = gt[3] + gt[5] * (np.arange(d90.RasterYSize) + 0.5)
area_px = (np.radians(abs(gt[1])) * R) * (np.radians(abs(gt[5])) * R) * np.cos(np.radians(lats)) / 1e6
area = np.broadcast_to(area_px[:, None], a.shape)
mem = gdal.GetDriverByName("MEM").Create("", d90.RasterXSize, d90.RasterYSize, 1, gdal.GDT_UInt32)
mem.SetGeoTransform(gt); mem.SetProjection(d90.GetProjection())
vds = ogr.Open(str(MUN)); lyr = vds.GetLayer()
tmp = ogr.GetDriverByName("MEM").CreateDataSource("t")
tl = tmp.CreateLayer("m", lyr.GetSpatialRef(), ogr.wkbMultiPolygon)
tl.CreateField(ogr.FieldDefn("idx", ogr.OFTInteger))
codigos = {}
for i, f in enumerate(lyr, 1):
    codigos[i] = (f.GetField("CD_MUN"), f.GetField("NM_MUN"))
    nf = ogr.Feature(tl.GetLayerDefn()); nf.SetField("idx", i); nf.SetGeometry(f.GetGeometryRef().Clone()); tl.CreateFeature(nf)
gdal.RasterizeLayer(mem, [1], tl, options=["ATTRIBUTE=idx"])
idx = mem.GetRasterBand(1).ReadAsArray()

sel = valido & (idx > 0)
df = pd.DataFrame({"m": idx[sel], "de": a[sel], "para": b[sel], "cat": cat[sel], "km2": area[sel]})
df["CD_MUN"] = df["m"].map(lambda i: codigos[i][0]); df["NM_MUN"] = df["m"].map(lambda i: codigos[i][1])

# CSVs
cats = df.groupby(["CD_MUN", "NM_MUN", "cat"])["km2"].sum().reset_index()
cats["categoria"] = cats["cat"].map(lambda k: CAT[k][0])
cats.round({"km2": 4}).to_csv(UT / "transicoes_categorias.csv", index=False, encoding="utf-8-sig")
mat = df.groupby(["CD_MUN", "NM_MUN", "de", "para"])["km2"].sum().reset_index()
mat["classe_1990"] = mat["de"].map(nome); mat["classe_2025"] = mat["para"].map(nome)
mat.round({"km2": 4}).to_csv(UT / "transicoes_matriz.csv", index=False, encoding="utf-8-sig")

# JSON para o geoportal: área por categoria + 8 maiores mudanças classe->classe
saida = {"categorias": {str(k): {"nome": n, "cor": c, "estavel": k in ESTAVEIS} for k, (n, c) in CAT.items()},
         "dados": {}}
for chave, g in [("RMP", df)] + list(df.groupby("CD_MUN")):
    pc = g.groupby("cat")["km2"].sum()
    mud = g[g["de"] != g["para"]].groupby(["de", "para"])["km2"].sum().sort_values(ascending=False).head(8)
    saida["dados"][chave] = {
        "categorias": {str(int(k)): round(float(v), 3) for k, v in pc.items()},
        "principais": [[nome.get(int(d), str(d)), nome.get(int(p), str(p)), round(float(v), 2)] for (d, p), v in mud.items()],
        "mudou_km2": round(float(g.loc[g["de"] != g["para"], "km2"].sum()), 2),
        "total_km2": round(float(g["km2"].sum()), 2),
    }
(UT / "transicoes.json").write_text(json.dumps(saida, ensure_ascii=False), encoding="utf-8")

# Imagens web (EPSG:3857, paleta sem perdas)
def merc2ll(x, y):
    return float(np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)), float(x / 6378137.0 * 180 / np.pi)
w = gdal.Warp("", tif, format="MEM", dstSRS="EPSG:3857", xRes=30, yRes=30, resampleAlg="near", dstNodata=0)
arr = w.GetRasterBand(1).ReadAsArray().astype("uint8")
pal = [0] * 768
for k, (_, h) in CAT.items():
    pal[k * 3:k * 3 + 3] = [int(h[i:i + 2], 16) for i in (1, 3, 5)]
for nomearq, dados in (("transicao.png", arr), ("transicao_mudancas.png", np.where(np.isin(arr, list(ESTAVEIS)), 0, arr))):
    im = Image.fromarray(dados.astype("uint8"), "P"); im.putpalette(pal)
    im.save(WEB / nomearq, optimize=True, transparency=0)
g3 = w.GetGeoTransform()
x0, y0 = g3[0], g3[3]; x1 = x0 + g3[1] * w.RasterXSize; y1 = y0 + g3[5] * w.RasterYSize
meta_p = WEB / "rasters.json"
meta = json.loads(meta_p.read_text(encoding="utf-8"))
meta["transicao"] = {"bounds": [merc2ll(x0, y1), merc2ll(x1, y0)], "largura": w.RasterXSize, "altura": w.RasterYSize}
meta_p.write_text(json.dumps(meta, indent=2), encoding="utf-8")

r = saida["dados"]["RMP"]
print(f"RMP: {r['mudou_km2']} de {r['total_km2']} km² mudaram de classe")
for k, v in sorted(r["categorias"].items(), key=lambda x: -x[1]):
    print(f"  {CAT[int(k)][0]:40s} {v:9.1f} km²")
print("Maiores mudanças:", *[f"  {d} → {p}: {v} km²" for d, p, v in r["principais"]], sep="\n")
