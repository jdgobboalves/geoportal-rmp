"""
Temperatura de superfície (TS) e diferença térmica intraurbana (ΔTS) – estação seca de 2025 – áreas urbanas da RMP.

Método (o mesmo do estudo de Piracicaba 2015–2025, scripts ts_01..ts_04, adaptado para a RMP e um único ano):
  - Landsat 8 e 9, Coleção 2, Nível 2, banda ST_B10 (USGS), via Microsoft Planetary Computer; Tier 1;
    órbita WRS-2 220, pontos 075 e 076 (cobrem toda a RMP nas mesmas datas; a órbita 219 é descartada).
  - Estação seca = abril a setembro de 2025.
  - TS (°C) = ND × 0,00341802 + 149,0 − 273,15.
  - Máscara por cena: QA_PIXEL bits 0–5 (preenchimento, nuvem dilatada, cirro, nuvem, sombra, neve)
    e incerteza ST_QA > 3 K. Cenas da mesma órbita e data (pontos vizinhos) contam como uma observação.
  - Composto: mediana por pixel, válido com ≥ 3 observações limpas.
  - Área urbana = setores censitários urbanos do Censo 2022 (pixel pelo centro); água recorrente
    (QA_PIXEL bit 7 em ≥ 50% das observações limpas) excluída.
  - ΔTS = TS do pixel − mediana da TS urbana do próprio município.
  - Classes (°C): < −2; −2 a −1; −1 a 1; 1 a 2; 2 a 4; > 4  (as mesmas do estudo de Piracicaba).
  - Grade de 30 m em EPSG:32623 (UTM 23N, padrão Landsat), alinhada às cenas 220/075; resolução térmica nativa = 100 m.

Saídas:
  dados/temperatura/ts_seca_2025_urbano_wgs84.tif      TS (°C)
  dados/temperatura/dts_seca_2025_urbano_wgs84.tif     ΔTS (°C)
  dados/temperatura/classe_dts_seca_2025_wgs84.tif     classes 1–6 (com tabela de cores)
  dados/temperatura/ts2025_municipios.csv / ts2025_setores_urbanos.csv / cenas_landsat_2025.csv
  dados/temperatura/ts2025.json · ts2025_setores.json  (geoportal)
  dados/web/ts2025_classe.png · ts2025_valor.png        (EPSG:3857, mapa e consulta por clique)
"""
from pathlib import Path
import json, sys, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from osgeo import gdal, osr
from PIL import Image

gdal.UseExceptions()
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
for k, v in {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MULTIRANGE": "YES", "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
             "GDAL_HTTP_MAX_RETRY": "5", "GDAL_HTTP_RETRY_DELAY": "3", "VSI_CACHE": "TRUE", "GDAL_CACHEMAX": "512"}.items():
    gdal.SetConfigOption(k, v)

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "dados_brutos" / "lst2025"; (CACHE / "cenas").mkdir(parents=True, exist_ok=True)
OUT = RAIZ / "dados" / "temperatura"; OUT.mkdir(parents=True, exist_ok=True)
WEB = RAIZ / "dados" / "web"
UNC_MAX, MIN_OBS, EPSG, PATHS = 3.0, 3, 32623, [220]
PERIODO = "2025-04-01T00:00:00Z/2025-09-30T23:59:59Z"
BINS = [-np.inf, -2, -1, 1, 2, 4, np.inf]
CLASSES = [("< −2 (muito abaixo)", "#1c5cab"), ("−2 a −1 (abaixo)", "#86b6ef"), ("−1 a 1 (próximo da mediana)", "#f0efec"),
           ("1 a 2 (acima)", "#f19a90"), ("2 a 4 (muito acima)", "#e34948"), ("> 4 (extremo)", "#7d1a1c")]

mun = gpd.read_file(RAIZ / "dados" / "municipios_rmp.geojson")[["CD_MUN", "NM_MUN", "geometry"]].sort_values("CD_MUN").reset_index(drop=True)
mun["IDX"] = np.arange(1, len(mun) + 1)
setores = gpd.read_file(RAIZ / "dados" / "setores_rmp.geojson")
urb = setores[setores["SITUACAO"] == "Urbana"][["CD_SETOR", "CD_MUN", "NM_MUN", "geometry"]].reset_index(drop=True)
urb["SIDX"] = np.arange(1, len(urb) + 1)
urb["MIDX"] = urb["CD_MUN"].map(dict(zip(mun.CD_MUN, mun.IDX)))
print("setores urbanos:", len(urb))

# ---------------- 1) Busca das cenas (STAC)
arq_cenas = CACHE / "cenas_landsat_2025.csv"
if not arq_cenas.exists():
    rmp = unary_union(mun.geometry)
    body = {"collections": ["landsat-c2-l2"], "intersects": mapping(rmp.simplify(0.01)), "datetime": PERIODO,
            "query": {"platform": {"in": ["landsat-8", "landsat-9"]}, "landsat:collection_category": {"eq": "T1"}}, "limit": 500}
    req = urllib.request.Request("https://planetarycomputer.microsoft.com/api/stac/v1/search", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    r = json.load(urllib.request.urlopen(req, timeout=120))
    linhas = []
    for it in r["features"]:
        p, a = it["properties"], it["assets"]
        if "lwir11" not in a:
            continue
        linhas.append({"id": it["id"], "data": p["datetime"][:10], "hora_utc": p["datetime"][11:19], "plataforma": p["platform"],
                       "path": int(p["landsat:wrs_path"]), "row": int(p["landsat:wrs_row"]), "nuvem_cena": p.get("eo:cloud_cover"),
                       "cobertura_rmp": round(shape(it["geometry"]).intersection(rmp).area / rmp.area, 3),
                       "st_b10": a["lwir11"]["href"], "st_qa": a["qa"]["href"], "qa_pixel": a["qa_pixel"]["href"]})
    pd.DataFrame(linhas).sort_values(["data", "path", "row"]).to_csv(arq_cenas, index=False)
cenas = pd.read_csv(arq_cenas)
# Só a órbita 220 (pontos 075 e 076): cobre os 24 municípios nas MESMAS datas. A órbita 219 cobre apenas a
# borda leste em outras datas; misturá-la criaria costuras no ΔTS e tornaria a TS menos comparável entre municípios.
cenas = cenas[cenas.path.isin(PATHS)].reset_index(drop=True)
print("cenas (órbita 220):", len(cenas))

# ---------------- token SAS do Planetary Computer
_tok = {"t": None, "exp": 0}; _lock = threading.Lock()
def vsi(href):
    with _lock:
        if time.time() > _tok["exp"]:
            r = json.load(urllib.request.urlopen("https://planetarycomputer.microsoft.com/api/sas/v1/token/landsat-c2-l2", timeout=60))
            _tok["t"], _tok["exp"] = r["token"], time.time() + 20 * 60
        return "/vsicurl/" + href + "?" + _tok["t"]

# ---------------- 2) Grade 30 m (EPSG:32623) e máscaras urbanas
arq_grade = CACHE / "grade.json"
if not arq_grade.exists():
    ref = cenas[(cenas.path == 220) & (cenas.row == 75)].iloc[0]
    d = gdal.Open(vsi(ref.st_b10))
    assert osr.SpatialReference(d.GetProjection()).GetAuthorityCode(None) == str(EPSG)
    gt0 = d.GetGeoTransform(); d = None
    xmin, ymin, xmax, ymax = urb.to_crs(EPSG).total_bounds
    pad = 300
    x0 = gt0[0] + np.floor((xmin - pad - gt0[0]) / 30) * 30
    y1 = gt0[3] + np.ceil((ymax + pad - gt0[3]) / 30) * 30
    nx = int(np.ceil((xmax + pad - x0) / 30)); ny = int(np.ceil((y1 - (ymin - pad)) / 30))
    json.dump({"GT": [x0, 30.0, 0.0, y1, 0.0, -30.0], "nx": nx, "ny": ny}, open(arq_grade, "w"))
g = json.load(open(arq_grade)); GT, NX, NY = g["GT"], g["nx"], g["ny"]
BOUNDS = (GT[0], GT[3] - NY * 30, GT[0] + NX * 30, GT[3])
SRS = osr.SpatialReference(); SRS.ImportFromEPSG(EPSG)
print("grade:", NX, "x", NY)

def rasteriza(gdf, campo):
    tmp = CACHE / "_tmp.gpkg"; tmp.unlink(missing_ok=True)
    gdf[[campo, "geometry"]].to_crs(EPSG).to_file(tmp, driver="GPKG", layer="v")
    d = gdal.GetDriverByName("MEM").Create("", NX, NY, 1, gdal.GDT_Int32)
    d.SetGeoTransform(GT); d.SetProjection(SRS.ExportToWkt())
    gdal.Rasterize(d, str(tmp), layers=["v"], attribute=campo)
    a = d.GetRasterBand(1).ReadAsArray(); d = None; tmp.unlink(missing_ok=True)
    return a
SIDX = rasteriza(urb, "SIDX")
MIDX = rasteriza(urb, "MIDX")
U = SIDX > 0
iu = np.flatnonzero(U)               # índices dos pixels urbanos na grade
print("pixels urbanos:", iu.size, f"({iu.size * 900 / 1e6:.0f} km²)")

# ---------------- 3) Download recortado (só os pixels urbanos ficam em cache)
MASK_BITS = sum(1 << b for b in range(6))
def ler(href, rtype):
    for t in range(4):
        try:
            ds = gdal.Warp("", vsi(href), format="MEM", outputBounds=BOUNDS, xRes=30, yRes=30, dstSRS=f"EPSG:{EPSG}",
                           resampleAlg="near", outputType=rtype, dstNodata=0)
            return ds.GetRasterBand(1).ReadAsArray().ravel()[iu]
        except Exception:
            if t == 3:
                raise
            time.sleep(5 * (t + 1)); _tok["exp"] = 0

def baixa(c):
    out = CACHE / "cenas" / f"{c.id}.npz"
    if out.exists():
        return c.id, "já"
    st = ler(c.st_b10, gdal.GDT_UInt16).astype(np.float32)
    qa = ler(c.qa_pixel, gdal.GDT_UInt16)
    sq = ler(c.st_qa, gdal.GDT_Int16).astype(np.float32)
    ok = (st > 0) & ((qa & MASK_BITS) == 0)
    lst = np.where(ok, np.round((st * 0.00341802 + 149.0 - 273.15) * 100), -32768).astype(np.int16)
    unc = np.where(sq > 0, np.minimum(sq * 0.01 * 10, 255), 255).astype(np.uint8)
    agua = (qa & (1 << 7)) > 0
    np.savez_compressed(str(out) + ".tmp.npz", lst=lst, unc=unc, agua=agua)
    Path(str(out) + ".tmp.npz").replace(out)
    return c.id, f"{ok.mean():.2f}"

t0 = time.time()
with ThreadPoolExecutor(6) as ex:
    futs = {ex.submit(baixa, c): c.id for c in cenas.itertuples()}
    for n, f in enumerate(as_completed(futs), 1):
        try:
            cid, s = f.result()
            if n % 10 == 0 or n == len(cenas):
                print(f"{n}/{len(cenas)} {cid} limpo={s} ({time.time() - t0:.0f}s)", flush=True)
        except Exception as e:
            print("ERRO", futs[f], repr(e)[:200], flush=True)
falt = [i for i in cenas.id if not (CACHE / "cenas" / f"{i}.npz").exists()]
assert not falt, f"faltam {len(falt)} cenas – rode de novo"

# ---------------- 4) Observações (órbita + data) e composto mediano
obs, n_limpo, n_agua = [], np.zeros(iu.size, np.int32), np.zeros(iu.size, np.int32)
info = []
for (path, data), grp in cenas.groupby(["path", "data"]):
    lst = np.full(iu.size, np.nan, np.float32); ag = np.zeros(iu.size, bool)
    for c in grp.itertuples():
        z = np.load(CACHE / "cenas" / f"{c.id}.npz")
        v = (z["lst"] != -32768) & (z["unc"] <= UNC_MAX * 10) & np.isnan(lst)
        lst[v] = z["lst"][v] / 100.0; ag[v] = z["agua"][v]
    val = ~np.isnan(lst)
    n_limpo += val; n_agua += val & ag
    obs.append(lst)
    info.append({"path": path, "data": data, "plataforma": grp.plataforma.iloc[0], "cenas": len(grp),
                 "frac_urbano_limpo": round(float(val.mean()), 3),
                 "ts_mediana_urbano": round(float(np.nanmedian(lst)), 2) if val.mean() > 0.05 else None})
pilha = np.stack(obs)
nobs = (~np.isnan(pilha)).sum(0)
with np.errstate(all="ignore"):
    ts = np.nanmedian(pilha, axis=0)
AGUA = (n_limpo >= 3) & (n_agua / np.maximum(n_limpo, 1) >= 0.5)
ts[(nobs < MIN_OBS) | AGUA] = np.nan
print("observações (órbita+data):", len(obs), "| obs. válidas por pixel (mediana):", int(np.median(nobs)),
      "| pixels válidos:", f"{np.isfinite(ts).mean():.1%}", "| água:", int(AGUA.sum()))

# ΔTS por município
midx_u = MIDX.ravel()[iu]; sidx_u = SIDX.ravel()[iu]
med_mun = {m: float(np.nanmedian(ts[midx_u == m])) for m in mun.IDX if np.isfinite(ts[midx_u == m]).any()}
dts = ts - np.array([med_mun.get(m, np.nan) for m in midx_u], np.float32)
classe = np.digitize(dts, BINS[1:-1]) + 1            # 1..6
classe = np.where(np.isfinite(dts), classe, 0).astype(np.uint8)

# ---------------- 5) Rasters (grade UTM -> WGS84)
def grade(vet, dtype, nodata):
    a = np.full(NX * NY, nodata, dtype); a[iu] = np.where(np.isfinite(vet), vet, nodata) if dtype != np.uint8 else vet
    return a.reshape(NY, NX)
def salva(nome, arr, gtype, nodata, desc, cores=None):
    m = gdal.GetDriverByName("MEM").Create("", NX, NY, 1, gtype)
    m.SetGeoTransform(GT); m.SetProjection(SRS.ExportToWkt())
    b = m.GetRasterBand(1); b.WriteArray(arr); b.SetNoDataValue(nodata); b.SetDescription(desc)
    destino = str(OUT / nome)
    w = gdal.Warp(destino, m, dstSRS="EPSG:4326", resampleAlg="near", xRes=0.00026949, yRes=0.00026949,
                  creationOptions=["COMPRESS=DEFLATE", "TILED=YES"] + (["PREDICTOR=3"] if gtype == gdal.GDT_Float32 else []))
    if cores:
        ct = gdal.ColorTable(); ct.SetColorEntry(0, (0, 0, 0, 0))
        for i, (_, h) in enumerate(cores, 1):
            ct.SetColorEntry(i, tuple(int(h[j:j + 2], 16) for j in (1, 3, 5)) + (255,))
        w.GetRasterBand(1).SetRasterColorTable(ct)
    w = None
    return m
salva("ts_seca_2025_urbano_wgs84.tif", grade(ts, np.float32, -9999), gdal.GDT_Float32, -9999, "TS mediana estação seca 2025 (°C)")
salva("dts_seca_2025_urbano_wgs84.tif", grade(dts, np.float32, -9999), gdal.GDT_Float32, -9999, "ΔTS 2025 (°C) – em relação à mediana urbana do município")
mcls = salva("classe_dts_seca_2025_wgs84.tif", grade(classe, np.uint8, 0), gdal.GDT_Byte, 0, "Classe de ΔTS 2025", CLASSES)

# ---------------- 6) Imagens web (EPSG:3857): classes (paleta) e valores codificados p/ consulta
def p3857(arr, gtype, nodata):
    m = gdal.GetDriverByName("MEM").Create("", NX, NY, 1, gtype)
    m.SetGeoTransform(GT); m.SetProjection(SRS.ExportToWkt()); m.GetRasterBand(1).WriteArray(arr); m.GetRasterBand(1).SetNoDataValue(nodata)
    return gdal.Warp("", m, format="MEM", dstSRS="EPSG:3857", xRes=30, yRes=30, resampleAlg="near", dstNodata=nodata,
                     outputBounds=None)
wc = p3857(grade(classe, np.uint8, 0), gdal.GDT_Byte, 0)
ac = wc.GetRasterBand(1).ReadAsArray().astype("uint8")
pal = [0] * 768
for i, (_, h) in enumerate(CLASSES, 1):
    pal[i * 3:i * 3 + 3] = [int(h[j:j + 2], 16) for j in (1, 3, 5)]
im = Image.fromarray(ac, "P"); im.putpalette(pal); im.save(WEB / "ts2025_classe.png", optimize=True, transparency=0)
# valor: R,G = ΔTS×100 + 32768 ; B = índice do município ; A = 255 válido
dcode = np.where(np.isfinite(dts), np.clip(np.round(dts * 100) + 32768, 1, 65535), 0).astype(np.uint16)
wv = p3857(grade(dcode, np.uint16, 0), gdal.GDT_UInt16, 0)
wm = p3857(grade(midx_u.astype(np.uint8), np.uint8, 0), gdal.GDT_Byte, 0)
dv = wv.GetRasterBand(1).ReadAsArray().astype(np.uint32); mv = wm.GetRasterBand(1).ReadAsArray().astype(np.uint8)
assert dv.shape == ac.shape == mv.shape
enc = np.dstack([(dv >> 8) & 255, dv & 255, mv, (dv > 0) * 255]).astype("uint8")
Image.fromarray(enc, "RGBA").save(WEB / "ts2025_valor.png", optimize=True)
g3 = wc.GetGeoTransform()
def merc2ll(x, y):
    return float(np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)), float(x / 6378137.0 * 180 / np.pi)
x0, y0 = g3[0], g3[3]; x1 = x0 + g3[1] * wc.RasterXSize; y1 = y0 + g3[5] * wc.RasterYSize
meta_p = WEB / "rasters.json"; meta = json.loads(meta_p.read_text(encoding="utf-8"))
meta["ts2025"] = {"bounds": [merc2ll(x0, y1), merc2ll(x1, y0)], "largura": wc.RasterXSize, "altura": wc.RasterYSize}
meta_p.write_text(json.dumps(meta, indent=2), encoding="utf-8")

# ---------------- 7) Estatísticas por município e por setor urbano
nm = dict(zip(mun.IDX, mun.NM_MUN)); cd = dict(zip(mun.IDX, mun.CD_MUN))
linhas = []
for m in mun.IDX:
    s = midx_u == m; v = np.isfinite(ts) & s
    if not v.any():
        continue
    cl = classe[v]
    lin = {"CD_MUN": cd[m], "NM_MUN": nm[m], "area_urbana_km2": round(s.sum() * 900 / 1e6, 2),
           "pct_pixels_validos": round(100 * v.sum() / s.sum(), 1), "obs_validas_mediana": int(np.median(nobs[s])),
           "TS_mediana_urbana_C": round(med_mun[m], 2), "TS_p10_C": round(float(np.percentile(ts[v], 10)), 2),
           "TS_p90_C": round(float(np.percentile(ts[v], 90)), 2), "amplitude_p10_p90_C": round(float(np.percentile(ts[v], 90) - np.percentile(ts[v], 10)), 2)}
    for i, (nome, _) in enumerate(CLASSES, 1):
        lin[f"pct_{nome}"] = round(100 * float((cl == i).mean()), 1)
    linhas.append(lin)
dm = pd.DataFrame(linhas).sort_values("TS_mediana_urbana_C", ascending=False)
dm.insert(2, "ranking_TS_RMP", np.arange(1, len(dm) + 1))
dm.to_csv(OUT / "ts2025_municipios.csv", index=False, encoding="utf-8-sig")

ds_rows = []
for r in urb.itertuples():
    s = (sidx_u == r.SIDX) & np.isfinite(ts)
    if s.sum() == 0:
        ds_rows.append((r.CD_SETOR, r.NM_MUN, 0, np.nan, np.nan, np.nan, np.nan)); continue
    ds_rows.append((r.CD_SETOR, r.NM_MUN, int(s.sum()), float(ts[s].mean()), float(dts[s].mean()),
                    float(np.median(dts[s])), float(np.percentile(dts[s], 90))))
dset = pd.DataFrame(ds_rows, columns=["CD_SETOR", "NM_MUN", "n_pixels_validos", "TS_media_C", "DTS_media", "DTS_mediana", "DTS_p90"])
rot = [c[0] for c in CLASSES]
dset["classe_DTS"] = pd.cut(dset["DTS_media"], BINS, labels=rot, right=False).astype(str).replace("nan", "")
dset.round(3).to_csv(OUT / "ts2025_setores_urbanos.csv", index=False, encoding="utf-8-sig")
pd.DataFrame(info).to_csv(OUT / "observacoes_landsat_2025.csv", index=False, encoding="utf-8-sig")
cenas.drop(columns=["st_b10", "st_qa", "qa_pixel"]).to_csv(OUT / "cenas_landsat_2025.csv", index=False, encoding="utf-8-sig")

# JSON p/ geoportal
vv = np.isfinite(ts)
rmp = {"TS_mediana_urbana_C": round(float(np.nanmedian(ts)), 2), "area_urbana_km2": round(iu.size * 900 / 1e6, 1),
       "pct_classes": [round(100 * float((classe[vv] == i).mean()), 1) for i in range(1, 7)]}
jm = {r.CD_MUN: {"TS_mediana": r.TS_mediana_urbana_C, "ranking": int(r.ranking_TS_RMP), "p10": r.TS_p10_C, "p90": r.TS_p90_C,
                 "area_urbana_km2": r.area_urbana_km2, "obs": int(r.obs_validas_mediana),
                 "pct_classes": [r[f"pct_{n}"] for n, _ in CLASSES]} for r in dm.to_dict("records") for r in [pd.Series(r)]}
json.dump({"classes": [{"nome": n, "cor": c} for n, c in CLASSES], "RMP": rmp, "municipios": jm,
           "mediana_por_idx": {str(m): round(v, 3) for m, v in med_mun.items()},
           "idx_mun": {str(m): cd[m] for m in mun.IDX}, "n_observacoes": len(obs),
           "metodo": "Landsat 8/9 C2 L2 ST_B10, estação seca (abr–set) 2025, mediana por pixel (≥3 obs., incerteza ≤3 K); "
                     "ΔTS = TS − mediana urbana do município."},
          open(OUT / "ts2025.json", "w", encoding="utf-8"), ensure_ascii=False)
json.dump({r.CD_SETOR: [None if pd.isna(r.TS_media_C) else round(r.TS_media_C, 2), None if pd.isna(r.DTS_media) else round(r.DTS_media, 2)]
           for r in dset.itertuples()}, open(OUT / "ts2025_setores.json", "w", encoding="utf-8"))

print(dm[["NM_MUN", "ranking_TS_RMP", "TS_mediana_urbana_C", "amplitude_p10_p90_C", "obs_validas_mediana", "pct_pixels_validos"]].to_string(index=False))
print("RMP:", rmp)
