"""
Equipamentos urbanos da RMP: INEP (escolas), CNES (saúde) e OpenStreetMap (Overpass API, demais).

Saídas (WGS84):
  dados/infraestrutura/equipamentos.geojson        pontos (polígonos viram o ponto central)
  dados/infraestrutura/equipamentos_municipios.csv contagem por categoria e município
  dados/infraestrutura/equipamentos.json           contagens + taxas por 10 mil hab. (usado pelo geoportal)

Fontes: escolas e creches – INEP, Catálogo de Escolas 2023 (gpkg distribuído pelo IPEA/geobr);
saúde – CNES (API de dados abertos do Ministério da Saúde); demais – OpenStreetMap (colaborativo,
a cobertura varia entre municípios).
"""
from pathlib import Path
import json, time
import requests
import geopandas as gpd
import pandas as pd
from shapely.geometry import Point
from shapely.ops import unary_union

RAIZ = Path(__file__).resolve().parent.parent
CACHE = RAIZ / "dados_brutos" / "osm"; CACHE.mkdir(parents=True, exist_ok=True)
SAIDA = RAIZ / "dados" / "infraestrutura"; SAIDA.mkdir(parents=True, exist_ok=True)

mun = gpd.read_file(RAIZ / "dados" / "municipios_rmp.geojson")[["CD_MUN", "NM_MUN", "pop_total", "geometry"]]
minx, miny, maxx, maxy = unary_union(mun.geometry).bounds

# categoria do geoportal <- (chave, valores OSM)
CATEGORIAS = [
    ("Universidade / faculdade",       [("amenity", "university|college")]),
    ("Praça / parque",                 [("leisure", "park"), ("place", "square")]),
    ("Esporte",                        [("leisure", "sports_centre|stadium")]),
    ("Cultura",                        [("amenity", "library|theatre|arts_centre|community_centre|cinema"), ("tourism", "museum")]),
    ("Segurança pública",              [("amenity", "police|fire_station")]),
    ("Administração pública",          [("amenity", "townhall|courthouse"), ("office", "government")]),
    ("Assistência social",             [("amenity", "social_facility")]),
    ("Terminal de ônibus",             [("amenity", "bus_station")]),
]
bbox = f"{miny},{minx},{maxy},{maxx}"
partes = []
for _, regras in CATEGORIAS:
    for k, v in regras:
        partes.append(f'nwr["{k}"~"^({v})$"]({bbox});')
CONSULTA = "[out:json][timeout:600];(\n" + "\n".join(partes) + "\n);out tags center;"

arq = CACHE / "equipamentos.json"
if not arq.exists():
    for tentativa in range(6):
        srv = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"][tentativa % 2]
        try:
            r = requests.post(srv, data={"data": CONSULTA}, timeout=900, headers={"User-Agent": "geoportal-rmp/1.0"})
            if r.status_code == 200 and '"remark"' not in r.text[-2000:]:
                tmp = arq.with_suffix(".part"); tmp.write_bytes(r.content); tmp.replace(arq); break
            print("  HTTP", r.status_code, "– tentando de novo")
        except requests.RequestException as ex:
            print("  erro", ex)
        time.sleep(20 * (tentativa + 1))
    else:
        raise SystemExit("falha no download do Overpass")

def categoria(t):
    for nome, regras in CATEGORIAS:
        for k, v in regras:
            if t.get(k) in v.split("|"):
                return nome
    return None

linhas = []
for el in json.loads(arq.read_text(encoding="utf-8"))["elements"]:
    t = el.get("tags", {})
    c = categoria(t)
    if not c:
        continue
    lat, lon = (el["lat"], el["lon"]) if el["type"] == "node" else (el.get("center", {}).get("lat"), el.get("center", {}).get("lon"))
    if lat is None:
        continue
    sub = t.get("amenity") or t.get("healthcare") or t.get("leisure") or t.get("place") or t.get("tourism") or t.get("office")
    linhas.append({"osm": f"{el['type'][0]}{el['id']}", "categoria": c, "tipo_osm": sub, "nome": t.get("name"),
                   "operador": t.get("operator"), "rede": t.get("operator:type") or t.get("school:type"),
                   "endereco": ", ".join(x for x in [t.get("addr:street"), t.get("addr:housenumber")] if x) or None,
                   "geometry": Point(lon, lat)})
for l in linhas: l["fonte"] = "OpenStreetMap"

# universidades no OSM costumam vir prédio a prédio (ex.: ESALQ): junta pontos a menos de 250 m em um só (campus)
uni = gpd.GeoDataFrame([l for l in linhas if l["categoria"] == "Universidade / faculdade"], crs="EPSG:4326").to_crs(31983)
linhas = [l for l in linhas if l["categoria"] != "Universidade / faculdade"]
if len(uni):
    uni["grupo"] = -1; g_id = 0
    for i in uni.index:
        if uni.at[i, "grupo"] >= 0: continue
        perto = uni[(uni.geometry.distance(uni.at[i, "geometry"]) < 250) & (uni.grupo < 0)].index
        uni.loc[perto, "grupo"] = g_id; g_id += 1
    for _, g in uni.groupby("grupo"):
        com_nome = g[g.nome.notna()]
        rep = (com_nome.loc[com_nome.nome.str.len().idxmin()] if len(com_nome) else g.iloc[0]).to_dict()
        rep["geometry"] = gpd.GeoSeries([g.geometry.union_all().centroid], crs=31983).to_crs(4326).iloc[0]
        rep.pop("grupo", None); linhas.append(rep)
    print("universidades: ", len(uni), "pontos OSM ->", g_id, "campi")

# ---------- Escolas: INEP – Catálogo de Escolas (via geobr/IPEA) ----------
INEP = RAIZ / "dados_brutos" / "inep"; INEP.mkdir(parents=True, exist_ok=True)
arq_inep = INEP / "schools_2023.gpkg"
if not arq_inep.exists():
    r = requests.get("https://www.ipea.gov.br/geobr/data_gpkg/schools/2023/schools_2023.gpkg", timeout=900); r.raise_for_status()
    tmp = arq_inep.with_suffix(".part"); tmp.write_bytes(r.content); tmp.replace(arq_inep)
esc = gpd.read_file(arq_inep, where="abbrev_state = 'SP'", bbox=(minx, miny, maxx, maxy)).to_crs(4326)
esc = esc[~esc.geometry.is_empty & esc.geometry.notna() & (esc.empty_geo != 1)]
esc = esc[esc.service_restriction.fillna("").str.upper() != "ESCOLA PARALISADA"]
n_inep = 0
for _, e in esc.iterrows():
    niveis = (e.education_level or "").strip()
    cat = "Creche / educação infantil" if niveis == "Educação Infantil" else "Escola"
    linhas.append({"id": f"inep{e.code_school}", "categoria": cat, "tipo_osm": None, "nome": (e.name_school or "").title() or None,
                   "operador": None, "rede": e.government_level or None, "niveis": niveis or e.education_level_others or None,
                   "porte": e["size"] or None, "endereco": (e.address or "").title() or None, "fonte": "INEP – Catálogo de Escolas 2023",
                   "geometry": e.geometry})
    n_inep += 1
print("escolas (INEP, em funcionamento, com coordenadas, na caixa da RMP):", n_inep)
CATEGORIAS = [("Escola", []), ("Creche / educação infantil", [])] + CATEGORIAS

# ---------- Saúde: CNES (Ministério da Saúde, API de dados abertos) ----------
SAUDE = [("Hospital", [5, 7, 62]), ("UBS / posto de saúde", [1, 2]), ("Pronto atendimento / UPA", [20, 21, 73]),
         ("CAPS", [70]), ("Clínica / centro de especialidades", [4, 36])]
CNES = RAIZ / "dados_brutos" / "cnes"; CNES.mkdir(parents=True, exist_ok=True)
URL_CNES = "https://apidadosabertos.saude.gov.br/cnes/estabelecimentos"
n_cnes = 0
for cd in mun.CD_MUN:
    for cat, tipos in SAUDE:
        for tp in tipos:
            arq_c = CNES / f"{cd}_{tp}.json"
            if not arq_c.exists():
                todos, off = [], 0
                while True:
                    for tent in range(5):
                        try:
                            r = requests.get(URL_CNES, params={"codigo_municipio": cd[:6], "codigo_tipo_unidade": tp, "limit": 20, "offset": off},
                                             timeout=60, headers={"accept": "application/json"})
                            if r.status_code == 200: break
                        except requests.RequestException: pass
                        time.sleep(5 * (tent + 1))
                    else:
                        raise SystemExit(f"CNES falhou: {cd} tipo {tp}")
                    lote = r.json().get("estabelecimentos", [])
                    todos += lote
                    if len(lote) < 20: break
                    off += 1          # nesta API, "offset" é o número da página (não o nº de registros)
                tmp = arq_c.with_suffix(".part"); tmp.write_text(json.dumps(todos, ensure_ascii=False), encoding="utf-8"); tmp.replace(arq_c)
            for e in json.loads(arq_c.read_text(encoding="utf-8")):
                lat, lon = e.get("latitude_estabelecimento_decimo_grau"), e.get("longitude_estabelecimento_decimo_grau")
                if e.get("codigo_motivo_desabilitacao_estabelecimento") or lat is None or lon is None:
                    continue
                linhas.append({"osm": f"cnes{e['codigo_cnes']}", "categoria": cat, "tipo_osm": None,
                               "nome": (e.get("nome_fantasia") or e.get("nome_razao_social") or "").title() or None,
                               "operador": None, "rede": (e.get("descricao_esfera_administrativa") or "").title() or None,
                               "endereco": ", ".join(x for x in [e.get("endereco_estabelecimento"), e.get("numero_estabelecimento")] if x).title() or None,
                               "sus": "Sim" if e.get("estabelecimento_faz_atendimento_ambulatorial_sus") == "SIM" else "Não",
                               "fonte": "CNES", "geometry": Point(lon, lat)})
                n_cnes += 1
    print("CNES", cd, "ok")
print("estabelecimentos de saúde (CNES):", n_cnes)
CATEGORIAS = CATEGORIAS[:3] + [(c, []) for c, _ in SAUDE] + CATEGORIAS[3:]

for l in linhas:
    if "osm" in l: l["id"] = l.pop("osm")
eq = gpd.GeoDataFrame(linhas, crs="EPSG:4326")
eq = gpd.sjoin(eq, mun[["CD_MUN", "NM_MUN", "geometry"]], predicate="within").drop(columns="index_right")
# remove duplicatas (mesmo nome e categoria no mesmo quadrado de 10 m)
eq["_x"] = eq.to_crs(31983).geometry.x.round(-1); eq["_y"] = eq.to_crs(31983).geometry.y.round(-1)
eq = eq.drop_duplicates(subset=["categoria", "nome", "_x", "_y"]).drop(columns=["_x", "_y"])
eq = eq.sort_values(["NM_MUN", "categoria", "nome"], na_position="last").reset_index(drop=True)

saida = SAIDA / "equipamentos.geojson"; saida.unlink(missing_ok=True)
eq.to_file(saida, driver="GeoJSON", COORDINATE_PRECISION=6, RFC7946="YES")
print(saida.name, len(eq), f"{saida.stat().st_size/1e6:.2f} MB")

cont = eq.groupby(["CD_MUN", "categoria"]).size().unstack(fill_value=0)
cont = mun.set_index("CD_MUN")[["NM_MUN", "pop_total"]].join(cont).fillna(0)
cats = [c for c, _ in CATEGORIAS]
for c in cats:
    if c not in cont: cont[c] = 0
cont[cats] = cont[cats].astype(int)
cont.reset_index().to_csv(SAIDA / "equipamentos_municipios.csv", index=False, encoding="utf-8-sig", sep=";")
dados = {cd: {c: int(r[c]) for c in cats} for cd, r in cont.iterrows()}
dados["RMP"] = {c: int(cont[c].sum()) for c in cats}
(SAIDA / "equipamentos.json").write_text(json.dumps({"categorias": cats, "dados": dados}, ensure_ascii=False), encoding="utf-8")
print(cont.sort_values("pop_total", ascending=False)[["NM_MUN"] + cats].to_string())
