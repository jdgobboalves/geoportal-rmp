"""
Dados econômicos por município da RMP (IBGE – API de agregados/SIDRA).

  PIB dos Municípios (tabela 5938): PIB e valor adicionado por setor, ano mais recente
  CEMPRE – Cadastro Central de Empresas (tabela 9509): empresas, pessoal ocupado, salário médio
  Estimativas de população (tabela 6579): população estimada mais recente

Saídas:
  dados/economia/economia_municipios.csv   uma linha por município (+ RMP)
  dados/economia/economia.json             mesmo conteúdo + metadados das variáveis (usado pelo geoportal)
"""
from pathlib import Path
import json
import requests
import pandas as pd

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "dados" / "economia"; SAIDA.mkdir(parents=True, exist_ok=True)
API = "https://servicodados.ibge.gov.br/api/v3/agregados"

mun = json.loads((RAIZ / "dados" / "municipios_rmp.geojson").read_text(encoding="utf-8"))
props = {f["properties"]["CD_MUN"]: f["properties"] for f in mun["features"]}
cods = ",".join(props)


def ultimo_periodo(tabela):
    return requests.get(f"{API}/{tabela}/periodos", timeout=60).json()[-1]["id"]


def busca(tabela, variaveis, periodo):
    url = f"{API}/{tabela}/periodos/{periodo}/variaveis/{'|'.join(map(str, variaveis))}"
    r = requests.get(url, params={"localidades": f"N6[{cods}]"}, timeout=120)
    r.raise_for_status()
    out = {}
    for v in r.json():
        for res in v["resultados"]:
            for s in res["series"]:
                val = s["serie"][periodo]
                try: val = float(val)
                except (TypeError, ValueError): val = None   # "-", "...", "X" (sigilo)
                out.setdefault(s["localidade"]["id"], {})[int(v["id"])] = val
    return out


ano_pib, ano_cempre, ano_pop = ultimo_periodo(5938), ultimo_periodo(9509), ultimo_periodo(6579)
pib = busca(5938, [37], ano_pib)
# o valor adicionado por setor sai depois do PIB total ("..." no ano mais recente): usa o último ano com dado
periodos_pib = [p["id"] for p in requests.get(f"{API}/5938/periodos", timeout=60).json()][::-1]
for ano_vab in periodos_pib:
    vab = busca(5938, [498, 513, 517, 6575, 525], ano_vab)
    if sum(v.get(498) is not None for v in vab.values()) >= len(props) - 1:
        break
for cd, v in vab.items():
    pib.setdefault(cd, {}).update(v)
print("PIB:", ano_pib, "| VAB por setor:", ano_vab, "| CEMPRE:", ano_cempre, "| estimativa de população:", ano_pop)
cem = busca(9509, [367, 707, 708, 1606, 10143], ano_cempre)
pop = busca(6579, [9324], ano_pop)

linhas = []
for cd, p in props.items():
    a, c, e = pib.get(cd, {}), cem.get(cd, {}), pop.get(cd, {})
    vab = a.get(498)
    pct = lambda k: round(a[k] / vab * 100, 2) if vab and a.get(k) is not None else None
    linhas.append({
        "CD_MUN": cd, "NM_MUN": p["NM_MUN"],
        "pib_mil": a.get(37), "vab_mil": vab,
        "vab_agro_mil": a.get(513), "vab_ind_mil": a.get(517), "vab_serv_mil": a.get(6575), "vab_adm_mil": a.get(525),
        "pct_agro": pct(513), "pct_ind": pct(517), "pct_serv": pct(6575), "pct_adm": pct(525),
        "pop_2022": p["pop_total"], "pop_estimada": e.get(9324),
        "empresas": c.get(367), "pessoal_ocupado": c.get(707), "pessoal_assalariado": c.get(708),
        "salario_medio_sm": c.get(1606), "salario_medio_reais": c.get(10143),
    })
df = pd.DataFrame(linhas)
df["pib_milhoes"] = (df.pib_mil / 1000).round(1)
df["pib_per_capita"] = (df.pib_mil * 1000 / df.pop_2022).round(0)       # R$ por habitante (Censo 2022)
df["cresc_pop_pct"] = ((df.pop_estimada / df.pop_2022 - 1) * 100).round(2)
df["empregos_por_100hab"] = (df.pessoal_ocupado / df.pop_2022 * 100).round(1)
df["empresas_por_mil_hab"] = (df.empresas / df.pop_2022 * 1000).round(1)

# total da RMP
s = df.select_dtypes("number").sum(min_count=1)
rmp = {"CD_MUN": "RMP", "NM_MUN": "RMP (24 municípios)"}
for k in ["pib_mil", "vab_mil", "vab_agro_mil", "vab_ind_mil", "vab_serv_mil", "vab_adm_mil", "pop_2022",
          "pop_estimada", "empresas", "pessoal_ocupado", "pessoal_assalariado"]:
    rmp[k] = s[k]
for k, v in [("pct_agro", "vab_agro_mil"), ("pct_ind", "vab_ind_mil"), ("pct_serv", "vab_serv_mil"), ("pct_adm", "vab_adm_mil")]:
    rmp[k] = round(rmp[v] / rmp["vab_mil"] * 100, 2)
rmp["salario_medio_sm"] = round((df.salario_medio_sm * df.pessoal_assalariado).sum() / df.pessoal_assalariado.sum(), 2)
rmp["salario_medio_reais"] = round((df.salario_medio_reais * df.pessoal_assalariado).sum() / df.pessoal_assalariado.sum(), 2)
rmp["pib_milhoes"] = round(rmp["pib_mil"] / 1000, 1)
rmp["pib_per_capita"] = round(rmp["pib_mil"] * 1000 / rmp["pop_2022"])
rmp["cresc_pop_pct"] = round((rmp["pop_estimada"] / rmp["pop_2022"] - 1) * 100, 2)
rmp["empregos_por_100hab"] = round(rmp["pessoal_ocupado"] / rmp["pop_2022"] * 100, 1)
rmp["empresas_por_mil_hab"] = round(rmp["empresas"] / rmp["pop_2022"] * 1000, 1)
df = pd.concat([df.sort_values("NM_MUN"), pd.DataFrame([rmp])], ignore_index=True)

df.to_csv(SAIDA / "economia_municipios.csv", index=False, encoding="utf-8-sig", sep=";", decimal=",")

fontes = {"pib": f"IBGE – PIB dos Municípios {ano_pib}", "vab": f"IBGE – PIB dos Municípios {ano_vab}", "cempre": f"IBGE – Cadastro Central de Empresas (CEMPRE) {ano_cempre}",
          "pop": f"IBGE – Estimativas de população {ano_pop}"}
variaveis = {
    "pib_milhoes":         {"nome": f"PIB {ano_pib}", "unidade": "R$ milhões", "casas": 1, "fonte": fontes["pib"]},
    "pib_per_capita":      {"nome": f"PIB per capita {ano_pib}", "unidade": "R$/hab.", "casas": 0, "fonte": fontes["pib"] + " e Censo 2022",
                            "desc": "PIB a preços correntes dividido pela população do Censo 2022."},
    "pct_ind":             {"nome": f"Participação da indústria no VAB {ano_vab}", "unidade": "%", "casas": 1, "fonte": fontes["pib"]},
    "pct_serv":            {"nome": f"Participação dos serviços no VAB {ano_vab}", "unidade": "%", "casas": 1, "fonte": fontes["pib"],
                            "desc": "Serviços, exceto administração pública."},
    "pct_agro":            {"nome": f"Participação da agropecuária no VAB {ano_vab}", "unidade": "%", "casas": 1, "fonte": fontes["pib"]},
    "pct_adm":             {"nome": f"Participação da administração pública no VAB {ano_vab}", "unidade": "%", "casas": 1, "fonte": fontes["pib"]},
    "empresas":            {"nome": f"Empresas e outras organizações {ano_cempre}", "unidade": "unid.", "casas": 0, "fonte": fontes["cempre"]},
    "pessoal_ocupado":     {"nome": f"Pessoal ocupado {ano_cempre}", "unidade": "pessoas", "casas": 0, "fonte": fontes["cempre"],
                            "desc": "Pessoal ocupado total nas empresas e organizações formais (CEMPRE)."},
    "empregos_por_100hab": {"nome": f"Pessoal ocupado por 100 habitantes {ano_cempre}", "unidade": "por 100 hab.", "casas": 1,
                            "fonte": fontes["cempre"] + " e Censo 2022"},
    "salario_medio_sm":    {"nome": f"Salário médio mensal {ano_cempre}", "unidade": "salários mínimos", "casas": 2, "fonte": fontes["cempre"]},
    "pop_estimada":        {"nome": f"População estimada {ano_pop}", "unidade": "hab.", "casas": 0, "fonte": fontes["pop"]},
    "cresc_pop_pct":       {"nome": f"Crescimento da população 2022–{ano_pop}", "unidade": "%", "casas": 2, "fonte": fontes["pop"] + " e Censo 2022"},
}
dados = {r["CD_MUN"]: {k: (None if pd.isna(v) else v) for k, v in r.items() if k not in ("CD_MUN",)} for r in df.to_dict("records")}
(SAIDA / "economia.json").write_text(json.dumps({"anos": {"pib": ano_pib, "vab": ano_vab, "cempre": ano_cempre, "pop": ano_pop},
    "variaveis": variaveis, "dados": dados}, ensure_ascii=False), encoding="utf-8")
print(df[["NM_MUN", "pib_milhoes", "pib_per_capita", "pct_ind", "empresas", "pessoal_ocupado", "salario_medio_sm", "pop_estimada"]].to_string())
