"""
Prepara os dados do Geoportal da RMP (Região Metropolitana de Piracicaba).

Fontes (IBGE):
  - Composição das RMs 2025 (Composicao_RM_2025.xlsx)
  - Malha municipal 2024 de SP (SP_Municipios_2024.zip)
  - Malha de setores censitários do Censo 2022 com agregados (SP_setores_CD2022.gpkg)

Saídas em ../dados (WGS84, EPSG:4326):
  - municipios_rmp.geojson / setores_rmp.geojson  (usados pelo geoportal)
  - rmp_wgs84.gpkg (as duas camadas, para uso em SIG)

Executar com o Python do QGIS:
  "C:\\Program Files\\QGIS 3.44.15\\bin\\python-qgis-ltr.bat" scripts\\preparar_dados.py
"""
from pathlib import Path
import json

import geopandas as gpd
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
BRUTOS = RAIZ / "dados_brutos"
SAIDA = RAIZ / "dados"
SAIDA.mkdir(exist_ok=True)

# 1) Municípios da RMP segundo o IBGE
rm = pd.read_excel(BRUTOS / "Composicao_RM_2025.xlsx")
rm = rm[rm["NOME_CATMETROPOL"] == "Região Metropolitana de Piracicaba"]
codigos = sorted(rm["COD_MUN"].astype(str))
assert len(codigos) == 24, f"esperado 24 municípios, obtido {len(codigos)}"

# 2) Setores censitários 2022 (SIRGAS 2000 -> WGS84)
setores = gpd.read_file(
    BRUTOS / "SP_setores_CD2022.gpkg",
    where="CD_MUN IN (%s)" % ",".join(f"'{c}'" for c in codigos),
)
num = ["v0001", "v0005", "v0007", "AREA_KM2"]
for c in num:
    setores[c] = pd.to_numeric(setores[c].astype(str).str.replace(",", "."), errors="coerce")

setores = setores.rename(columns={
    "v0001": "pop_total",
    "v0007": "dom_ocup",
    "v0005": "media_morad",
    "AREA_KM2": "area_km2",
})
setores["dens_demog"] = (setores["pop_total"] / setores["area_km2"]).where(setores["area_km2"] > 0)
setores["dens_demog"] = setores["dens_demog"].round(1)
setores["area_km2"] = setores["area_km2"].round(4)

manter = ["CD_SETOR", "CD_MUN", "NM_MUN", "NM_DIST", "NM_BAIRRO", "SITUACAO",
          "pop_total", "dom_ocup", "media_morad", "dens_demog", "area_km2", "geometry"]
setores = setores[manter].to_crs(4326)

# 3) Limites municipais (malha 2024) + totais agregados dos setores
mun = gpd.read_file(f"zip://{BRUTOS / 'SP_Municipios_2024.zip'}")
mun = mun[mun["CD_MUN"].isin(codigos)][["CD_MUN", "NM_MUN", "AREA_KM2", "geometry"]]
tot = setores.groupby("CD_MUN").agg(pop_total=("pop_total", "sum"),
                                    dom_ocup=("dom_ocup", "sum"),
                                    n_setores=("CD_SETOR", "count")).reset_index()
mun = mun.merge(tot, on="CD_MUN", how="left").rename(columns={"AREA_KM2": "area_km2"})
mun["area_km2"] = mun["area_km2"].round(2)
mun["dens_demog"] = (mun["pop_total"] / mun["area_km2"]).round(1)
mun = mun.to_crs(4326).sort_values("NM_MUN")
assert len(mun) == 24

# 4) Exporta
opts = dict(driver="GeoJSON", COORDINATE_PRECISION=6, RFC7946="YES")
for nome, gdf in [("municipios_rmp", mun), ("setores_rmp", setores)]:
    destino = SAIDA / f"{nome}.geojson"
    destino.unlink(missing_ok=True)
    gdf.to_file(destino, **opts)
    gdf.to_file(SAIDA / "rmp_wgs84.gpkg", layer=nome, driver="GPKG")
    print(f"{nome}: {len(gdf)} feições, {destino.stat().st_size/1e6:.1f} MB")

resumo = {
    "municipios": int(len(mun)),
    "setores": int(len(setores)),
    "pop_total": int(mun["pop_total"].sum()),
    "dom_ocup": int(mun["dom_ocup"].sum()),
    "area_km2": round(float(mun["area_km2"].sum()), 1),
}
(SAIDA / "resumo.json").write_text(json.dumps(resumo, ensure_ascii=False, indent=2), encoding="utf-8")
print(resumo)
