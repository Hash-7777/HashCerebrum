// Offline medical term normalisation. A small, curated, fully-local dictionary
// of synonym groups — drug brand↔generic and common clinical abbreviations — so
// a search for one surface form also finds findings written with another
// ("Tylenol" ↔ acetaminophen, "MI" ↔ myocardial infarction). No network, no
// external ontology: 100% private and offline. Easily extended — just add a
// group below; every term in a group is treated as equivalent (bidirectional).

const SYNONYM_GROUPS: string[][] = [
  // --- analgesics / antipyretics ---
  ['acetaminophen', 'paracetamol', 'tylenol', 'panadol'],
  ['ibuprofen', 'advil', 'motrin', 'brufen', 'nurofen'],
  ['naproxen', 'aleve'],
  ['aspirin', 'acetylsalicylic acid', 'asa'],
  ['diclofenac', 'voltaren', 'cataflam'],
  ['celecoxib', 'celebrex'],
  // --- cardio / antiplatelet / anticoagulant ---
  ['clopidogrel', 'plavix'],
  ['warfarin', 'coumadin'],
  ['atorvastatin', 'lipitor'],
  ['rosuvastatin', 'crestor'],
  ['simvastatin', 'zocor'],
  ['metoprolol', 'lopressor', 'toprol'],
  ['amlodipine', 'norvasc'],
  ['lisinopril', 'zestril', 'prinivil'],
  // --- PPIs / GI ---
  ['omeprazole', 'prilosec', 'losec'],
  ['pantoprazole', 'protonix', 'controloc'],
  ['esomeprazole', 'nexium'],
  // --- diabetes ---
  ['metformin', 'glucophage'],
  ['type 2 diabetes', 'type 2 diabetes mellitus', 't2dm', 'niddm'],
  ['type 1 diabetes', 't1dm'],
  // --- common condition abbreviations ---
  ['myocardial infarction', 'heart attack', 'mi'],
  ['hypertension', 'high blood pressure', 'htn'],
  ['chronic kidney disease', 'ckd'],
  ['acute kidney injury', 'aki'],
  ['chronic obstructive pulmonary disease', 'copd'],
  ['congestive heart failure', 'heart failure', 'chf'],
  ['coronary artery disease', 'cad'],
  ['cerebrovascular accident', 'stroke', 'cva'],
  ['gastroesophageal reflux disease', 'gerd', 'acid reflux'],
  ['urinary tract infection', 'uti'],
  ['deep vein thrombosis', 'dvt'],
  ['pulmonary embolism', 'pe'],
  ['rheumatoid arthritis', 'ra'],
  ['atrial fibrillation', 'afib', 'af'],
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(haystack: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegex(term)}\\b`).test(haystack);
}

/**
 * Append the equivalent surface forms of any recognised term to the query, so
 * brand names and abbreviations match findings written with the generic/expanded
 * name (and vice-versa). Returns the query unchanged when nothing is recognised.
 */
export function expandQuery(query: string): string {
  const lower = query.toLowerCase();
  const additions: string[] = [];
  for (const group of SYNONYM_GROUPS) {
    if (!group.some((term) => containsTerm(lower, term))) continue;
    for (const term of group) {
      if (!containsTerm(lower, term) && !additions.includes(term)) additions.push(term);
    }
  }
  return additions.length > 0 ? `${query} ${additions.join(' ')}` : query;
}
