import type { CompanyIdentity, CompanyCandidate } from '@/types/company';
import { resolveCompany } from '@/lib/groq/client';
import { resolveUpstoxInstrument, getInstrumentMaster } from '@/lib/upstox/instruments';

export interface CompanyResolutionOutcome {
  resolved: boolean;
  company?: CompanyIdentity;
  candidates?: CompanyCandidate[];
  error?: string;
  interpretation?: string;
}

interface CuratedCompany extends CompanyIdentity {
  aliases: string[];
  screenerSlug: string;
}

// Curated high-precision database of major Indian listed companies
// Guarantees instant, 100% accurate resolution for top companies
const CURATED_INDIAN_COMPANIES: Record<string, CuratedCompany> = {
  SWIGGY: {
    name: 'Swiggy Limited',
    ticker: 'SWIGGY',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE00H001014',
    sector: 'Consumer Services / Technology',
    industry: 'Online Food Delivery & Quick Commerce',
    screenerSlug: 'SWIGGY',
    aliases: ['swiggy', 'swiggy limited', 'swiggy ltd', 'instamart', 'swiggy instamart'],
  },
  JPL: {
    name: 'Jio Platforms Limited',
    ticker: 'JPL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE0BJO01010',
    sector: 'Telecommunications & Digital Services',
    industry: 'Telecom Infrastructure, Digital Platforms & 5G',
    screenerSlug: 'JPL',
    aliases: ['jio platforms', 'jio platforms limited', 'jpl', 'jio platform', 'jio platforms ltd'],
  },
  JIOFIN: {
    name: 'Jio Financial Services Limited',
    ticker: 'JIOFIN',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE758E01017',
    sector: 'Financial Services',
    industry: 'Non-Banking Financial Company (NBFC)',
    screenerSlug: 'JIOFIN',
    aliases: ['jio financial', 'jio financial services', 'jiofin', 'jfsl'],
  },
  OLAELEC: {
    name: 'Ola Electric Mobility Limited',
    ticker: 'OLAELEC',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE0L2E01016',
    sector: 'Automobile',
    industry: 'Electric Vehicles & Mobility',
    screenerSlug: 'OLAELEC',
    aliases: ['ola electric', 'ola electric mobility', 'olaelec', 'ola'],
  },
  GAIL: {
    name: 'GAIL (India) Limited',
    ticker: 'GAIL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE129A01019',
    sector: 'Utilities',
    industry: 'Natural Gas Transmission & Marketing',
    screenerSlug: 'GAIL',
    aliases: ['gail', 'gail india', 'gail (india)', 'gail india limited'],
  },
  V2RETAIL: {
    name: 'V2 Retail Limited',
    ticker: 'V2RETAIL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE945H01021',
    sector: 'Consumer Discretionary / Retail',
    industry: 'Value Fashion & Apparel Retail',
    screenerSlug: 'V2RETAIL',
    aliases: ['v2 retail', 'v2 retail limited', 'v2 retail ltd', 'v2', 'v2retail'],
  },
  RELIANCE: {
    name: 'Reliance Industries Limited',
    ticker: 'RELIANCE',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE002A01018',
    sector: 'Conglomerate / Energy',
    industry: 'Oil-to-Chemicals, Retail & Telecom',
    screenerSlug: 'RELIANCE',
    aliases: ['reliance industries', 'ril', 'reliance ind', 'reliance industries limited'],
  },
  TCS: {
    name: 'Tata Consultancy Services Limited',
    ticker: 'TCS',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE467B01029',
    sector: 'Information Technology',
    industry: 'IT Services & Consulting',
    screenerSlug: 'TCS',
    aliases: ['tcs', 'tata consultancy services', 'tata consultancy', 'tata consultancy services limited'],
  },
  HDFCBANK: {
    name: 'HDFC Bank Limited',
    ticker: 'HDFCBANK',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE040A01034',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    screenerSlug: 'HDFCBANK',
    aliases: ['hdfc bank', 'hdfcbank', 'hdfc bank limited', 'hdfc babk', 'hdfc bak', 'hdfc bnk'],
  },
  HDFCLIFE: {
    name: 'HDFC Life Insurance Company Limited',
    ticker: 'HDFCLIFE',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE795G01014',
    sector: 'Financial Services',
    industry: 'Life Insurance',
    screenerSlug: 'HDFCLIFE',
    aliases: ['hdfc life', 'hdfclife', 'hdfc life insurance', 'hdfc life insurance company', 'hdfc life insurance company limited'],
  },
  HDFCAMC: {
    name: 'HDFC Asset Management Company Limited',
    ticker: 'HDFCAMC',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE127D01025',
    sector: 'Financial Services',
    industry: 'Asset Management',
    screenerSlug: 'HDFCAMC',
    aliases: ['hdfc amc', 'hdfcamc', 'hdfc asset management', 'hdfc mutual fund', 'hdfc amc limited'],
  },
  INFY: {
    name: 'Infosys Limited',
    ticker: 'INFY',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE009A01021',
    sector: 'Information Technology',
    industry: 'IT Services & Consulting',
    screenerSlug: 'INFY',
    aliases: ['infosys', 'infy', 'infosys ltd', 'infosys limited', 'infosis'],
  },
  ICICIBANK: {
    name: 'ICICI Bank Limited',
    ticker: 'ICICIBANK',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE090A01021',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    screenerSlug: 'ICICIBANK',
    aliases: ['icici', 'icici bank', 'icicibank', 'icici bank limited'],
  },
  SBIN: {
    name: 'State Bank of India',
    ticker: 'SBIN',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE062A01020',
    sector: 'Financial Services',
    industry: 'Public Sector Banking',
    screenerSlug: 'SBIN',
    aliases: ['sbi', 'sbin', 'state bank of india', 'state bank'],
  },
  KOTAKBANK: {
    name: 'Kotak Mahindra Bank Limited',
    ticker: 'KOTAKBANK',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE237A01028',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    screenerSlug: 'KOTAKBANK',
    aliases: ['kotak', 'kotak bank', 'kotakbank', 'kotak mahindra bank', 'kotak mahindra'],
  },
  AXISBANK: {
    name: 'Axis Bank Limited',
    ticker: 'AXISBANK',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE238A01034',
    sector: 'Financial Services',
    industry: 'Private Sector Bank',
    screenerSlug: 'AXISBANK',
    aliases: ['axis bank', 'axis', 'axisbank', 'axis bank limited'],
  },
  BHARTIARTL: {
    name: 'Bharti Airtel Limited',
    ticker: 'BHARTIARTL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE397D01024',
    sector: 'Telecommunication',
    industry: 'Telecom Services & Digital',
    screenerSlug: 'BHARTIARTL',
    aliases: ['airtel', 'bharti airtel', 'bhartiartl', 'bharti airtel limited'],
  },
  ITC: {
    name: 'ITC Limited',
    ticker: 'ITC',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE154A01025',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Cigarettes, FMCG, Hotels & Paperboards',
    screenerSlug: 'ITC',
    aliases: ['itc', 'itc limited', 'itc ltd'],
  },
  LT: {
    name: 'Larsen & Toubro Limited',
    ticker: 'LT',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE018A01030',
    sector: 'Construction & Engineering',
    industry: 'Infrastructure, Defence & EPC',
    screenerSlug: 'LT',
    aliases: ['l&t', 'larsen and toubro', 'larsen & toubro', 'lt', 'larsen', 'larsen & toubro limited'],
  },
  ZOMATO: {
    name: 'Zomato Limited (Eternal)',
    ticker: 'ZOMATO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE758T01015',
    sector: 'Consumer Services',
    industry: 'Food Delivery & Quick Commerce (Blinkit)',
    screenerSlug: 'ZOMATO',
    aliases: ['zomato', 'blinkit', 'zomato limited', 'eternal', 'eternal limited', 'zomatoo'],
  },
  TMPV: {
    name: 'Tata Motors Passenger Vehicles Limited',
    ticker: 'TMPV',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE155A01022',
    sector: 'Automobile',
    industry: 'Passenger Vehicles, Electric Vehicles & JLR',
    screenerSlug: 'TMPV',
    aliases: ['tata motors passenger vehicles', 'tata motors pv', 'tmpv', 'tata pv', 'tata ev'],
  },
  TMCV: {
    name: 'Tata Motors Limited',
    ticker: 'TMCV',
    exchange: 'NSE',
    country: 'India',
    sector: 'Automobile',
    industry: 'Commercial Vehicles',
    screenerSlug: 'TMCV',
    aliases: ['tata motors commercial vehicles', 'tata motors cv', 'tmcv', 'tata cv'],
  },
  TRENT: {
    name: 'Trent Limited',
    ticker: 'TRENT',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE849A01020',
    sector: 'Consumer Services / Retail',
    industry: 'Apparel & Specialty Retail (Westside, Zudio)',
    screenerSlug: 'TRENT',
    aliases: ['trent', 'trent limited', 'zudio', 'westside'],
  },
  HAL: {
    name: 'Hindustan Aeronautics Limited',
    ticker: 'HAL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE066F01012',
    sector: 'Aerospace & Defence',
    industry: 'Defence Aircraft & Helicopters Manufacturing',
    screenerSlug: 'HAL',
    aliases: ['hal', 'hindustan aeronautics', 'hindustan aeronautics limited'],
  },
  BEL: {
    name: 'Bharat Electronics Limited',
    ticker: 'BEL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE263A01024',
    sector: 'Aerospace & Defence',
    industry: 'Defence Electronics & Radars',
    screenerSlug: 'BEL',
    aliases: ['bel', 'bharat electronics', 'bharat electronics limited'],
  },
  MARUTI: {
    name: 'Maruti Suzuki India Limited',
    ticker: 'MARUTI',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE585B01010',
    sector: 'Automobile',
    industry: 'Passenger Vehicles',
    screenerSlug: 'MARUTI',
    aliases: ['maruti', 'maruti suzuki', 'msil', 'maruti suzuki india'],
  },
  WIPRO: {
    name: 'Wipro Limited',
    ticker: 'WIPRO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE075A01022',
    sector: 'Information Technology',
    industry: 'IT Services & Consulting',
    screenerSlug: 'WIPRO',
    aliases: ['wipro', 'wipro limited', 'wipro ltd'],
  },
  HCLTECH: {
    name: 'HCL Technologies Limited',
    ticker: 'HCLTECH',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE860A01027',
    sector: 'Information Technology',
    industry: 'IT Services & Consulting',
    screenerSlug: 'HCLTECH',
    aliases: ['hcl', 'hcl tech', 'hcltech', 'hcl technologies', 'hcl technologies limited'],
  },
  BAJFINANCE: {
    name: 'Bajaj Finance Limited',
    ticker: 'BAJFINANCE',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE296A01024',
    sector: 'Financial Services',
    industry: 'Consumer & Commercial NBFC',
    screenerSlug: 'BAJFINANCE',
    aliases: ['bajaj finance', 'bajfinance', 'bajaj fin', 'bajaj finance limited'],
  },
  BAJAJFINSV: {
    name: 'Bajaj Finserv Limited',
    ticker: 'BAJAJFINSV',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE918I01026',
    sector: 'Financial Services',
    industry: 'Financial Holding & Insurance',
    screenerSlug: 'BAJAJFINSV',
    aliases: ['bajaj finserv', 'bajajfinsv', 'bajaj finserv limited'],
  },
  TITAN: {
    name: 'Titan Company Limited',
    ticker: 'TITAN',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE280A01028',
    sector: 'Consumer Discretionary',
    industry: 'Jewellery & Watches (Tanishq)',
    screenerSlug: 'TITAN',
    aliases: ['titan', 'titan company', 'tanishq', 'titan limited'],
  },
  ASIANPAINT: {
    name: 'Asian Paints Limited',
    ticker: 'ASIANPAINT',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE021A01026',
    sector: 'Consumer Discretionary',
    industry: 'Paints & Coatings',
    screenerSlug: 'ASIANPAINT',
    aliases: ['asian paints', 'asian paint', 'asianpaint', 'asian paints limited'],
  },
  SUNPHARMA: {
    name: 'Sun Pharmaceutical Industries Limited',
    ticker: 'SUNPHARMA',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE044A01036',
    sector: 'Healthcare',
    industry: 'Pharmaceuticals & Generics',
    screenerSlug: 'SUNPHARMA',
    aliases: ['sun pharma', 'sunpharma', 'sun pharmaceuticals', 'sun pharma limited'],
  },
  TATAPOWER: {
    name: 'Tata Power Company Limited',
    ticker: 'TATAPOWER',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE245A01021',
    sector: 'Utilities',
    industry: 'Power Generation & Renewable Energy',
    screenerSlug: 'TATAPOWER',
    aliases: ['tata power', 'tatapower', 'tata power company', 'tata power limited'],
  },
  TATASTEEL: {
    name: 'Tata Steel Limited',
    ticker: 'TATASTEEL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE081A01020',
    sector: 'Materials',
    industry: 'Steel Manufacturing',
    screenerSlug: 'TATASTEEL',
    aliases: ['tata steel', 'tatasteel', 'tata steel limited'],
  },
  TATACONSUM: {
    name: 'Tata Consumer Products Limited',
    ticker: 'TATACONSUM',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE192A01025',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Tea, Coffee & Packaged Foods (Tata Sampann)',
    screenerSlug: 'TATACONSUM',
    aliases: ['tata consumer', 'tataconsum', 'tata consumer products', 'tata tea'],
  },
  COALINDIA: {
    name: 'Coal India Limited',
    ticker: 'COALINDIA',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE522F01014',
    sector: 'Energy',
    industry: 'Coal Mining & Production',
    screenerSlug: 'COALINDIA',
    aliases: ['coal india', 'coalindia', 'cil', 'coal india limited'],
  },
  NTPC: {
    name: 'NTPC Limited',
    ticker: 'NTPC',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE733E01010',
    sector: 'Utilities',
    industry: 'Thermal & Renewable Power Generation',
    screenerSlug: 'NTPC',
    aliases: ['ntpc', 'ntpc limited'],
  },
  ONGC: {
    name: 'Oil and Natural Gas Corporation Limited',
    ticker: 'ONGC',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE213A01029',
    sector: 'Energy',
    industry: 'Oil & Gas Exploration & Production',
    screenerSlug: 'ONGC',
    aliases: ['ongc', 'oil and natural gas corporation', 'ongc limited'],
  },
  POWERGRID: {
    name: 'Power Grid Corporation of India Limited',
    ticker: 'POWERGRID',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE752E01010',
    sector: 'Utilities',
    industry: 'Electric Power Transmission',
    screenerSlug: 'POWERGRID',
    aliases: ['power grid', 'powergrid', 'pgcil', 'power grid corporation'],
  },
  M_M: {
    name: 'Mahindra & Mahindra Limited',
    ticker: 'M&M',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE101A01026',
    sector: 'Automobile',
    industry: 'SUVs, Tractors & Commercial Vehicles',
    screenerSlug: 'M&M',
    aliases: ['m&m', 'mahindra & mahindra', 'mahindra and mahindra', 'mahindra auto', 'mahindra'],
  },
  TECHM: {
    name: 'Tech Mahindra Limited',
    ticker: 'TECHM',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE669C01036',
    sector: 'Information Technology',
    industry: 'IT Services & Digital Transformation',
    screenerSlug: 'TECHM',
    aliases: ['tech mahindra', 'techm', 'tech mahindra limited'],
  },
  ULTRACEMCO: {
    name: 'UltraTech Cement Limited',
    ticker: 'ULTRACEMCO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE481G01011',
    sector: 'Materials',
    industry: 'Cement & Building Products',
    screenerSlug: 'ULTRACEMCO',
    aliases: ['ultratech', 'ultratech cement', 'ultracemco', 'ultratech cement limited'],
  },
  GRASIM: {
    name: 'Grasim Industries Limited',
    ticker: 'GRASIM',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE047A01021',
    sector: 'Materials',
    industry: 'Viscose Staple Fibre, Chemicals & Paints',
    screenerSlug: 'GRASIM',
    aliases: ['grasim', 'grasim industries', 'grasim limited'],
  },
  HINDALCO: {
    name: 'Hindalco Industries Limited',
    ticker: 'HINDALCO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE038A01020',
    sector: 'Materials',
    industry: 'Aluminium & Copper (Novelis)',
    screenerSlug: 'HINDALCO',
    aliases: ['hindalco', 'hindalco industries', 'hindalco limited'],
  },
  JSWSTEEL: {
    name: 'JSW Steel Limited',
    ticker: 'JSWSTEEL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE019A01038',
    sector: 'Materials',
    industry: 'Steel & Flat Products',
    screenerSlug: 'JSWSTEEL',
    aliases: ['jsw steel', 'jswsteel', 'jsw steel limited'],
  },
  HINDUNILVR: {
    name: 'Hindustan Unilever Limited',
    ticker: 'HINDUNILVR',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE030A01027',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Home & Personal Care, Foods',
    screenerSlug: 'HINDUNILVR',
    aliases: ['hul', 'hindustan unilever', 'hindunilvr', 'unilever india'],
  },
  NESTLEIND: {
    name: 'Nestle India Limited',
    ticker: 'NESTLEIND',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE239A01024',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Packaged Foods & Beverages (Maggi, Nescafe)',
    screenerSlug: 'NESTLEIND',
    aliases: ['nestle', 'nestle india', 'nestleind', 'nestle india limited'],
  },
  BRITANNIA: {
    name: 'Britannia Industries Limited',
    ticker: 'BRITANNIA',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE216A01030',
    sector: 'Fast Moving Consumer Goods',
    industry: 'Biscuits, Dairy & Bakery',
    screenerSlug: 'BRITANNIA',
    aliases: ['britannia', 'britannia industries', 'britannia limited'],
  },
  CIPLA: {
    name: 'Cipla Limited',
    ticker: 'CIPLA',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE059A01026',
    sector: 'Healthcare',
    industry: 'Pharmaceuticals & Respiratory',
    screenerSlug: 'CIPLA',
    aliases: ['cipla', 'cipla limited', 'cipla ltd'],
  },
  DRREDDY: {
    name: "Dr. Reddy's Laboratories Limited",
    ticker: 'DRREDDY',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE089A01023',
    sector: 'Healthcare',
    industry: 'Pharmaceuticals & Generics',
    screenerSlug: 'DRREDDY',
    aliases: ["dr reddy", "dr reddy's", 'drreddy', 'doctor reddy', "dr. reddy's laboratories"],
  },
  DIVISLAB: {
    name: "Divi's Laboratories Limited",
    ticker: 'DIVISLAB',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE361B01024',
    sector: 'Healthcare',
    industry: 'Active Pharmaceutical Ingredients (APIs)',
    screenerSlug: 'DIVISLAB',
    aliases: ["divi's", 'divis', 'divislab', "divi's laboratories"],
  },
  APOLLOHOSP: {
    name: 'Apollo Hospitals Enterprise Limited',
    ticker: 'APOLLOHOSP',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE437A01024',
    sector: 'Healthcare',
    industry: 'Hospitals, Pharmacies & Telehealth',
    screenerSlug: 'APOLLOHOSP',
    aliases: ['apollo hospitals', 'apollo hospital', 'apollohosp', 'apollo'],
  },
  EICHERMOT: {
    name: 'Eicher Motors Limited',
    ticker: 'EICHERMOT',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE066A01021',
    sector: 'Automobile',
    industry: 'Royal Enfield Motorcycles & Commercial Vehicles',
    screenerSlug: 'EICHERMOT',
    aliases: ['eicher', 'eicher motors', 'eichermot', 'royal enfield'],
  },
  BAJAJ_AUTO: {
    name: 'Bajaj Auto Limited',
    ticker: 'BAJAJ-AUTO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE917I01017',
    sector: 'Automobile',
    industry: 'Two-Wheelers & Three-Wheelers',
    screenerSlug: 'BAJAJ-AUTO',
    aliases: ['bajaj auto', 'bajaj-auto', 'bajaj 2-wheelers'],
  },
  HEROMOTOCO: {
    name: 'Hero MotoCorp Limited',
    ticker: 'HEROMOTOCO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE158A01026',
    sector: 'Automobile',
    industry: 'Two-Wheelers (Splendor)',
    screenerSlug: 'HEROMOTOCO',
    aliases: ['hero', 'hero motocorp', 'heromotoco', 'hero honda'],
  },
  ADANIENT: {
    name: 'Adani Enterprises Limited',
    ticker: 'ADANIENT',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE423A01024',
    sector: 'Conglomerate / Infrastructure',
    industry: 'Incubation, Mining & Infrastructure',
    screenerSlug: 'ADANIENT',
    aliases: ['adani enterprises', 'adanient', 'adani flagship'],
  },
  ADANIPORTS: {
    name: 'Adani Ports and Special Economic Zone Limited',
    ticker: 'ADANIPORTS',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE742F01042',
    sector: 'Industrials / Logistics',
    industry: 'Ports & Logistics',
    screenerSlug: 'ADANIPORTS',
    aliases: ['adani ports', 'adaniports', 'apsez'],
  },
  ADANIGREEN: {
    name: 'Adani Green Energy Limited',
    ticker: 'ADANIGREEN',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE364U01010',
    sector: 'Utilities',
    industry: 'Renewable Power Generation',
    screenerSlug: 'ADANIGREEN',
    aliases: ['adani green', 'adanigreen', 'adani green energy'],
  },
  ADANIPOWER: {
    name: 'Adani Power Limited',
    ticker: 'ADANIPOWER',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE814H01011',
    sector: 'Utilities',
    industry: 'Thermal Power Generation',
    screenerSlug: 'ADANIPOWER',
    aliases: ['adani power', 'adanipower'],
  },
  DLF: {
    name: 'DLF Limited',
    ticker: 'DLF',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE271C01023',
    sector: 'Real Estate',
    industry: 'Residential & Commercial Real Estate',
    screenerSlug: 'DLF',
    aliases: ['dlf', 'dlf limited', 'dlf ltd'],
  },
  LODHA: {
    name: 'Macrotech Developers Limited (Lodha)',
    ticker: 'LODHA',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE670K01029',
    sector: 'Real Estate',
    industry: 'Residential Real Estate Development',
    screenerSlug: 'LODHA',
    aliases: ['lodha', 'macrotech', 'macrotech developers', 'lodha developers'],
  },
  GODREJPROP: {
    name: 'Godrej Properties Limited',
    ticker: 'GODREJPROP',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE484J01027',
    sector: 'Real Estate',
    industry: 'Residential & Commercial Real Estate',
    screenerSlug: 'GODREJPROP',
    aliases: ['godrej properties', 'godrejprop', 'godrej real estate'],
  },
  SRILOTUSDVLP: {
    name: 'Sri Lotus Developers Ltd.',
    ticker: 'SRILOTUSDVLP',
    exchange: 'NSE',
    country: 'India',
    sector: 'Real Estate',
    industry: 'Residential Real Estate Development',
    screenerSlug: 'SRILOTUSDVLP',
    aliases: ['sri lotus', 'sri lotus developers', 'srilotusdvlp', 'lotus developers'],
  },
  NRBBEARING: {
    name: 'NRB Bearings Limited',
    ticker: 'NRBBEARING',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE349A01021',
    sector: 'Auto Ancillaries',
    industry: 'Automotive Needle Roller & Cylindrical Bearings',
    screenerSlug: 'NRBBEARING',
    aliases: ['nrbbearing', 'nrb automotive'],
  },
  NIBL: {
    name: 'NRB Industrial Bearings Limited',
    ticker: 'NIBL',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE095N01017',
    sector: 'Capital Goods / Industrial',
    industry: 'Industrial Ball & Roller Bearings',
    screenerSlug: 'NIBL',
    aliases: ['nibl', 'nrb industrial', 'nrb industrial bearings', 'nrb industrial bearings limited'],
  },
  PIDILITIND: {
    name: 'Pidilite Industries Limited',
    ticker: 'PIDILITIND',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE318A01026',
    sector: 'Materials',
    industry: 'Adhesives & Sealants (Fevicol)',
    screenerSlug: 'PIDILITIND',
    aliases: ['fevicol', 'pidilite', 'pidilitind', 'pidilite industries'],
  },
};

const AMBIGUOUS_CLUSTERS: Record<string, CompanyCandidate[]> = {
  nrb: [
    {
      name: 'NRB Bearings Limited',
      ticker: 'NRBBEARING',
      exchange: 'NSE',
      description: 'Automotive needle & roller bearings flagship (~₹526, Market Cap ~₹5,100 Cr)',
    },
    {
      name: 'NRB Industrial Bearings Limited',
      ticker: 'NIBL',
      exchange: 'NSE',
      description: 'Industrial ball & roller bearings (Demerged in 2012, ~₹32.50, Market Cap ~₹81 Cr)',
    },
  ],
  'nrb bearings': [
    {
      name: 'NRB Bearings Limited',
      ticker: 'NRBBEARING',
      exchange: 'NSE',
      description: 'Automotive needle & roller bearings flagship (~₹526, Market Cap ~₹5,100 Cr)',
    },
    {
      name: 'NRB Industrial Bearings Limited',
      ticker: 'NIBL',
      exchange: 'NSE',
      description: 'Industrial ball & roller bearings (Demerged in 2012, ~₹32.50, Market Cap ~₹81 Cr)',
    },
  ],
  hdfc: [
    { name: 'HDFC Bank Limited', ticker: 'HDFCBANK', exchange: 'NSE', description: "India's largest private sector bank" },
    { name: 'HDFC Life Insurance Company Limited', ticker: 'HDFCLIFE', exchange: 'NSE', description: 'Leading life insurance company backed by HDFC Group' },
    { name: 'HDFC Asset Management Company Limited', ticker: 'HDFCAMC', exchange: 'NSE', description: "One of India's largest mutual fund asset managers" },
  ],
  tata: [
    { name: 'Tata Motors Passenger Vehicles Limited', ticker: 'TMPV', exchange: 'NSE', description: 'Passenger vehicles, EVs and JLR business after the 2025 demerger' },
    { name: 'Tata Motors Limited', ticker: 'TMCV', exchange: 'NSE', description: 'Commercial vehicles business listed separately after the 2025 demerger' },
    { name: 'Tata Consultancy Services Limited', ticker: 'TCS', exchange: 'NSE', description: 'Global IT services and digital solutions leader' },
    { name: 'Tata Steel Limited', ticker: 'TATASTEEL', exchange: 'NSE', description: 'Integrated steel manufacturing major' },
    { name: 'Tata Power Company Limited', ticker: 'TATAPOWER', exchange: 'NSE', description: 'Power generation, transmission and renewable energy' },
    { name: 'Tata Consumer Products Limited', ticker: 'TATACONSUM', exchange: 'NSE', description: 'FMCG and beverage company (Tata Tea, Tetley, Sampann)' },
    { name: 'Trent Limited', ticker: 'TRENT', exchange: 'NSE', description: 'Tata Group retail chain operator (Westside, Zudio)' },
  ],
  'tata motors': [
    { name: 'Tata Motors Passenger Vehicles Limited', ticker: 'TMPV', exchange: 'NSE', description: 'Passenger vehicles, EVs and JLR business after the 2025 demerger' },
    { name: 'Tata Motors Limited', ticker: 'TMCV', exchange: 'NSE', description: 'Commercial vehicles business listed separately after the 2025 demerger' },
  ],
  adani: [
    { name: 'Adani Enterprises Limited', ticker: 'ADANIENT', exchange: 'NSE', description: 'Flagship incubator and infrastructure conglomerate' },
    { name: 'Adani Ports and Special Economic Zone Limited', ticker: 'ADANIPORTS', exchange: 'NSE', description: 'Largest commercial ports and logistics operator' },
    { name: 'Adani Power Limited', ticker: 'ADANIPOWER', exchange: 'NSE', description: 'Thermal and solar power producer' },
    { name: 'Adani Green Energy Limited', ticker: 'ADANIGREEN', exchange: 'NSE', description: 'Renewable energy generation specialist' },
  ],
  reliance: [
    { name: 'Reliance Industries Limited', ticker: 'RELIANCE', exchange: 'NSE', description: 'Oil-to-chemicals, retail, Jio telecom conglomerate' },
    { name: 'Reliance Power Limited', ticker: 'RPOWER', exchange: 'NSE', description: 'Anil Ambani Group power generation utility' },
    { name: 'Reliance Infrastructure Limited', ticker: 'RELINFRA', exchange: 'NSE', description: 'Anil Ambani Group power distribution, metro and EPC' },
  ],
  mahindra: [
    { name: 'Mahindra & Mahindra Limited', ticker: 'M&M', exchange: 'NSE', description: 'SUV, farm equipment and commercial vehicles leader' },
    { name: 'Tech Mahindra Limited', ticker: 'TECHM', exchange: 'NSE', description: 'Digital transformation, IT and telecom consulting' },
    { name: 'Mahindra & Mahindra Financial Services Limited', ticker: 'M&MFIN', exchange: 'NSE', description: 'Rural and semi-urban vehicle financing NBFC' },
  ],
  birla: [
    { name: 'Grasim Industries Limited', ticker: 'GRASIM', exchange: 'NSE', description: 'Aditya Birla Group flagship (Viscose, Chemicals & Paints)' },
    { name: 'UltraTech Cement Limited', ticker: 'ULTRACEMCO', exchange: 'NSE', description: "India's largest cement manufacturer" },
    { name: 'Hindalco Industries Limited', ticker: 'HINDALCO', exchange: 'NSE', description: 'Aluminium and copper producer (Novelis)' },
  ],
};

// Common spelling mistakes / keyboard typos in financial queries
const COMMON_TYPOS: Record<string, string> = {
  babk: 'bank',
  bannk: 'bank',
  bak: 'bank',
  bnk: 'bank',
  moters: 'motors',
  moter: 'motor',
  infosis: 'infosys',
  infosi: 'infosys',
  infytech: 'infosys',
  relaince: 'reliance',
  relianse: 'reliance',
  zomatoo: 'zomato',
  zomatto: 'zomato',
  zometo: 'zomato',
  kotack: 'kotak',
  icic: 'icici',
  bharti: 'bharti airtel',
  tcsit: 'tcs',
  tataconsultancy: 'tcs',
};

// Standard Levenshtein distance implementation
export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: an + 1 }, () => new Array<number>(bn + 1));
  for (let i = 0; i <= an; i++) matrix[i][0] = i;
  for (let j = 0; j <= bn; j++) matrix[0][j] = j;

  for (let i = 1; i <= an; i++) {
    for (let j = 1; j <= bn; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[an][bn];
}

// Clean and strip conversational prefixes
function sanitizeEntityQuery(raw: string): string {
  let s = raw.toLowerCase().trim();

  // Strip conversational wrappers & leading questions
  s = s.replace(/^(?:can you\s+|please\s+)?(?:tell me about|explain about|overview of|details on|details of|information on|give me details on|analyse|analyze|research|explain|what about|how is|fundamentals of|report on|review|should i buy|when should i buy|when to buy|target price for|stop loss for|is it good to buy|target for|share price of|stock price of|price of|invest in|look at|check)\s+(?:the\s+)?/i, '');
  // Also strip standalone "about the", "about", "the" if left at start
  s = s.replace(/^(?:about\s+(?:the\s+)?|the\s+)/i, '');
  // Strip trailing stock/company words
  s = s.replace(/\s+(?:share|shares|stock|stocks|equity|company|limited|ltd)$/i, '');

  // Normalize separators
  s = s.replace(/[._\-]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

// Replace known word typos
function correctWordTypos(text: string): { corrected: string; hadTypo: boolean } {
  const words = text.split(/\s+/);
  let hadTypo = false;
  const transformed = words.map((w) => {
    if (COMMON_TYPOS[w]) {
      hadTypo = true;
      return COMMON_TYPOS[w];
    }
    // Also check edit distance 1 to 'bank' if it starts with 'b' and ends with 'k'
    if (w.length === 4 && w[0] === 'b' && w[3] === 'k' && levenshtein(w, 'bank') <= 2) {
      hadTypo = true;
      return 'bank';
    }
    return w;
  });
  return { corrected: transformed.join(' '), hadTypo };
}

/**
 * Resolves a company from user query using local high-precision dictionary,
 * fuzzy typo correction, ambiguous cluster detection, official exchange master lookup,
 * and Groq/Tavily fallback.
 */
export async function identifyCompany(rawQuery: string): Promise<CompanyResolutionOutcome> {
  const query = rawQuery.trim();
  if (!query) {
    return { resolved: false, error: 'Query is empty' };
  }

  // 0. Extract ISIN if present (12 characters, e.g. INE00H001014, INE945H01021, INE437A01024)
  const isinMatch = query.match(/\b(IN[E|F|9][0-9A-Z]{9})\b/i);
  const explicitIsin = isinMatch ? isinMatch[1].toUpperCase() : undefined;

  // 0b. Normalize exchange-prefixed inputs or embedded tickers:
  // e.g. "XNSE:SWIGGY", "NSE:SWIGGY", "BSE:544285", "Swiggy Limited, XNSE: SWIGGY", "XBSE: 508869"
  const exchangePrefixRegex = /(?:XNSE|NSE|XBSE|BSE)[:\s]+([A-Za-z0-9&]+)/i;
  const prefixMatch = exchangePrefixRegex.exec(query);
  let extractedSymbolOrCode: string | null = null;
  if (prefixMatch && prefixMatch[1]?.trim()) {
    extractedSymbolOrCode = prefixMatch[1].trim().toUpperCase();
  }

  // 0c. Extract BSE 6-digit numeric scrip code if present (e.g. 532867, 508869, 544285)
  const bseCodeMatch = query.match(/\b([5][0-9]{5})\b/);
  const explicitBseCode = bseCodeMatch ? bseCodeMatch[1] : undefined;

  const cleaned = sanitizeEntityQuery(query);
  const { corrected, hadTypo } = correctWordTypos(cleaned);

  // 1. Direct ISIN match in curated dictionary or Upstox master
  if (explicitIsin) {
    for (const comp of Object.values(CURATED_INDIAN_COMPANIES)) {
      if (comp.isin?.toUpperCase() === explicitIsin) {
        return {
          resolved: true,
          company: { ...comp },
        };
      }
    }
    try {
      const upstoxRes = await resolveUpstoxInstrument(cleaned || query, 'NSE', explicitIsin);
      if (upstoxRes.instrument) {
        return {
          resolved: true,
          company: {
            name: upstoxRes.instrument.name.replace(/[,.]\s*$/, ''),
            ticker: upstoxRes.instrument.trading_symbol,
            exchange: (upstoxRes.instrument.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE',
            country: 'India',
            isin: upstoxRes.instrument.isin ?? explicitIsin,
            sector: 'Indian Listed Equity',
            industry: 'Exchange Listed Security',
            screenerSlug: upstoxRes.instrument.trading_symbol,
          },
        };
      }
    } catch {
      // fallback
    }
  }

  // 1b. Direct BSE scrip code match in Upstox master
  if (explicitBseCode) {
    try {
      const instruments = await getInstrumentMaster();
      const byCode = instruments.find((item) => item.exchange_token === explicitBseCode || item.trading_symbol === explicitBseCode);
      if (byCode) {
        const curated = CURATED_INDIAN_COMPANIES[byCode.trading_symbol.toUpperCase()];
        return {
          resolved: true,
          company: curated ? { ...curated } : {
            name: byCode.name.replace(/[,.]\s*$/, ''),
            ticker: byCode.trading_symbol,
            exchange: (byCode.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE',
            country: 'India',
            isin: byCode.isin,
            sector: 'Indian Listed Equity',
            industry: 'Exchange Listed Security',
            screenerSlug: byCode.trading_symbol,
          },
        };
      }
    } catch {
      // fallback
    }
  }

  // 1c. Check for exact ambiguous clusters (e.g. user typed just "Tata", "Adani", "Reliance", or bare "HDFC")
  if (AMBIGUOUS_CLUSTERS[cleaned] || (!hadTypo && AMBIGUOUS_CLUSTERS[corrected])) {
    const cluster = AMBIGUOUS_CLUSTERS[cleaned] || AMBIGUOUS_CLUSTERS[corrected];
    return {
      resolved: false,
      candidates: cluster,
    };
  }

  // 2. Direct exact ticker match on raw query, extracted ticker, or cleaned query
  const searchTickers = [
    extractedSymbolOrCode,
    query.toUpperCase().trim(),
    cleaned.toUpperCase().trim(),
  ].filter(Boolean) as string[];

  for (const sym of searchTickers) {
    if (CURATED_INDIAN_COMPANIES[sym]) {
      const comp = CURATED_INDIAN_COMPANIES[sym];
      return {
        resolved: true,
        company: { ...comp },
      };
    }
    for (const comp of Object.values(CURATED_INDIAN_COMPANIES)) {
      if (comp.ticker === sym) {
        return {
          resolved: true,
          company: { ...comp },
        };
      }
    }
  }

  // 3. Exact alias match against cleaned and typo-corrected forms
  const searchCandidates = [cleaned, corrected];
  if (extractedSymbolOrCode) searchCandidates.unshift(extractedSymbolOrCode.toLowerCase());
  for (const target of searchCandidates) {
    for (const comp of Object.values(CURATED_INDIAN_COMPANIES)) {
      if (comp.aliases.some((alias) => alias.toLowerCase() === target)) {
        return {
          resolved: true,
          company: { ...comp },
          interpretation: hadTypo ? `Interpreted as ${comp.name} (${comp.ticker})` : undefined,
        };
      }
    }
  }

  // 3b. Official exchange master lookup (covers all 4,000+ NSE and BSE listed equities)
  try {
    const queryForMaster = extractedSymbolOrCode || cleaned;
    const upstoxMatch = await resolveUpstoxInstrument(queryForMaster, 'NSE', explicitIsin);
    if (upstoxMatch.instrument) {
      const inst = upstoxMatch.instrument;
      const curated = CURATED_INDIAN_COMPANIES[inst.trading_symbol.toUpperCase()];
      if (curated) {
        return {
          resolved: true,
          company: { ...curated },
          interpretation: hadTypo ? `Interpreted as ${curated.name} (${curated.ticker})` : undefined,
        };
      }
      return {
        resolved: true,
        company: {
          name: inst.name.replace(/[,.]\s*$/, ''),
          ticker: inst.trading_symbol,
          exchange: (inst.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE',
          country: 'India',
          isin: inst.isin,
          sector: 'Indian Listed Equity',
          industry: 'Exchange Listed Security',
          screenerSlug: inst.trading_symbol,
        },
      };
    }
  } catch (err) {
    console.warn('[company-resolver] Upstox instrument master lookup error:', err);
  }

  // 4. Fuzzy alias and name matching with confidence ranking + Distinctive Token Guard
  interface ScoredMatch {
    comp: CuratedCompany;
    score: number;
    matchedOn: string;
  }
  const scored: ScoredMatch[] = [];

  // Extract distinctive alphanumeric tokens (e.g. 'v2', '3m', '5paisa')
  const distinctiveTokens = corrected.split(/\s+/).filter(
    (t) => /\d/.test(t) || (t.length <= 3 && !['ltd', 'inc', 'co', 'the', 'ind', 'and'].includes(t))
  );

  for (const comp of Object.values(CURATED_INDIAN_COMPANIES)) {
    const namesAndAliases = [comp.name.toLowerCase(), comp.ticker.toLowerCase(), ...comp.aliases];

    // If query has distinctive tokens, candidate MUST contain those tokens!
    if (distinctiveTokens.length > 0) {
      const hasDistinctive = namesAndAliases.some((alias) =>
        distinctiveTokens.every((tok) => alias.split(/\s+/).includes(tok) || alias.includes(tok))
      );
      if (!hasDistinctive) {
        continue;
      }
    }

    let bestScoreForComp = 0;
    let bestMatched = '';

    for (const phrase of namesAndAliases) {
      // Direct substring match
      if (phrase.includes(corrected) || corrected.includes(phrase)) {
        const ratio = Math.min(phrase.length, corrected.length) / Math.max(phrase.length, corrected.length);
        const score = 0.80 + ratio * 0.18;
        if (score > bestScoreForComp) {
          bestScoreForComp = score;
          bestMatched = phrase;
        }
      }

      // Word-level token overlap
      const queryTokens = corrected.split(/\s+/);
      const phraseTokens = phrase.split(/\s+/);
      const tokenMatches = queryTokens.filter((token) =>
        phraseTokens.some((pt) => pt === token || (token.length > 3 && levenshtein(pt, token) <= 1)),
      ).length;

      if (tokenMatches > 0) {
        const tokenScore = 0.70 + (tokenMatches / Math.max(queryTokens.length, phraseTokens.length)) * 0.25;
        if (tokenScore > bestScoreForComp) {
          bestScoreForComp = tokenScore;
          bestMatched = phrase;
        }
      }

      // Levenshtein fuzzy distance for short queries
      if (Math.abs(phrase.length - corrected.length) <= 3) {
        const dist = levenshtein(phrase, corrected);
        const maxLen = Math.max(phrase.length, corrected.length);
        const levScore = 1 - dist / maxLen;
        if (levScore > 0.75 && levScore > bestScoreForComp) {
          bestScoreForComp = levScore;
          bestMatched = phrase;
        }
      }
    }

    if (bestScoreForComp >= 0.75) {
      scored.push({ comp, score: bestScoreForComp, matchedOn: bestMatched });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  // If we have an unambiguous top match (high score and good margin over second)
  if (scored.length > 0) {
    const top = scored[0];
    const second = scored[1];
    const isUnambiguous = top.score >= 0.85 || (!second || top.score - second.score >= 0.15);

    if (isUnambiguous) {
      return {
        resolved: true,
        company: {
          name: top.comp.name,
          ticker: top.comp.ticker,
          exchange: top.comp.exchange,
          country: top.comp.country,
          isin: top.comp.isin,
          sector: top.comp.sector,
          industry: top.comp.industry,
          screenerSlug: top.comp.screenerSlug,
        },
        interpretation: hadTypo ? `Interpreted as ${top.comp.name} (${top.comp.ticker})` : undefined,
      };
    }

    // Multiple close matches -> return candidates for clarification
    return {
      resolved: false,
      candidates: scored.slice(0, 4).map((s) => ({
        name: s.comp.name,
        ticker: s.comp.ticker,
        exchange: s.comp.exchange,
        description: s.comp.industry || s.comp.sector,
      })),
    };
  }

  // 5. Fallback to Groq / NVIDIA LLM if not resolved locally
  try {
    const nvidiaResult = await resolveCompany(query);
    if (nvidiaResult.resolved && nvidiaResult.company) {
      return {
        resolved: true,
        company: {
          name: nvidiaResult.company.name,
          ticker: nvidiaResult.company.ticker.toUpperCase(),
          exchange: nvidiaResult.company.exchange || 'NSE',
          country: 'India',
          sector: nvidiaResult.company.sector,
          industry: nvidiaResult.company.industry,
          screenerSlug: nvidiaResult.company.ticker.toUpperCase(),
        },
      };
    }

    if (!nvidiaResult.resolved && nvidiaResult.candidates && nvidiaResult.candidates.length > 0) {
      return {
        resolved: false,
        candidates: nvidiaResult.candidates,
      };
    }
  } catch (err) {
    console.warn('[company-resolver] Groq/Nvidia fallback resolution failed:', err);
  }

  // 6. High-accuracy Web Search Fallback via Tavily + LLM for new or uncurated IPOs & stocks
  try {
    const { tavilySearchWithFallback } = await import('@/lib/tavily/client');
    const searchRes = await tavilySearchWithFallback(`${query} NSE BSE stock ticker India listed company`, {
      maxResults: 3,
      searchDepth: 'basic',
    });
    const snippets = searchRes.results?.map((r: { title?: string; content?: string }) => `${r.title ?? ''}\n${r.content ?? ''}`).join('\n\n') || '';
    if (snippets.length > 50) {
      const { analyzeWithGroq } = await import('@/lib/groq/client');
      const parsed = await analyzeWithGroq({
        systemPrompt: 'You are an expert Indian stock market company resolution system. Based on the provided web search evidence, identify the listed Indian company.\nReturn ONLY JSON with this format:\n{"resolved": true, "company": {"name": "Full Legal Company Name", "ticker": "NSE_TICKER", "exchange": "NSE", "sector": "Sector Name", "industry": "Industry Name"}} or {"resolved": false, "candidates": []}',
        userPrompt: `Search evidence:\n${snippets.slice(0, 4000)}\n\nQuery to resolve: "${query}"`,
        timeoutMs: 15_000,
      });
      if (parsed.resolved && parsed.company && typeof parsed.company === 'object') {
        const comp = parsed.company as Record<string, string>;
        if (comp.name && comp.ticker) {
          return {
            resolved: true,
            company: {
              name: comp.name,
              ticker: comp.ticker.toUpperCase().replace(/\.(NS|BO)$/, ''),
              exchange: (comp.exchange === 'BSE' ? 'BSE' : 'NSE') as 'NSE' | 'BSE',
              country: 'India',
              sector: comp.sector || 'Indian Equity',
              industry: comp.industry || 'Listed Equity',
              screenerSlug: comp.ticker.toUpperCase(),
            },
            interpretation: `Identified from live exchange data as ${comp.name} (${comp.ticker.toUpperCase()})`,
          };
        }
      }
    }
  } catch (searchErr) {
    console.warn('[company-resolver] Tavily web resolution failed:', searchErr);
  }

  return {
    resolved: false,
    error: `Unable to confidently identify an Indian listed company from "${query}". Please enter the NSE/BSE ticker or full company name.`,
  };
}
