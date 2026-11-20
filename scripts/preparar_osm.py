"""
Hidrografia e sistema viário da RMP a partir do OpenStreetMap (Overpass API).

Saídas (WGS84):
  dados/hidrografia/cursos_dagua.geojson   rios, córregos e canais
  dados/hidrografia/massas_dagua.geojson   represas, lagos e rios (polígonos)
  dados/vias/rodovias.geojson              rodovias e vias principais (toda a RMP)
  dados/vias/ruas_<CD_MUN>.geojson         ruas, avenidas e estradas por município
  dados/vias/resumo_vias.json              extensão (km) por tipo e município
"""
from pathlib import Path
import json, time
import requests
import geopandas as gpd
import pandas as pd
from shapely.geometry import LineString, Polygon
from shapely.ops import polygonize, unary_union

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "dados_brutos" / "osm"
CACHE.mkdir(parents=True, exist_ok=True)
HID = RAIZ / "dados" / "hidrografia"; HID.mkdir(parents=True, exist_ok=True)
VIAS = RAIZ / "dados" / "vias"; VIAS.mkdir(parents=True, exist_ok=True)

mun = gpd.read_file(RAIZ / "dados" / "municipios_rmp.geojson")[["CD_MUN", "NM_MUN", "geometry"]]
rmp = unary_union(mun.geometry)
minx, miny, maxx, maxy = rmp.bounds

HW = "motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|living_street|unclassified|track|road"
CONSULTA = """[out:json][timeout:600];
(
  way["highway"~"^({hw})$"]({s},{w},{n},{e});
  way["waterway"~"^(river|stream|canal|drain|ditch)$"]({s},{w},{n},{e});
  way["natural"="water"]({s},{w},{n},{e});
  way["waterway"="riverbank"]({s},{w},{n},{e});
  relation["natural"="water"]({s},{w},{n},{e});
);
out tags geom;"""
SERVIDORES = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]

# 1) Download em grade de 0,25° (com cache)
passo = 0.25
celulas = []
y = miny
while y < maxy:
    x = minx
    while x < maxx:
        celulas.append((round(y, 4), round(x, 4), round(min(y + passo, maxy), 4), round(min(x + passo, maxx), 4)))
        x += passo
    y += passo

elementos = {}
for i, (s, w, n, e) in enumerate(celulas, 1):
    arq = CACHE / f"celula_{s}_{w}.json"
    if not arq.exists():
        q = CONSULTA.format(hw=HW, s=s, w=w, n=n, e=e)
        for tentativa in range(6):
            srv = SERVIDORES[tentativa % len(SERVIDORES)]
            try:
                r = requests.post(srv, data={"data": q}, timeout=900,
                                  headers={"User-Agent": "geoportal-rmp/1.0"})
                if r.status_code == 200 and '"remark"' not in r.text[-2000:]:
                    tmp = arq.with_suffix(".part")
                    tmp.write_bytes(r.content); tmp.replace(arq)  # grava só arquivos completos
                    break
                if r.status_code == 200:
                    print("  resposta parcial (remark) – tentando de novo")
                print("  HTTP", r.status_code, "aguardando…")
            except requests.RequestException as ex:
                print("  erro", ex)
            time.sleep(20 * (tentativa + 1))
        else:
            raise SystemExit(f"falha na célula {arq.name}")
        time.sleep(3)
    for el in json.loads(arq.read_text(encoding="utf-8"))["elements"]:
        elementos[(el["type"], el["id"])] = el
    print(f"célula {i}/{len(celulas)} – {len(elementos)} elementos únicos")

# 2) Converte em geometrias
linhas_hw, linhas_wt, poligonos = [], [], []
for (tipo, _), el in elementos.items():
    t = el.get("tags", {})
    if tipo == "way" and "geometry" in el:
        coords = [(p["lon"], p["lat"]) for p in el["geometry"]]
        if len(coords) < 2:
            continue
        if "highway" in t:
            linhas_hw.append({"osm_id": el["id"], "highway": t["highway"], "nome": t.get("name"),
                              "ref": t.get("ref"), "pavimento": t.get("surface"), "geometry": LineString(coords)})
        elif t.get("waterway") in ("river", "stream", "canal", "drain", "ditch"):
            linhas_wt.append({"osm_id": el["id"], "waterway": t["waterway"], "nome": t.get("name"),
                              "geometry": LineString(coords)})
        elif (t.get("natural") == "water" or t.get("waterway") == "riverbank") and len(coords) >= 4 and coords[0] == coords[-1]:
            poligonos.append({"osm_id": el["id"], "tipo": t.get("water", "água"), "nome": t.get("name"),
                              "geometry": Polygon(coords)})
    elif tipo == "relation":
        externos = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                    for m in el.get("members", []) if m.get("role") == "outer" and m.get("geometry")]
        internos = [LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                    for m in el.get("members", []) if m.get("role") == "inner" and m.get("geometry")]
        if externos:
            g = unary_union(list(polygonize(unary_union(externos))))
            if internos:
                g = g.difference(unary_union(list(polygonize(unary_union(internos)))))
            if not g.is_empty:
                poligonos.append({"osm_id": el["id"], "tipo": t.get("water", "água"), "nome": t.get("name"), "geometry": g})

CLASSE = {
    "motorway": "Rodovia principal", "motorway_link": "Rodovia principal", "trunk": "Rodovia principal",
    "trunk_link": "Rodovia principal", "primary": "Rodovia / via arterial", "primary_link": "Rodovia / via arterial",
    "secondary": "Via arterial / avenida", "secondary_link": "Via arterial / avenida",
    "tertiary": "Via coletora / avenida", "tertiary_link": "Via coletora / avenida",
    "residential": "Rua", "living_street": "Rua", "road": "Rua",
    "unclassified": "Estrada vicinal", "track": "Estrada rural (terra)",
}
TIPO_AGUA = {"river": "Rio", "stream": "Córrego / ribeirão", "canal": "Canal", "drain": "Canal / dreno", "ditch": "Canal / dreno"}

crs = "EPSG:4326"
vias = gpd.GeoDataFrame(linhas_hw, crs=crs)
vias["classe"] = vias["highway"].map(CLASSE)
cursos = gpd.GeoDataFrame(linhas_wt, crs=crs)
cursos["tipo"] = cursos["waterway"].map(TIPO_AGUA)
massas = gpd.GeoDataFrame(poligonos, crs=crs)
massas["geometry"] = massas.geometry.buffer(0)

# 3) Recorte pelos municípios (cada trecho recebe o município)
def recorta(gdf):
    familia = "Polygon" if gdf.geom_type.str.contains("Polygon").all() else "LineString"
    out = gpd.overlay(gdf, mun, how="intersection", keep_geom_type=True)
    out = out.explode(index_parts=False).reset_index(drop=True)
    out = out[(out.geom_type == familia) & ~out.is_empty]
    if familia == "LineString":  # descarta trechos degenerados (comprimento zero) do recorte
        out = out[out.geometry.apply(lambda g: len({(round(x, 6), round(y, 6)) for x, y in g.coords}) > 1)]
    return out.reset_index(drop=True)

vias = recorta(vias)
cursos = recorta(cursos)
massas = recorta(massas)
massas = massas[massas.to_crs(31983).area > 500]  # descarta polígonos < 500 m²

m = vias.to_crs(31983)
vias["km"] = (m.length / 1000).round(3)
cursos["km"] = (cursos.to_crs(31983).length / 1000).round(3)
massas["area_ha"] = (massas.to_crs(31983).area / 1e4).round(2)

opts = dict(driver="GeoJSON", COORDINATE_PRECISION=6, RFC7946="YES")
def salva(gdf, caminho, cols):
    caminho.unlink(missing_ok=True)
    gdf[cols + ["geometry"]].to_file(caminho, **opts)
    print(caminho.name, len(gdf), f"{caminho.stat().st_size/1e6:.1f} MB")

salva(cursos, HID / "cursos_dagua.geojson", ["tipo", "nome", "NM_MUN", "km"])
salva(massas, HID / "massas_dagua.geojson", ["tipo", "nome", "NM_MUN", "area_ha"])

principais = ["Rodovia principal", "Rodovia / via arterial", "Via arterial / avenida"]
salva(vias[vias["classe"].isin(principais)], VIAS / "rodovias.geojson", ["classe", "highway", "nome", "ref", "pavimento", "NM_MUN", "km"])
for cd, g in vias[~vias["classe"].isin(principais)].groupby("CD_MUN"):
    salva(g, VIAS / f"ruas_{cd}.geojson", ["classe", "highway", "nome", "pavimento", "km"])

resumo = (vias.groupby(["CD_MUN", "classe"])["km"].sum().round(1).unstack(fill_value=0))
(VIAS / "resumo_vias.json").write_text(resumo.to_json(orient="index", force_ascii=False), encoding="utf-8")
print("extensão total de vias (km):", round(vias["km"].sum()))
print("extensão de cursos d'água (km):", round(cursos["km"].sum()))
