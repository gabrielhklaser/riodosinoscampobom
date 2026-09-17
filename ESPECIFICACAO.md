# 📋 Especificação — Dashboard Rio dos Sinos / Campo Bom

> Documento-mestre do projeto. Reúne todos os requisitos, endpoints validados,
> parâmetros de calibração e armadilhas descobertas durante o desenvolvimento.
> **Serve como prompt único para reconstruir o painel do zero.**

---

## 1. Objetivo

Dashboard em **React + Vite + Tailwind CSS** para monitoramento do nível do
**Rio dos Sinos em Campo Bom/RS**, com dados oficiais da ANA, previsão do tempo
por ECMWF e GFS, atualização automática, análise pluviométrica da bacia, mapas
interativos, consulta de risco por endereço e modelagem de cenário de alagamento.

**Stack:** React 19 · Vite · Tailwind 4 · Recharts · Leaflet + react-leaflet ·
lucide-react · fflate

---

## 2. Fontes de dados (endpoints validados)

### 2.1 Nível, vazão e chuva — Telemetria da ANA

```
https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos
  ?codEstacao=87380000&dataInicio=dd/MM/aaaa&dataFim=dd/MM/aaaa
```

| Campo | Observação |
|---|---|
| Estação | **87380000 — Campo Bom** (Rio dos Sinos), operada pelo SGB-CPRM |
| Retorno | XML com `CodEstacao · DataHora · Vazao · Nivel · Chuva` |
| Intervalo | 15 minutos |
| ⚠️ Unidade | **Nível vem em centímetros** — dividir por 100 |
| ⚠️ CORS | Não envia cabeçalhos — usar cadeia de proxies com *failover* |

Proxies em ordem: direto → `allorigins/raw` → `allorigins/get` → `corsproxy` → `codetabs`.

Aceita data final futura (útil para garantir a leitura mais recente).

### 2.2 Cotas oficiais (SGB)

| Cota | Valor |
|---|---|
| Atenção | 6,20 m |
| **Alerta** | **6,70 m** |
| **Inundação** | **7,20 m** |
| Recorde histórico | 8,56 m (04/05/2024) |

### 2.3 Limite da Bacia do Rio dos Sinos

```
https://www.snirh.gov.br/arcgis/rest/services/Divisoes_bacias_hidrograficas/FeatureServer/2
  /query?where=DMI_CD='10943225'&outSR=4326&f=geojson
```

Feição `DMI_NM = "Sinos"` · `DMI_CD = 10943225` · **3.708,89 km²**.
Baixar uma vez e **embutir o polígono no bundle** (EPSG:4326, generalizado ~400 m).

### 2.4 Inventário de estações

```
https://telemetriaws1.ana.gov.br/ServiceANA.asmx/HidroInventario
  ?tpEst=2&codSubBacia=87&telemetrica=1
```

⚠️ Estações do **CEMADEN / Defesa Civil-RS / SEMA-RS** constam do inventário
mas **não são servidas** pelo webservice de dados da ANA (retornam "sem dados").
Para elas, obter a chuva no **Open-Meteo nas coordenadas cadastradas**.

### 2.5 Demais serviços

| Uso | Serviço |
|---|---|
| Chuva horária | `api.open-meteo.com/v1/forecast` (`hourly=precipitation`) |
| Previsão do tempo | `api.open-meteo.com/v1/forecast` com `models=ecmwf_ifs025` e `models=gfs_seamless` |
| Chuva histórica | `archive-api.open-meteo.com/v1/archive` |
| Geocodificação | Nominatim/OpenStreetMap + BrasilAPI (CEP) |
| Elevação (principal) | `api.opentopodata.org/v1/srtm30m` com `interpolation=bilinear` |
| Elevação (reserva) | `api.open-meteo.com/v1/elevation` (Copernicus GLO-90) |

---

## 3. Estrutura do painel

1. Cabeçalho fixo
2. Cards de KPI + régua da estação
3. Gráfico da curva de elevação
4. Previsão do tempo em Campo Bom (ECMWF IFS + GFS, 5 dias)
5. Tabela de estações pluviométricas
6. Mapa da bacia + consulta de endereço
7. Modelagem de cenário de alagamento
8. Tabela de medições + ficha da estação
9. Rodapé

---

## 4. Requisitos por seção

### 4.1 Cabeçalho

- **Brasão da Prefeitura de Campo Bom** à esquerda, dentro de contêiner branco
  arredondado (a imagem é JPEG, sem transparência — sobre fundo escuro precisa
  do "selo" branco)
- Título, código da estação, bacia
- Badge "Ao vivo" pulsante · contador regressivo · botão Atualizar
- **Atualização automática a cada 5 minutos**, com revalidação ao voltar à aba

### 4.2 KPIs e régua

- Nível atual em destaque, com *glow* na cor do status
- **Tendência em cm/h** por regressão linear (janela de 3 h)
- Variação em 1 h e 24 h · distância até a cota de inundação
- Mini-cards: vazão, chuva da bacia 24 h, máx. e mín. do período

**Régua visual — 3 colunas:** `[valor flutuante] [régua] [legenda das cotas]`

> ⚠️ **Armadilhas de alinhamento**
> - O valor fica **à esquerda** — à direita ele cobre a legenda
> - Com `bottom: X%`, usar **`translate-y-1/2`** (para baixo).
>   `-translate-y-1/2` sobe o rótulo uma altura inteira acima da linha d'água
> - Aplicar `border-y border-transparent` nas colunas sem borda, para igualar
>   a caixa interna à da régua (que tem borda de 1 px)

### 4.3 Gráfico da curva de elevação

- Eixo X temporal (`scale="time"`), períodos **24h / 3d / 7d / 30d**
- Linhas de referência das 3 cotas + faixa vermelha da zona de inundação
- **Barras de chuva atrás da curva**: no `ComposedChart`, renderizar `<Bar>`
  **antes** do `<Area>`; eixo Y direito escalado para ocupar no máx. ~40% da altura
- Valor plotado = **média aritmética** das estações que responderam
- *Downsampling* que preserva picos (não achatar a subida)
- Tooltip com nível, vazão, chuva média e leitura instrumental de Campo Bom

### 4.4 Previsão meteorológica em Campo Bom

- Seção pública posicionada imediatamente abaixo do gráfico da curva de elevação
- Previsão diária de **5 dias** para Campo Bom/RS nas coordenadas `-29.6917, -51.0461`
- Consultas independentes ao Open-Meteo para os modelos **ECMWF IFS** (`ecmwf_ifs025`)
  e **GFS** (`gfs_seamless`), sem exigir chave de API
- Exibe condição atual estimada, temperatura, sensação térmica, umidade, vento,
  precipitação, probabilidade de chuva e acumulado diário em cartões separados
- Um modelo indisponível não impede a exibição do outro; atualização manual e automática a cada 15 minutos
- A seção identifica a fonte Open-Meteo e informa que as previsões são estimativas,
  não substituindo avisos oficiais da Defesa Civil

### 4.5 Tabela de estações pluviométricas

Campo Bom + 5 a montante: **Sapiranga · Nova Hartz/Araricá · Parobé · Taquara · Rolante**

Colunas: estação · município · código ANA · operador · posição (km a montante) ·
acumulado no período · última hora · **origem do dado**.

Distinguir com selo: `Telemetria ANA (medido)` × `Open-Meteo @ coord. da estação`,
com nota de metodologia explicando por que cada série vem de onde vem.

### 4.6 Mapa (Leaflet + react-leaflet)

- **Bases:** Google Streets (padrão) · Google Híbrido · Google Relevo · OSM
- **Delimitação pelo polígono real da bacia** (não por raio), com filtro
  *ponto-em-polígono* — só entram estações efetivamente dentro da bacia
- Marcadores proporcionais à chuva (√ do acumulado), **raio de 2 a 6 px**
  e halo de 1.200 m — pequenos, para não se sobreporem
- Escala de cores por intensidade + legenda
- Camada **"Mancha da grande inundação de 2024"**, toggleável, com a
  **geometria embarcada no bundle**
- `LayersControl` preparado para camadas futuras (radar, isoietas, áreas de risco)
- Botões de enquadramento: **Bacia · Inundação · Endereço**
- CSS do Leaflet adaptado ao tema escuro; `z-index: 0` para não conflitar com o header

### 4.7 Consulta de endereço e alerta de risco

**Título:** *"Consulte um endereço para saber se você se encontra em área de
risco de alagamentos"*

- Campo aceita **endereço, CEP e coordenadas**; autocomplete com debounce de 550 ms
- Busca em duas passadas (região do Vale do Sinos → Brasil), informando a
  qualidade: *endereço exato · via/rua · aproximado*
- ❌ **Sem geolocalização por GPS** — foi implementada, testada e **descartada**
  por imprecisão insuficiente para decidir risco

**Regra do alerta — as duas condições simultâneas:**

1. Endereço **dentro** da mancha de 2024, **E**
2. Nível do rio **≥ 6,70 m** (cota de alerta)

| Situação | Resultado |
|---|---|
| Dentro + rio em alerta | 🔴 **Pop-up modal + card vermelho** |
| Dentro + rio abaixo | 🔵 Informa, **sem alarme** |
| Fora da mancha | 🟢 Informa + distância até a borda |

**Pop-up modal centralizado** (dispara automaticamente):
- Título: *"Você está em uma área propensa a alagamentos"*
- Explica que, segundo a mancha de 2024, o endereço está na área atingida e o
  rio está na zona de alerta **neste momento**
- Nível atual, cota de alerta e tendência
- Orientação: **procurar abrigo seguro**, ir para local elevado, afastar-se da
  margem, retirar documentos das áreas baixas
- **Defesa Civil de Campo Bom — (51) 3597-3683** em botão grande, clicável (`tel:`)
- Fecha com ESC, clique no fundo ou botão; **não reabre a cada refresh**
  (controlado por chave do endereço); botão "Ver alerta" para reabrir

### 4.8 Modelagem de cenário de alagamento (experimental)

**Cadeia:** chuva → escoamento → vazão → cota → mancha

**1. Chuva → escoamento**
- Método **SCS-Curve Number** (CN 74 de referência, AMC II)
- **Ajuste de AMC** pela chuva dos 5 dias antecedentes
  (`<35 mm` → AMC I · `>53 mm` → AMC III). Solo saturado gera ~3× mais escoamento
- **Seletor de janela 24 h / 48 h** + slider de chuva de projeto (0–300 mm)
  com presets, incluindo o observado real

**2. Escoamento → vazão**

> ⚠️ **Calibração obrigatória pelo evento de 2024** — sem ela o modelo
> superestima a vazão em **~6×**

Dados reais da telemetria da ANA (27/04 a 06/05/2024):

| Parâmetro | Valor |
|---|---|
| Base pré-evento | 2,30 m → 41,7 m³/s |
| **Pico** | **8,56 m → 779,5 m³/s** |
| Chuva 48 h antes do pico | 102,5 mm |
| Chuva antecedente (5 d) | 122,1 mm |

Derivar o coeficiente de pico do próprio evento: `ΔQ = K · R · A`
→ **tempo de base ≈ 146 h**.

O hidrograma triangular clássico do SCS assume ~22 h e **não vale** para esta
bacia (2.900 km², 190 km de curso, forte amortecimento de planície — o pico de
2024 levou ~6 dias para se formar).

**3. Vazão → cota**
- Curva-chave `Q = a·(H − h₀)^b`, ajuste por mínimos quadrados em escala log
- **Ancorada nos pares (H,Q) observados de 2024**, de 5,85 m até o pico —
  faixa que a série ao vivo (6–7 m) não alcança
- Combinada com amostragem das leituras atuais

**4. Cota → mancha**
- Comparação com o MDE + ***flood fill* de conectividade hidráulica**
  (evita "piscinas" isoladas sem ligação com o rio)
- **Datum calibrado** pela mediana da elevação na borda da mancha de 2024
  (amarra régua ↔ MDE em um evento real)

**Interface**
- **Painel de aferição** visível: simulado × observado de 2024, com erro em metros
- Recorte **restrito ao município de Campo Bom**
- Seletor de qualidade: *Detalhado* (SRTM 30 m, ~1 min) × *Rápido* (GLO-90)
- Malha em **cache no navegador** — baixada uma única vez por dispositivo
- Mapa de lâmina d'água em 6 faixas de profundidade + mancha de 2024 como referência
- Tabela de bases topográficas com hierarquia de preferência
- ⚠️ **Aviso destacado: solução provisória, de cunho de teste.** Não substitui
  modelagem hidrodinâmica (HEC-RAS / MGB-IPH) nem os alertas da Defesa Civil

---

## 5. Bases topográficas — hierarquia

| # | Base | Resolução | Situação |
|---|---|---|---|
| 1 | MDT Multiescalas RS (`dem_me_rs_20m.tif`) | 20 m | ❌ Indisponível |
| 2 | WorldDEM Neo — Guaíba | 5 m | ❌ Licença restrita |
| 3 | **SRTM 1 arc-second** | **30 m** | ✅ **Em uso** |
| 4 | Copernicus DEM GLO-90 | 90 m | ✅ Reserva automática |

> **Investigação do MDT Multiescalas (testado e descartado):**
> o arquivo publicado é **20 m** — a componente RF1 de 2,5 m (cartografia
> 1:25.000) **não é distribuída isoladamente**. É um raster **estadual**
> (−57,7° a −48,6° / −34,6° a −26,0°), da ordem de **gigabytes**, em Albers
> (ESRI:102033), **sem WCS/ImageServer**, e o servidor do SNIRH **recusa acesso
> externo (HTTP 403)**. O ganho sobre o SRTM de 30 m seria marginal.
>
> A hierarquia está pronta: havendo um recorte municipal em GeoTIFF ou um WCS,
> basta registrá-lo no topo da lista que o modelo passa a usá-lo automaticamente.

---

## 6. Design

- **Modo escuro** com base `slate-950`
- Cards de vidro fosco (`slate-900/70` + blur + ring sutil)
- Brilho ambiente azulado em radial-gradient no topo
- Header fixo translúcido com `backdrop-blur`
- Números tabulares (`tabular-nums`) em todas as métricas
- Ícones **lucide-react**
- Paleta de status calibrada para fundo escuro (tons 300/400)
- Scrollbar, `color-scheme` e seleção de texto no tema escuro
- **Todo o conteúdo em português (pt-BR)**, com vírgula decimal

---

## 7. Armadilhas a evitar

| Item | Correção |
|---|---|
| Cota de inundação | É **7,20 m** (não 6,80 m) |
| Nível da ANA | Vem em **centímetros** |
| Dados simulados | **Nunca** usar fallback fictício — se falhar, avisar o usuário |
| Camadas externas (KML/KMZ) | **Embutir** a geometria no bundle; Drive é instável |
| APIs públicas | Requisições **sequenciais com pausa** — paralelas causam *rate limit* |
| Modelagem hidrológica | Sempre **calibrar pelo evento de 2024** |
| Régua visual | Valor à esquerda + `translate-y-1/2` + bordas equalizadas |
| Marcadores do mapa | Raios pequenos (2–6 px) para não se sobreporem |
| Geolocalização GPS | Descartada — usar consulta por endereço |
| MDT RS 2,5 m | Não existe publicamente; o distribuído é 20 m e retorna 403 |

---

## 8. Contatos de emergência

| Órgão | Telefone |
|---|---|
| **Defesa Civil de Campo Bom** | **(51) 3597-3683** |
| Defesa Civil (nacional) | 199 |
| Corpo de Bombeiros | 193 |
| SAMU | 192 |

---

## 9. Estrutura de arquivos

```
src/
├── App.tsx                        # composição do painel e estado global
├── index.css                      # tema escuro + estilos do Leaflet
├── lib/
│   ├── ana.ts                     # telemetria da ANA, cotas, análises
│   ├── basin.ts                   # polígono da bacia + ponto-em-polígono
│   ├── rain.ts                    # estações pluviométricas e médias
│   ├── flood.ts                   # camadas de inundação e risco
│   ├── floodData.ts               # geometria da mancha de 2024 (embarcada)
│   ├── floodModel.ts              # modelagem hidrológica e terreno
│   ├── geocode.ts                 # Nominatim + BrasilAPI
│   └── weather.ts                 # previsão Campo Bom: ECMWF IFS + GFS
└── components/
    ├── Brasao.tsx                 # brasão com cadeia de fallback
    ├── RiverChart.tsx             # curva de elevação + barras de chuva
    ├── LevelGauge.tsx             # régua visual da estação
    ├── RainMap.tsx                # mapa da bacia
    ├── AddressRisk.tsx            # consulta de endereço
    ├── FloodAlertModal.tsx        # pop-up de alerta
    ├── WeatherForecast.tsx        # previsão diária ECMWF + GFS
    └── FloodForecast.tsx          # modelagem de cenário
```

---

## 10. Créditos e fontes

- **Nível e vazão:** [ANA — Sistema de Telemetria Hidrometeorológica](https://www.snirh.gov.br/hidrotelemetria/), estação 87380000, operada pelo SGB-CPRM
- **Limite da bacia:** ANA — Divisão Hidrográfica Nacional (`DMI_CD 10943225`)
- **Mancha de inundação 2024:** Prefeitura Municipal de Campo Bom
- **Chuva:** Open-Meteo (ECMWF / ERA5) nas coordenadas das estações da ANA
- **Previsão do tempo:** Open-Meteo · modelos ECMWF IFS e NOAA GFS · coordenadas de Campo Bom
- **Elevação:** NASA/USGS SRTM · ESA/Airbus Copernicus DEM
- **Endereços:** Nominatim/OpenStreetMap · BrasilAPI
- **Mapas base:** Google Maps · OpenStreetMap

---

*Este painel é um produto técnico de apoio. **Não substitui os alertas oficiais
da Defesa Civil.** Em emergência, ligue 199 ou 193.*
