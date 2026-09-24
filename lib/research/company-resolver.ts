import type { CompanyIdentity, CompanyCandidate } from '@/types/company';
import { resolveCompany as resolveCompanyViaGroq } from '@/lib/groq/client';

export interface CompanyResolutionOutcome {
  resolved: boolean;
  company?: CompanyIdentity;
  candidates?: CompanyCandidate[];
  error?: string;
}

// Curated high-precision database of major Indian listed companies
// Guarantees instant, 100% accurate resolution for top companies
const CURATED_INDIAN_COMPANIES: Record<string, CompanyIdentity & { aliases: string[]; screenerSlug: string }> = {
  RELIANCE: {
    name: 'Reliance Industries Limited',
    ticker: 'RELIANCE',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE002A01018',
    sector: 'Conglomerate / Energy',
    industry: 'Oil-to-Chemicals, Retail & Telecom',
    screenerSlug: 'RELIANCE',
    aliases: ['reliance', 'reliance industries', 'ril', 'reliance ind', 'jio', 'reliance retail'],
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
    aliases: ['tcs', 'tata consultancy services', 'tata consultancy'],
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
    // NOTE: bare 'hdfc' removed — it caused greedy matches against 'hdfc life', 'hdfc amc' etc.
    aliases: ['hdfc bank', 'hdfcbank', 'hdfc bank limited'],
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
    aliases: ['hdfc amc', 'hdfcamc', 'hdfc asset management', 'hdfc mutual fund'],
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

  INFY: {
    name: 'Infosys Limited',
    ticker: 'INFY',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE009A01021',
    sector: 'Information Technology',
    industry: 'IT Services & Consulting',
    screenerSlug: 'INFY',
    aliases: ['infosys', 'infy', 'infosys ltd'],
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
    aliases: ['l&t', 'larsen and toubro', 'larsen & toubro', 'lt', 'larsen'],
  },
  TATAMOTORS: {
    name: 'Tata Motors Limited',
    ticker: 'TATAMOTORS',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE155A01022',
    sector: 'Automobile',
    industry: 'Commercial & Passenger Vehicles / EV',
    screenerSlug: 'TATAMOTORS',
    aliases: ['tata motors', 'tatamotors', 'tamo', 'tata motor'],
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
  ZOMATO: {
    name: 'Zomato Limited',
    ticker: 'ZOMATO',
    exchange: 'NSE',
    country: 'India',
    isin: 'INE758T01015',
    sector: 'Consumer Services',
    industry: 'Food Delivery & Quick Commerce (Blinkit)',
    screenerSlug: 'ZOMATO',
    aliases: ['zomato', 'blinkit', 'zomato limited'],
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
    aliases: ['icici', 'icici bank', 'icicibank'],
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
    aliases: ['sbi', 'sbin', 'state bank of india'],
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
    aliases: ['airtel', 'bharti airtel', 'bhartiartl'],
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
    aliases: ['maruti', 'maruti suzuki', 'msil'],
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
};

// Common ambiguous prefixes that must prompt disambiguation
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
    { name: 'HDFC Bank Limited', ticker: 'HDFCBANK', exchange: 'NSE', description: 'India\'s largest private sector bank' },
    { name: 'HDFC Life Insurance Company Limited', ticker: 'HDFCLIFE', exchange: 'NSE', description: 'Leading life insurance company backed by HDFC Group' },
    { name: 'HDFC Asset Management Company Limited', ticker: 'HDFCAMC', exchange: 'NSE', description: 'One of India\'s largest mutual fund asset managers' },
  ],
  tata: [
    { name: 'Tata Motors Limited', ticker: 'TATAMOTORS', exchange: 'NSE', description: 'Automotive and EV manufacturer (including JLR)' },
    { name: 'Tata Consultancy Services Limited', ticker: 'TCS', exchange: 'NSE', description: 'Global IT services and digital solutions leader' },
    { name: 'Tata Steel Limited', ticker: 'TATASTEEL', exchange: 'NSE', description: 'Integrated steel manufacturing major' },
    { name: 'Tata Power Company Limited', ticker: 'TATAPOWER', exchange: 'NSE', description: 'Power generation, transmission and renewable energy' },
    { name: 'Tata Consumer Products Limited', ticker: 'TATACONSUM', exchange: 'NSE', description: 'FMCG and beverage company (Tata Tea, Tetley, Sampann)' },
    { name: 'Trent Limited', ticker: 'TRENT', exchange: 'NSE', description: 'Tata Group retail chain operator (Westside, Zudio)' },
  ],
  adani: [
    { name: 'Adani Enterprises Limited', ticker: 'ADANIENT', exchange: 'NSE', description: 'Flagship incubator and infrastructure conglomerate' },
    { name: 'Adani Ports and Special Economic Zone Limited', ticker: 'ADANIPORTS', exchange: 'NSE', description: 'Largest commercial ports and logistics operator' },
    { name: 'Adani Power Limited', ticker: 'ADANIPOWER', exchange: 'NSE', description: 'Thermal and solar power producer' },
    { name: 'Adani Green Energy Limited', ticker: 'ADANIGREEN', exchange: 'NSE', description: 'Renewable energy generation specialist' },
  ],
  mahindra: [
    { name: 'Mahindra & Mahindra Limited', ticker: 'M&M', exchange: 'NSE', description: 'SUV, farm equipment and commercial vehicles leader' },
    { name: 'Tech Mahindra Limited', ticker: 'TECHM', exchange: 'NSE', description: 'Digital transformation, IT and telecom consulting' },
    { name: 'Mahindra & Mahindra Financial Services Limited', ticker: 'M&MFIN', exchange: 'NSE', description: 'Rural and semi-urban vehicle financing NBFC' },
  ],
  birla: [
    { name: 'Grasim Industries Limited', ticker: 'GRASIM', exchange: 'NSE', description: 'Aditya Birla Group flagship (Viscose, Chemicals & Paints)' },
    { name: 'UltraTech Cement Limited', ticker: 'ULTRACEMCO', exchange: 'NSE', description: 'India’s largest cement manufacturer' },
    { name: 'Hindalco Industries Limited', ticker: 'HINDALCO', exchange: 'NSE', description: 'Aluminium and copper producer (Novelis)' },
  ],
};

/**
 * Resolves a company from user query using local curated dictionary first,
 * checking for ambiguous group names, and falling back to Groq LLM if needed.
 */
export async function identifyCompany(rawQuery: string): Promise<CompanyResolutionOutcome> {
  const query = rawQuery.trim();
  const lower = query.toLowerCase()
    .replace(/^(analyse|analyze|research|what are the risks of|how is|fundamentals of|report on)\s+/i, '')
    .trim();

  // 1. Check for exact ambiguous clusters (e.g. user typed just "Tata" or "Adani")
  if (AMBIGUOUS_CLUSTERS[lower]) {
    return {
      resolved: false,
      candidates: AMBIGUOUS_CLUSTERS[lower],
    };
  }

  // 2. Check curated dictionary
  for (const [key, comp] of Object.entries(CURATED_INDIAN_COMPANIES)) {
    if (key.toLowerCase() === lower || comp.ticker.toLowerCase() === lower) {
      return {
        resolved: true,
        company: {
          name: comp.name,
          ticker: comp.ticker,
          exchange: comp.exchange,
          country: comp.country,
          isin: comp.isin,
          sector: comp.sector,
          industry: comp.industry,
          screenerSlug: comp.screenerSlug,
        },
      };
    }

    // Alias matching — exact match only. No bare includes().
    const aliasMatch = comp.aliases.some((alias) => lower === alias);
    if (aliasMatch) {
      return {
        resolved: true,
        company: {
          name: comp.name,
          ticker: comp.ticker,
          exchange: comp.exchange,
          country: comp.country,
          isin: comp.isin,
          sector: comp.sector,
          industry: comp.industry,
          screenerSlug: comp.screenerSlug,
        },
      };
    }
  }

  // 3. Fallback to Groq company resolution
  try {
    const groqResult = await resolveCompanyViaGroq(query);
    if (groqResult.resolved && groqResult.company) {
      return {
        resolved: true,
        company: {
          name: groqResult.company.name,
          ticker: groqResult.company.ticker.toUpperCase(),
          exchange: groqResult.company.exchange || 'NSE',
          country: 'India',
          sector: groqResult.company.sector,
          industry: groqResult.company.industry,
          screenerSlug: groqResult.company.ticker.toUpperCase(),
        },
      };
    }

    if (!groqResult.resolved && groqResult.candidates && groqResult.candidates.length > 0) {
      return {
        resolved: false,
        candidates: groqResult.candidates,
      };
    }
  } catch (err) {
    console.warn('[company-resolver] Groq resolution failed:', err);
  }

  return {
    resolved: false,
    error: `Unable to confidently identify an Indian listed company from "${query}". Please enter the NSE/BSE ticker or full company name.`,
  };
}
