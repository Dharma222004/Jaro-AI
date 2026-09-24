// Core company type
export interface CompanyIdentity {
  name: string;
  ticker: string;
  exchange: string;
  country: string;
  isin?: string;
  sector?: string;
  industry?: string;
  screenerSlug?: string;
}

// Disambiguation option
export interface CompanyCandidate {
  name: string;
  ticker: string;
  exchange: string;
  description?: string;
}
