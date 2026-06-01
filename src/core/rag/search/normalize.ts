// Offline medical term normalisation. A small, curated, fully-local dictionary
// of synonym groups — drug brand↔generic and common clinical abbreviations — so
// a search for one surface form also finds findings written with another
// ("Tylenol" ↔ acetaminophen, "MI" ↔ myocardial infarction). No network, no
// external ontology: 100% private and offline. Easily extended — just add a
// group below; every term in a group is treated as equivalent (bidirectional).

// Each group lists equivalent surface forms (generic + international/Egyptian
// brand names + abbreviations), all in English. Matching any one widens the
// search to all the others, both directions. Only well-established mappings are
// included — accuracy matters in a medical tool. Extend freely.
const SYNONYM_GROUPS: string[][] = [
  // --- analgesics / antipyretics / NSAIDs ---
  ['acetaminophen', 'paracetamol', 'tylenol', 'panadol', 'adol', 'abimol', 'cetal', 'fevadol', 'paramol'],
  ['ibuprofen', 'advil', 'motrin', 'brufen', 'nurofen'],
  ['naproxen', 'aleve'],
  ['aspirin', 'acetylsalicylic acid', 'asa', 'aspocid', 'rivo', 'juspirin'],
  ['diclofenac', 'voltaren', 'cataflam', 'catafast', 'olfen', 'rapidus', 'doloxene'],
  ['ketoprofen', 'profenid', 'ketofan'],
  ['ketorolac', 'ketolac', 'toradol'],
  ['celecoxib', 'celebrex'],
  ['meloxicam', 'mobic'],
  ['tramadol', 'tramal', 'tramadolor', 'ultram'],
  ['hyoscine butylbromide', 'hyoscine', 'buscopan'],
  // --- antibiotics ---
  ['amoxicillin clavulanate', 'co-amoxiclav', 'augmentin', 'hibiotic', 'curam', 'megamox', 'klavox'],
  ['amoxicillin', 'amoxil', 'e-mox', 'julmentin'],
  ['ampicillin sulbactam', 'sultamicillin', 'unictam', 'unasyn'],
  ['azithromycin', 'zithromax', 'zisrocin', 'azomycin'],
  ['clarithromycin', 'klacid', 'biaxin'],
  ['ciprofloxacin', 'cipro', 'ciprobay', 'ciprofar'],
  ['levofloxacin', 'tavanic', 'levalox', 'levanic'],
  ['metronidazole', 'flagyl', 'amrizole'],
  ['cephalexin', 'keflex', 'ceporex'],
  ['cefradine', 'cephradine', 'velosef'],
  ['ceftriaxone', 'rocephin', 'cefotax'],
  ['nifuroxazide', 'antinal', 'ercefuryl'],
  // --- cardio / antiplatelet / anticoagulant / statins ---
  ['clopidogrel', 'plavix', 'clopid'],
  ['warfarin', 'coumadin', 'marevan'],
  ['rivaroxaban', 'xarelto'],
  ['apixaban', 'eliquis'],
  ['atorvastatin', 'lipitor', 'ator', 'storvas'],
  ['rosuvastatin', 'crestor'],
  ['simvastatin', 'zocor'],
  ['metoprolol', 'lopressor', 'toprol'],
  ['bisoprolol', 'concor'],
  ['carvedilol', 'dilatrend', 'coreg'],
  ['amlodipine', 'norvasc', 'amlor', 'myodura'],
  ['lisinopril', 'zestril', 'prinivil'],
  ['ramipril', 'tritace'],
  ['captopril', 'capoten'],
  ['enalapril', 'ezapril', 'vasotec'],
  ['valsartan', 'diovan', 'tareg'],
  ['losartan', 'cozaar'],
  ['furosemide', 'lasix', 'frusemide'],
  ['spironolactone', 'aldactone'],
  ['nitroglycerin', 'glyceryl trinitrate', 'gtn', 'nitromak'],
  // --- PPIs / GI ---
  ['omeprazole', 'prilosec', 'losec', 'omez', 'risek', 'gastrazole'],
  ['pantoprazole', 'protonix', 'controloc', 'pantoloc'],
  ['esomeprazole', 'nexium'],
  ['ranitidine', 'zantac'],
  ['domperidone', 'motilium'],
  ['metoclopramide', 'primperan', 'reglan'],
  // --- diabetes / endocrine ---
  ['metformin', 'glucophage', 'cidophage', 'glucient'],
  ['glimepiride', 'amaryl'],
  ['gliclazide', 'diamicron'],
  ['sitagliptin', 'januvia'],
  ['insulin glargine', 'lantus'],
  ['levothyroxine', 'eltroxin', 'euthyrox', 'synthroid'],
  // --- respiratory / allergy ---
  ['salbutamol', 'albuterol', 'ventolin', 'farcolin'],
  ['fluticasone', 'flixonase', 'flixotide'],
  ['loratadine', 'claritine'],
  ['cetirizine', 'zyrtec', 'alerid'],
  ['fexofenadine', 'telfast', 'allegra'],
  ['montelukast', 'singulair'],
  // --- neuro / psych ---
  ['pregabalin', 'lyrica'],
  ['gabapentin', 'neurontin', 'conventin'],
  ['carbamazepine', 'tegretol'],
  ['valproic acid', 'sodium valproate', 'depakine'],
  ['fluoxetine', 'prozac'],
  ['escitalopram', 'cipralex', 'lexapro'],
  ['sertraline', 'zoloft', 'lustral'],
  ['alprazolam', 'xanax'],
  ['bromazepam', 'lexotanil'],
  // --- common condition abbreviations ---
  ['myocardial infarction', 'heart attack', 'mi'],
  ['acute coronary syndrome', 'acs'],
  ['ischemic heart disease', 'ischaemic heart disease', 'ihd'],
  ['hypertension', 'high blood pressure', 'htn'],
  ['blood pressure', 'bp'],
  ['diabetes mellitus', 'diabetes', 'dm'],
  ['type 2 diabetes', 'type 2 diabetes mellitus', 't2dm', 'niddm'],
  ['type 1 diabetes', 't1dm'],
  ['polycystic ovary syndrome', 'pcos'],
  ['chronic kidney disease', 'ckd'],
  ['acute kidney injury', 'aki'],
  ['chronic obstructive pulmonary disease', 'copd'],
  ['congestive heart failure', 'heart failure', 'chf'],
  ['coronary artery disease', 'cad'],
  ['cerebrovascular accident', 'stroke', 'cva'],
  ['transient ischemic attack', 'tia'],
  ['gastroesophageal reflux disease', 'gerd', 'acid reflux'],
  ['upper respiratory tract infection', 'urti'],
  ['urinary tract infection', 'uti'],
  ['deep vein thrombosis', 'dvt'],
  ['pulmonary embolism', 'pe'],
  ['venous thromboembolism', 'vte'],
  ['rheumatoid arthritis', 'ra'],
  ['osteoarthritis', 'oa'],
  ['atrial fibrillation', 'afib', 'af'],
  ['benign prostatic hyperplasia', 'bph'],
  ['inflammatory bowel disease', 'ibd'],
  ['irritable bowel syndrome', 'ibs'],
  ['non-alcoholic fatty liver disease', 'nafld'],
  ['obstructive sleep apnea', 'obstructive sleep apnoea', 'osa'],
  ['multiple sclerosis', 'ms'],
  ['tuberculosis', 'tb'],
  ['gastrointestinal', 'gi'],
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
