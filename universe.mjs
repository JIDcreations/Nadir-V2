// The watch universe: established companies with multi-year track records.
// Nadir V1 tracked speculative small caps; V2 looks for quality that stumbled,
// so the list leans toward proven compounders across the US, Europe and Asia.
// s = Yahoo symbol, n = display name, sec = sector key, reg = region

export const SECTORS = {
  TECH: 'Technology',
  SEMI: 'Semiconductors',
  COMM: 'Communication',
  CONS: 'Consumer',
  HLTH: 'Healthcare',
  FIN:  'Financials',
  IND:  'Industrials',
  ENER: 'Energy & Materials',
};

// Benchmark per sector, used to tell a company-specific fall from a sector-wide one.
export const SECTOR_ETF = {
  TECH: 'XLK', SEMI: 'SOXX', COMM: 'XLC', CONS: 'XLY',
  HLTH: 'XLV', FIN: 'XLF', IND: 'XLI', ENER: 'XLE',
};

export const BENCHMARKS = [
  { s: '^GSPC',     n: 'S&P 500' },
  { s: '^NDX',      n: 'Nasdaq 100' },
  { s: '^STOXX50E', n: 'Euro Stoxx 50' },
  { s: '^BFX',      n: 'BEL 20' },
  { s: '^N225',     n: 'Nikkei 225' },
  { s: '^VIX',      n: 'VIX' },
];

const U = (reg, sec, list) => list.map(([s, n]) => ({ s, n, sec, reg }));

export const UNIVERSE = [
  ...U('US', 'TECH', [
    ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['ORCL', 'Oracle'], ['CRM', 'Salesforce'],
    ['ADBE', 'Adobe'], ['NOW', 'ServiceNow'], ['INTU', 'Intuit'], ['PANW', 'Palo Alto Networks'],
    ['CRWD', 'CrowdStrike'], ['FTNT', 'Fortinet'], ['SNPS', 'Synopsys'], ['CDNS', 'Cadence Design'],
    ['PLTR', 'Palantir'], ['ANET', 'Arista Networks'], ['DDOG', 'Datadog'], ['NET', 'Cloudflare'],
    ['SHOP', 'Shopify'], ['ZS', 'Zscaler'], ['WDAY', 'Workday'], ['ADSK', 'Autodesk'],
    ['APP', 'AppLovin'], ['DELL', 'Dell Technologies'], ['IBM', 'IBM'], ['FICO', 'Fair Isaac'],
  ]),
  ...U('US', 'SEMI', [
    ['NVDA', 'Nvidia'], ['AVGO', 'Broadcom'], ['AMD', 'AMD'], ['QCOM', 'Qualcomm'],
    ['TXN', 'Texas Instruments'], ['MU', 'Micron'], ['AMAT', 'Applied Materials'], ['LRCX', 'Lam Research'],
    ['KLAC', 'KLA'], ['MRVL', 'Marvell'], ['MPWR', 'Monolithic Power'], ['ARM', 'Arm Holdings'],
    ['TSM', 'TSMC'], ['VRT', 'Vertiv'], ['SMCI', 'Super Micro'],
  ]),
  ...U('US', 'COMM', [
    ['GOOGL', 'Alphabet'], ['META', 'Meta Platforms'], ['NFLX', 'Netflix'], ['SPOT', 'Spotify'],
    ['TMUS', 'T-Mobile US'], ['DIS', 'Disney'], ['TTWO', 'Take-Two'], ['RDDT', 'Reddit'],
  ]),
  ...U('US', 'CONS', [
    ['AMZN', 'Amazon'], ['TSLA', 'Tesla'], ['COST', 'Costco'], ['WMT', 'Walmart'],
    ['HD', 'Home Depot'], ['MCD', "McDonald's"], ['NKE', 'Nike'], ['SBUX', 'Starbucks'],
    ['CMG', 'Chipotle'], ['LULU', 'Lululemon'], ['BKNG', 'Booking Holdings'], ['ABNB', 'Airbnb'],
    ['UBER', 'Uber'], ['MELI', 'MercadoLibre'], ['DECK', 'Deckers'], ['ONON', 'On Holding'],
    ['TJX', 'TJX Companies'], ['ORLY', "O'Reilly Automotive"], ['PG', 'Procter & Gamble'], ['KO', 'Coca-Cola'],
    ['CELH', 'Celsius'], ['ELF', 'e.l.f. Beauty'], ['DPZ', "Domino's"], ['RACE', 'Ferrari'],
  ]),
  ...U('US', 'HLTH', [
    ['LLY', 'Eli Lilly'], ['UNH', 'UnitedHealth'], ['ISRG', 'Intuitive Surgical'], ['VRTX', 'Vertex'],
    ['REGN', 'Regeneron'], ['TMO', 'Thermo Fisher'], ['DHR', 'Danaher'], ['ABBV', 'AbbVie'],
    ['JNJ', 'Johnson & Johnson'], ['MRK', 'Merck'], ['BSX', 'Boston Scientific'], ['SYK', 'Stryker'],
    ['DXCM', 'Dexcom'], ['IDXX', 'IDEXX'], ['HIMS', 'Hims & Hers'], ['ELV', 'Elevance Health'],
  ]),
  ...U('US', 'FIN', [
    ['JPM', 'JPMorgan Chase'], ['V', 'Visa'], ['MA', 'Mastercard'], ['GS', 'Goldman Sachs'],
    ['MS', 'Morgan Stanley'], ['BLK', 'BlackRock'], ['SPGI', 'S&P Global'], ['MCO', "Moody's"],
    ['AXP', 'American Express'], ['PGR', 'Progressive'], ['KKR', 'KKR'], ['BX', 'Blackstone'],
    ['COIN', 'Coinbase'], ['HOOD', 'Robinhood'], ['PYPL', 'PayPal'], ['BRK-B', 'Berkshire Hathaway'],
    ['ICE', 'Intercontinental Exch.'], ['NU', 'Nu Holdings'],
  ]),
  ...U('US', 'IND', [
    ['GE', 'GE Aerospace'], ['CAT', 'Caterpillar'], ['DE', 'Deere'], ['ETN', 'Eaton'],
    ['URI', 'United Rentals'], ['PWR', 'Quanta Services'], ['UNP', 'Union Pacific'], ['LMT', 'Lockheed Martin'],
    ['RTX', 'RTX'], ['TT', 'Trane Technologies'], ['CTAS', 'Cintas'], ['AXON', 'Axon Enterprise'],
    ['CPRT', 'Copart'], ['ODFL', 'Old Dominion'], ['GEV', 'GE Vernova'], ['HWM', 'Howmet Aerospace'],
  ]),
  ...U('US', 'ENER', [
    ['XOM', 'ExxonMobil'], ['CVX', 'Chevron'], ['LIN', 'Linde'], ['SHW', 'Sherwin-Williams'],
    ['FCX', 'Freeport-McMoRan'], ['NEE', 'NextEra Energy'], ['CEG', 'Constellation Energy'], ['VST', 'Vistra'],
  ]),

  // Europe
  ...U('EU', 'SEMI', [['ASML.AS', 'ASML'], ['ASM.AS', 'ASM International'], ['BESI.AS', 'BE Semiconductor'], ['IFX.DE', 'Infineon']]),
  ...U('EU', 'TECH', [['SAP.DE', 'SAP'], ['ADYEN.AS', 'Adyen'], ['DSY.PA', 'Dassault Systèmes'], ['CAP.PA', 'Capgemini']]),
  ...U('EU', 'HLTH', [
    ['NOVO-B.CO', 'Novo Nordisk'], ['AZN.L', 'AstraZeneca'], ['NOVN.SW', 'Novartis'], ['RO.SW', 'Roche'],
    ['ARGX.BR', 'argenx'], ['UCB.BR', 'UCB'], ['SAN.PA', 'Sanofi'], ['EL.PA', 'EssilorLuxottica'],
    ['LONN.SW', 'Lonza'], ['GMAB.CO', 'Genmab'],
  ]),
  ...U('EU', 'CONS', [
    ['MC.PA', 'LVMH'], ['RMS.PA', 'Hermès'], ['OR.PA', "L'Oréal"], ['CFR.SW', 'Richemont'],
    ['ITX.MC', 'Inditex'], ['ABI.BR', 'AB InBev'], ['NESN.SW', 'Nestlé'], ['RACE.MI', 'Ferrari (Milan)'],
    ['ADS.DE', 'Adidas'], ['DIE.BR', "D'Ieteren"],
  ]),
  ...U('EU', 'FIN', [
    ['ALV.DE', 'Allianz'], ['KBC.BR', 'KBC Group'], ['INGA.AS', 'ING'], ['UCG.MI', 'UniCredit'],
    ['GBLB.BR', 'GBL'], ['SOF.BR', 'Sofina'], ['LSEG.L', 'London Stock Exchange'], ['WKL.AS', 'Wolters Kluwer'],
  ]),
  ...U('EU', 'IND', [
    ['SIE.DE', 'Siemens'], ['AIR.PA', 'Airbus'], ['SAF.PA', 'Safran'], ['RHM.DE', 'Rheinmetall'],
    ['SU.PA', 'Schneider Electric'], ['ABBN.SW', 'ABB'], ['ATCO-A.ST', 'Atlas Copco'], ['DSV.CO', 'DSV'],
    ['REL.L', 'RELX'], ['ACKB.BR', 'Ackermans & van Haaren'], ['LOTB.BR', 'Lotus Bakeries'],
  ]),
  ...U('EU', 'ENER', [['SHEL.L', 'Shell'], ['TTE.PA', 'TotalEnergies'], ['AI.PA', 'Air Liquide'], ['SYENS.BR', 'Syensqo']]),

  // Asia
  ...U('ASIA', 'TECH', [['6758.T', 'Sony'], ['9984.T', 'SoftBank Group'], ['SE', 'Sea Limited']]),
  ...U('ASIA', 'SEMI', [['8035.T', 'Tokyo Electron'], ['6857.T', 'Advantest'], ['005930.KS', 'Samsung Electronics'], ['000660.KS', 'SK hynix']]),
  ...U('ASIA', 'CONS', [['7203.T', 'Toyota'], ['7974.T', 'Nintendo'], ['9983.T', 'Fast Retailing'], ['BABA', 'Alibaba'], ['PDD', 'PDD Holdings']]),
  ...U('ASIA', 'IND', [['6861.T', 'Keyence'], ['6501.T', 'Hitachi']]),
  ...U('ASIA', 'COMM', [['0700.HK', 'Tencent']]),
  ...U('ASIA', 'FIN', [['8306.T', 'Mitsubishi UFJ']]),
];
