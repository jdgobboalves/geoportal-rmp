"""
Relevo da RMP a partir do Copernicus DEM GLO-30 (30 m, AWS Open Data).

Saídas:
  dados/relevo/mde_rmp_wgs84.tif      MDE recortado (EPSG:4326, metros)
  dados/relevo/curvas_50m.geojson      curvas de nível a cada 50 m (WGS84)
  dados/web/relevo_hipso.webp          hipsometria + sombreamento (EPSG:3857) p/ o mapa
  dados/web/relevo_altitude.png        altitude codificada em RGB (consulta por clique)
  dados/web/rasters.json               limites das imagens (atualizado)
"""
from pathlib import Path
import json
import numpy as np
from osgeo import gdal, ogr
from PIL import Image

gdal.UseExceptions()
RAIZ = Path(__file__).resolve().parent.parent
BRUTOS = RAIZ / "dados_brutos" / "mde"
OUT = RAIZ / "dados" / "relevo"
WEB = RAIZ / "dados" / "web"
for p in (BRUTOS, OUT, WEB):
    p.mkdir(parents=True, exist_ok=True)
LIMITE = RAIZ / "dados" / "municipios_rmp.geojson"

# 1) Baixa as 6 folhas do Copernicus que cobrem a RMP
url = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM/Copernicus_DSM_COG_10_{lat}_00_{lon}_00_DEM.tif"
folhas = []
for lat in ("S22", "S23", "S24"):
    for lon in ("W048", "W049"):
        destino = BRUTOS / f"cop30_{lat}_{lon}.tif"
        if not destino.exists():
            print("baixando", destino.name)
            gdal.Translate(str(destino), "/vsicurl/" + url.format(lat=lat, lon=lon),
                           creationOptions=["COMPRESS=DEFLATE", "TILED=YES"])
        folhas.append(str(destino))
vrt = str(BRUTOS / "cop30.vrt")
gdal.BuildVRT(vrt, folhas)

# 2) Limite dissolvido da RMP
ds = ogr.Open(str(LIMITE))
lyr = ds.GetLayer()
uniao = None
for f in lyr:
    g = f.GetGeometryRef().Clone()
    uniao = g if uniao is None else uniao.Union(g)
limite_rmp = OUT / "_limite_rmp.geojson"
drv = ogr.GetDriverByName("GeoJSON")
if limite_rmp.exists():
    drv.DeleteDataSource(str(limite_rmp))
o = drv.CreateDataSource(str(limite_rmp))
ol = o.CreateLayer("rmp", lyr.GetSpatialRef(), ogr.wkbMultiPolygon)
feat = ogr.Feature(ol.GetLayerDefn()); feat.SetGeometry(uniao); ol.CreateFeature(feat)
o = None

# 3) MDE recortado em WGS84
mde = str(OUT / "mde_rmp_wgs84.tif")
gdal.Warp(mde, vrt, dstSRS="EPSG:4326", cutlineDSName=str(limite_rmp), cropToCutline=True,
          dstNodata=-9999, creationOptions=["COMPRESS=DEFLATE", "TILED=YES", "PREDICTOR=3"])

# 4) Curvas de nível (50 m)
curvas = OUT / "curvas_50m.geojson"
curvas.unlink(missing_ok=True)
tmp = str(OUT / "_curvas.gpkg")
Path(tmp).unlink(missing_ok=True)
src = gdal.Open(mde)
cds = ogr.GetDriverByName("GPKG").CreateDataSource(tmp)
cl = cds.CreateLayer("curvas", src.GetSpatialRef(), ogr.wkbLineString)
cl.CreateField(ogr.FieldDefn("ID", ogr.OFTInteger))
cl.CreateField(ogr.FieldDefn("altitude", ogr.OFTReal))
gdal.ContourGenerate(src.GetRasterBand(1), 50, 0, [], 1, -9999, cl, 0, 1)
cds = None
import geopandas as gpd
cv = gpd.read_file(tmp)[["altitude", "geometry"]]
cv["geometry"] = cv.geometry.simplify(0.00015)
cv = cv.explode(index_parts=False)
cv = cv[(cv.geom_type == "LineString") & (cv.to_crs(31983).length > 200)]  # descarta anéis < 200 m
cv.to_file(curvas, driver="GeoJSON", COORDINATE_PRECISION=5, RFC7946="YES")
Path(tmp).unlink(missing_ok=True)

# 5) Versões web em EPSG:3857 (~40 m)
m3857 = str(OUT / "_mde_3857.tif")
gdal.Warp(m3857, vrt, dstSRS="EPSG:3857", xRes=40, yRes=40, resampleAlg="bilinear",
          cutlineDSName=str(limite_rmp), cropToCutline=True, dstNodata=-9999)
r = gdal.Open(m3857)
z = r.GetRasterBand(1).ReadAsArray().astype("float32")
valido = z > -9000
gt = r.GetGeoTransform()

# Sombreamento
hs = gdal.DEMProcessing("", m3857, "hillshade", format="MEM", zFactor=2, multiDirectional=True)
h = hs.GetRasterBand(1).ReadAsArray().astype("float32") / 255.0

# Hipsometria (verde -> amarelo -> marrom)
zmin, zmax = np.percentile(z[valido], [1, 99])
paradas = [(0.0, (56, 128, 77)), (0.25, (139, 179, 96)), (0.5, (231, 214, 128)),
           (0.75, (196, 140, 80)), (1.0, (135, 90, 60))]
t = np.clip((z - zmin) / (zmax - zmin), 0, 1)
rgb = np.zeros(z.shape + (3,), dtype="float32")
for (t0, c0), (t1, c1) in zip(paradas[:-1], paradas[1:]):
    m = (t >= t0) & (t <= t1)
    f = ((t - t0) / (t1 - t0))[m][:, None]
    rgb[m] = np.array(c0) * (1 - f) + np.array(c1) * f
rgb = rgb * (0.45 + 0.65 * h[..., None])
img = np.dstack([np.clip(rgb, 0, 255).astype("uint8"), (valido * 255).astype("uint8")])
memi = gdal.GetDriverByName("MEM").Create("", img.shape[1], img.shape[0], 4, gdal.GDT_Byte)
for i in range(4):
    memi.GetRasterBand(i + 1).WriteArray(img[..., i])
gdal.GetDriverByName("WEBP").CreateCopy(str(WEB / "relevo_hipso.webp"), memi, options=["QUALITY=82"])
memi = None
(WEB / "relevo_hipso.webp.aux.xml").unlink(missing_ok=True)
(WEB / "relevo_hipso.png").unlink(missing_ok=True)

# Altitude codificada (R*256 + G) em decímetros, A = válido
dm = np.where(valido, np.round(z * 10), 0).astype("uint32")
enc = np.dstack([(dm >> 8) & 255, dm & 255, np.zeros_like(dm), valido * 255]).astype("uint8")
Image.fromarray(enc, "RGBA").save(WEB / "relevo_altitude.png", optimize=True)

# Limites (lat/lon) da imagem 3857
def merc2ll(x, y):
    lon = x / 6378137.0 * 180 / np.pi
    lat = np.degrees(2 * np.arctan(np.exp(y / 6378137.0)) - np.pi / 2)
    return float(lat), float(lon)
x0, y0 = gt[0], gt[3]
x1, y1 = x0 + gt[1] * r.RasterXSize, y0 + gt[5] * r.RasterYSize
sw, ne = merc2ll(x0, y1), merc2ll(x1, y0)

meta_p = WEB / "rasters.json"
meta = json.loads(meta_p.read_text(encoding="utf-8")) if meta_p.exists() else {}
meta["relevo"] = {"bounds": [sw, ne], "largura": r.RasterXSize, "altura": r.RasterYSize,
                  "min": round(float(z[valido].min()), 1), "max": round(float(z[valido].max()), 1),
                  "escala_min": round(float(zmin)), "escala_max": round(float(zmax))}
meta_p.write_text(json.dumps(meta, indent=2), encoding="utf-8")
r = None; hs = None
for f in ("_mde_3857.tif",):
    (OUT / f).unlink(missing_ok=True)
print(meta["relevo"])
for p in [Path(mde), curvas, WEB / "relevo_hipso.webp", WEB / "relevo_altitude.png"]:
    print(p.name, f"{p.stat().st_size/1e6:.1f} MB")
