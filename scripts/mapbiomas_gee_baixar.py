"""
Alternativa ao Code Editor: baixa direto do Earth Engine via Python (precisa de conta GEE).

Antes, uma única vez, autentique-se no terminal:
  "C:\\Program Files\\QGIS 3.44.15\\bin\\python-qgis-ltr.bat" -c "import ee; ee.Authenticate()"
Depois rode:
  "C:\\Program Files\\QGIS 3.44.15\\bin\\python-qgis-ltr.bat" scripts\\mapbiomas_gee_baixar.py SEU_PROJETO_GCP
"""
import sys
from pathlib import Path
import requests
import ee

projeto = sys.argv[1] if len(sys.argv) > 1 else None
ee.Initialize(project=projeto)

DEST = Path(__file__).resolve().parent.parent / "dados_brutos" / "mapbiomas"
DEST.mkdir(parents=True, exist_ok=True)
col = ee.Image("projects/mapbiomas-public/assets/brazil/lulc/collection11/mapbiomas_brazil_collection11_coverage_v3")
regiao = ee.Geometry.Rectangle([-48.28, -23.19, -47.05, -21.82])

for ano in (1990, 2025):
    img = col.select(f"classification_{ano}").clip(regiao).toUint8()
    url = img.getDownloadURL({"region": regiao, "scale": 30, "crs": "EPSG:4326", "format": "GEO_TIFF"})
    destino = DEST / f"mapbiomas_rmp_{ano}.tif"
    print("baixando", destino.name)
    with requests.get(url, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(destino, "wb") as f:
            for bloco in r.iter_content(1 << 20):
                f.write(bloco)
print("pronto – agora rode scripts\\preparar_mapbiomas.py")
