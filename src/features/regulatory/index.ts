// Regulatory Submission Package Generation — eCTD, FDA IND/IDE, and IRB protocol drafting.
// Scaffolding for structured regulatory documents that feed into the existing
// manuscript validation gate.

export interface RegulatoryPackage {
  type: 'ectd' | 'ind' | 'ide' | 'irb';
  title: string;
  sections: RegulatorySection[];
  metadata: Record<string, string>;
}

export interface RegulatorySection {
  id: string;
  heading: string;
  body: string;
  required: boolean;
}

/**
 * Generate an eCTD-compatible document bundle.
 */
export function generateEctd(title: string, sponsor: string, indications: string[]): RegulatoryPackage {
  return {
    type: 'ectd',
    title,
    sections: [
      { id: 'm1-0', heading: 'Cover Letter', body: `Sponsor: ${sponsor}\nIndications: ${indications.join(', ')}`, required: true },
      { id: 'm2-1', heading: 'Module 2.1: CTD Table of Contents', body: '', required: true },
      { id: 'm2-3', heading: 'Module 2.3: Quality Overall Summary', body: '', required: true },
      { id: 'm2-5', heading: 'Module 2.5: Clinical Overview', body: '', required: true },
      { id: 'm2-7', heading: 'Module 2.7: Clinical Summary', body: '', required: true },
      { id: 'm5-3', heading: 'Module 5.3: Clinical Study Reports', body: '', required: true },
    ],
    metadata: { sponsor, submissionType: 'NDA', date: new Date().toISOString().slice(0, 10) },
  };
}

/**
 * Generate an FDA IND template.
 */
export function generateInd(title: string, sponsor: string, phase: string): RegulatoryPackage {
  return {
    type: 'ind',
    title,
    sections: [
      { id: 'ind-1', heading: '1. Form FDA 1571', body: '', required: true },
      { id: 'ind-2', heading: '2. Table of Contents', body: '', required: true },
      { id: 'ind-3', heading: '3. Introductory Statement', body: '', required: true },
      { id: 'ind-4', heading: '4. General Investigational Plan', body: `Phase ${phase} study design.`, required: true },
      { id: 'ind-5', heading: '5. Investigator Brochure', body: '', required: true },
      { id: 'ind-6', heading: '6. Protocol(s)', body: '', required: true },
      { id: 'ind-7', heading: '7. Chemistry, Manufacturing, and Controls', body: '', required: true },
      { id: 'ind-8', heading: '8. Pharmacology and Toxicology', body: '', required: true },
      { id: 'ind-9', heading: '9. Previous Human Experience', body: '', required: false },
      { id: 'ind-10', heading: '10. Additional Information', body: '', required: false },
    ],
    metadata: { sponsor, phase, date: new Date().toISOString().slice(0, 10) },
  };
}

/**
 * Generate an IRB protocol draft.
 */
export function generateIrb(title: string, pi: string, site: string): RegulatoryPackage {
  return {
    type: 'irb',
    title,
    sections: [
      { id: 'irb-1', heading: '1. Protocol Summary', body: '', required: true },
      { id: 'irb-2', heading: '2. Background and Rationale', body: '', required: true },
      { id: 'irb-3', heading: '3. Objectives', body: '', required: true },
      { id: 'irb-4', heading: '4. Study Design', body: '', required: true },
      { id: 'irb-5', heading: '5. Participant Selection', body: '', required: true },
      { id: 'irb-6', heading: '6. Procedures and Schedule', body: '', required: true },
      { id: 'irb-7', heading: '7. Risk Assessment', body: '', required: true },
      { id: 'irb-8', heading: '8. Data Safety Monitoring', body: '', required: true },
      { id: 'irb-9', heading: '9. Informed Consent', body: '', required: true },
      { id: 'irb-10', heading: '10. Confidentiality', body: '', required: true },
    ],
    metadata: { pi, site, date: new Date().toISOString().slice(0, 10) },
  };
}

/**
 * Validate that all required sections are present.
 */
export function validatePackage(pkg: RegulatoryPackage): { valid: boolean; missing: string[] } {
  const missing = pkg.sections.filter((s) => s.required && !s.body.trim()).map((s) => s.heading);
  return { valid: missing.length === 0, missing };
}

/**
 * Export package as markdown for human review.
 */
export function packageToMarkdown(pkg: RegulatoryPackage): string {
  const lines = [`# ${pkg.title}`, `Type: ${pkg.type.toUpperCase()}`, ''];
  for (const section of pkg.sections) {
    lines.push(`## ${section.heading}${section.required ? '' : ' (optional)'}`, '', section.body || '_[To be completed]_', '');
  }
  return lines.join('\n');
}
