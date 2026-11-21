export interface CompliancePolicy {
  mode: 'education_and_general_research' | 'regulated_research' | 'regulated_advice';
  personalizedAdviceEnabled: boolean;
  transactionExecutionEnabled: false;
  disclosure: string;
}

export function getCompliancePolicy(): CompliancePolicy {
  const requestedMode = process.env.JARO_COMPLIANCE_MODE;
  const mode: CompliancePolicy['mode'] = requestedMode === 'regulated_research' || requestedMode === 'regulated_advice'
    ? requestedMode
    : 'education_and_general_research';
  const personalizedAdviceEnabled = mode === 'regulated_advice'
    && process.env.JARO_PERSONALIZED_ADVICE_ENABLED === 'true';
  return {
    mode,
    personalizedAdviceEnabled,
    transactionExecutionEnabled: false,
    disclosure: personalizedAdviceEnabled
      ? 'Suitability-controlled advisory mode. Applicable registrations and compliance review must be independently verified.'
      : 'General research and financial education only. Jaro AI does not claim to be a SEBI-registered Research Analyst, Investment Adviser, or authorised mutual-fund adviser/distributor.',
  };
}
