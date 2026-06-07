/**
 * Knowledge Graph — deterministic entity and relation extraction from chunks.
 *
 * Uses regex heuristics to identify drugs, conditions, outcomes, populations,
 * and the relationships between them. Builds a persistent graph that grows
 * with every research run.
 *
 * Zero model calls. Deterministic.
 */

import type { RagChunk } from '../types';
import type { KnowledgeGraphNode, KnowledgeGraphEdge, GraphNodeType, GraphEdgeRelation } from './types';

const DRUG_RX = /\b(?:metformin|aspirin|warfarin|statin|atorvastatin|simvastatin|rosuvastatin|pravastatin|lovastatin|fluvastatin|pitavastatin|clopidogrel|rivaroxaban|apixaban|dabigatran|edoxaban|heparin|enoxaparin|insulin|glipizide|glyburide|pioglitazone|rosiglitazone|dapagliflozin|empagliflozin|canagliflozin|liraglutide|semaglutide|tirzepatide|ozempic|wegovy|rybelsus|januvia|sitagliptin|linagliptin|alogliptin|saxagliptin|amlodipine|lisinopril|losartan|valsartan|atenolol|metoprolol|carvedilol|bisoprolol|furosemide|spironolactone|hydrochlorothiazide|acetaminophen|paracetamol|tylenol|ibuprofen|naproxen|diclofenac|celecoxib|prednisone|methotrexate|azathioprine|cyclosporine|tacrolimus|mycophenolate|etanercept|adalimumab|infliximab|rituximab|tocilizumab|abatacept|ustekinumab|secukinumab|dupilumab|omalizumab|benralizumab|mepolizumab|reslizumab|albuterol|salbutamol|salmeterol|formoterol|tiotropium|ipratropium|budesonide|fluticasone|beclomethasone|ciclesonide|montelukast|zafirlukast|theophylline|roflumilast|macrolide|azithromycin|clarithromycin|erythromycin|amoxicillin|penicillin|cephalexin|ciprofloxacin|levofloxacin|moxifloxacin|doxycycline|trimethoprim|sulfamethoxazole|vancomycin|linezolid|daptomycin|meropenem|imipenem|ertapenem|piperacillin|tazobactam|ceftriaxone|cefepime|ceftaroline|gentamicin|tobramycin|amikacin|fluconazole|voriconazole|posaconazole|isavuconazole|caspofungin|micafungin|anidulafungin|acyclovir|valacyclovir|ganciclovir|valganciclovir|oseltamivir|remdesivir|molnupiravir|nirmatrelvir|ritonavir|paxlovid)\b/gi;

const CONDITION_RX = /\b(?:diabetes|diabetic|hypertension|hyperlipidemia|dyslipidemia|obesity|overweight|metabolic syndrome|insulin resistance|pcos|polycystic ovary syndrome|atherosclerosis|coronary artery disease|cad|myocardial infarction|mi|heart failure|hf|atrial fibrillation|af|stroke|ischemic stroke|hemorrhagic stroke|tia|transient ischemic attack|deep vein thrombosis|dvt|pulmonary embolism|pe|peripheral artery disease|pad|chronic kidney disease|ckd|end-stage renal disease|esrd|nephropathy|retinopathy|neuropathy|gastroparesis|fatty liver|nash|non-alcoholic steatohepatitis|cirrhosis|hepatitis|copd|chronic obstructive pulmonary disease|asthma|pneumonia|tuberculosis|covid-19|sars-cov-2|influenza|hiv|aids|sepsis|acute respiratory distress syndrome|ards|multiple sclerosis|ms|parkinson|alzheimer|dementia|epilepsy|migraine|depression|anxiety|bipolar disorder|schizophrenia|autism|adhd|rheumatoid arthritis|ra|systemic lupus erythematosus|sle|psoriasis|psoriatic arthritis|ankylosing spondylitis|inflammatory bowel disease|ibd|crohn|ulcerative colitis|celiac disease|osteoporosis|osteopenia|fracture|gout|fibromyalgia|chronic pain|sickle cell|thalassemia|hemophilia|von willebrand|anemia|leukemia|lymphoma|myeloma|melanoma|lung cancer|breast cancer|prostate cancer|colorectal cancer|pancreatic cancer|ovarian cancer|cervical cancer|bladder cancer|renal cell carcinoma|hepatocellular carcinoma|glioblastoma)\b/gi;

const OUTCOME_RX = /\b(?:mortality|death|survival|all-cause mortality|cardiovascular mortality|mi|myocardial infarction|stroke|heart failure|hf|hospitalization|readmission|quality of life|qol|adverse event|side effect|toxicity|bleeding|major bleeding|minor bleeding|gi bleeding|intracranial hemorrhage|infection|sepsis|hypoglycemia|hyperglycemia|weight gain|weight loss|bmi|blood pressure|systolic|diastolic|ldl|hdl|triglycerides|total cholesterol|hba1c|a1c|fasting glucose|insulin level|c-reactive protein|crp|troponin|bnp|nt-probnp|creatinine|egfr|albuminuria|gfr|liver enzyme|alt|ast|bilirubin|inr|ptt|platelet|wbc|rbc|hemoglobin|hematocrit|neutrophil|lymphocyte|monocyte|eosinophil|basophil|tumor marker|psa|cea|ca-125|afp|ldh|response rate|orr|overall response rate|progression-free survival|pfs|overall survival|os|disease-free survival|dfs|recurrence|relapse|remission|complete response|partial response|stable disease|progressive disease|objective response)\b/gi;

const POPULATION_RX = /\b(?:patients|participants|subjects|adults|children|adolescents|elderly|older adults|young adults|men|women|males|females|pregnant|lactating|postmenopausal|premenopausal|smokers|nonsmokers|former smokers|obese|overweight|underweight|diabetic|hypertensive|normotensive|dyslipidemic|healthy volunteers|asymptomatic|symptomatic|outpatients|inpatients|icu|intensive care|emergency department|primary care|tertiary care|hospitalized|community-dwelling|nursing home|long-term care|veterans|military|healthcare workers|immunocompromised|immunosuppressed|hiv-positive|cancer survivors|stroke survivors|heart failure patients|ckd patients|dialysis|transplant recipients|pediatric|neonatal|geriatric)\b/gi;

const BIOMARKER_RX = /\b(?:biomarker|genetic marker|snps|single nucleotide polymorphism|allele|genotype|phenotype|gene expression|protein expression|methylation|mutation|variant|deletion|insertion|duplication|translocation|fusion|amplification|loss of heterozygosity|loh|microsatellite instability|msi|tumor mutational burden|tmb|pd-l1|her2|egfr|kras|braf|alk|ros1|ret|ntrk|brca1|brca2|tp53|apc|myc|ras|mek|akt|mtor|jak|stat|nf-kb|tgf-beta|vegf|il-6|tnf-alpha|crp|hs-crp|procalcitonin|d-dimer|ferritin|transferrin|iron|vitamin d|b12|folate|homocysteine|troponin i|troponin t|ck-mb|myoglobin|bnp|nt-probnp|galectin-3|st2|gdf-15|suPAR|neutrophil-to-lymphocyte ratio|nlr|platelet-to-lymphocyte ratio|plr|systemic immune-inflammation index|sii)\b/gi;

const INTERVENTION_RX = /\b(?:surgery|resection|transplantation|radiation|radiotherapy|chemotherapy|immunotherapy|targeted therapy|hormone therapy|gene therapy|stem cell transplant|bone marrow transplant|dialysis|hemodialysis|peritoneal dialysis|catheterization|stenting|angioplasty|cabg|coronary artery bypass|valve replacement|pacemaker|defibrillator|ablation|lvad|ecmo|ventilation|mechanical ventilation|cpap|bipap|oxygen therapy|rehabilitation|physical therapy|occupational therapy|speech therapy|cognitive behavioral therapy|cbt|psychotherapy|counseling|diet|exercise|lifestyle modification|smoking cessation|alcohol reduction|weight management|bariatric surgery|gastric bypass|sleeve gastrectomy|banding|vaccination|immunization|screening|colonoscopy|mammography|psa testing|mri|ct scan|pet scan|ultrasound|x-ray|biopsy|lumbar puncture|thoracentesis|paracentesis|endoscopy|colonoscopy|bronchoscopy|laparoscopy|arthroscopy)\b/gi;

const RELATION_RX: [RegExp, GraphEdgeRelation][] = [
  [/\b(?:reduces|reduced|reduction|decrease|decreased|decreasing|lowers|lowered|lowering|improves|improved|improving|benefit|beneficial|effective|efficacious|protects|protective|prevents|preventive|favourable|favorable)\b.*\b(?:risk|mortality|death|event|rate|incidence|prevalence|progression|recurrence|relapse|symptom|severity|hospitalization|readmission|complication|adverse event|side effect)\b/gi, 'treats'],
  [/\b(?:increases|increased|increasing|raises|raised|raising|elevates|elevated|elevating|worsens|worsened|worsening|exacerbates|exacerbated|harmful|detrimental|unfavourable|unfavorable)\b.*\b(?:risk|mortality|death|event|rate|incidence|prevalence|progression|recurrence|relapse|symptom|severity|hospitalization|readmission|complication|adverse event|side effect)\b/gi, 'worsens'],
  [/\b(?:associated with|linked to|correlated with|correlation|relationship|risk factor|predictor|predictive of)\b/gi, 'associated_with'],
  [/\b(?:contraindicated|contraindication|should not be used|avoid|avoided|do not use|not recommended|not indicated)\b/gi, 'contraindicated_in'],
  [/\b(?:causes|caused|causing|induces|induced|inducing|triggers|triggered|triggering|leads to|led to|leading to|results in|resulted in|resulting in)\b/gi, 'causes'],
  [/\b(?:prevents|prevented|preventing|prophylaxis|prophylactic)\b/gi, 'prevents'],
  [/\b(?:interacts|interaction|interacting|potentiates|potentiated|antagonizes|antagonized|synergistic|synergy|additive)\b/gi, 'interacts_with'],
  [/\b(?:affects|affected|affecting|modulates|modulated|modulating|influences|influenced|influencing|alters|altered|altering|changes|changed|changing)\b/gi, 'affects'],
];

function extractMatches(text: string, rx: RegExp): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  rx.lastIndex = 0;
  while ((m = rx.exec(text)) !== null) {
    matches.push(m[0]!.toLowerCase());
  }
  return [...new Set(matches)];
}

const DRUG_WORDS = new Set([
  'metformin','aspirin','warfarin','statin','atorvastatin','simvastatin','rosuvastatin','pravastatin','lovastatin','fluvastatin','pitavastatin',
  'clopidogrel','rivaroxaban','apixaban','dabigatran','edoxaban','heparin','enoxaparin','insulin','glipizide','glyburide','pioglitazone',
  'rosiglitazone','dapagliflozin','empagliflozin','canagliflozin','liraglutide','semaglutide','tirzepatide','ozempic','wegovy','rybelsus',
  'januvia','sitagliptin','linagliptin','alogliptin','saxagliptin','amlodipine','lisinopril','losartan','valsartan','atenolol','metoprolol',
  'carvedilol','bisoprolol','furosemide','spironolactone','hydrochlorothiazide','acetaminophen','paracetamol','tylenol','ibuprofen',
  'naproxen','diclofenac','celecoxib','prednisone','methotrexate','azathioprine','cyclosporine','tacrolimus','mycophenolate','etanercept',
  'adalimumab','infliximab','rituximab','tocilizumab','abatacept','ustekinumab','secukinumab','dupilumab','omalizumab','benralizumab',
  'mepolizumab','reslizumab','albuterol','salbutamol','salmeterol','formoterol','tiotropium','ipratropium','budesonide','fluticasone',
  'beclomethasone','ciclesonide','montelukast','zafirlukast','theophylline','roflumilast','azithromycin','clarithromycin','erythromycin',
  'amoxicillin','penicillin','cephalexin','ciprofloxacin','levofloxacin','moxifloxacin','doxycycline','trimethoprim','sulfamethoxazole',
  'vancomycin','linezolid','daptomycin','meropenem','imipenem','ertapenem','piperacillin','tazobactam','ceftriaxone','cefepime',
  'ceftaroline','gentamicin','tobramycin','amikacin','fluconazole','voriconazole','posaconazole','isavuconazole','caspofungin','micafungin',
  'anidulafungin','acyclovir','valacyclovir','ganciclovir','valganciclovir','oseltamivir','remdesivir','molnupiravir','nirmatrelvir',
  'ritonavir','paxlovid'
]);
const CONDITION_WORDS = new Set([
  'diabetes','diabetic','hypertension','hyperlipidemia','dyslipidemia','obesity','overweight','metabolic syndrome','insulin resistance',
  'pcos','polycystic ovary syndrome','atherosclerosis','coronary artery disease','cad','myocardial infarction','mi','heart failure','hf',
  'atrial fibrillation','af','stroke','ischemic stroke','hemorrhagic stroke','tia','transient ischemic attack','deep vein thrombosis','dvt',
  'pulmonary embolism','pe','peripheral artery disease','pad','chronic kidney disease','ckd','end-stage renal disease','esrd','nephropathy',
  'retinopathy','neuropathy','gastroparesis','fatty liver','nash','non-alcoholic steatohepatitis','cirrhosis','hepatitis','copd',
  'chronic obstructive pulmonary disease','asthma','pneumonia','tuberculosis','covid-19','sars-cov-2','influenza','hiv','aids','sepsis',
  'acute respiratory distress syndrome','ards','multiple sclerosis','ms','parkinson','alzheimer','dementia','epilepsy','migraine',
  'depression','anxiety','bipolar disorder','schizophrenia','autism','adhd','rheumatoid arthritis','ra','systemic lupus erythematosus',
  'sle','psoriasis','psoriatic arthritis','ankylosing spondylitis','inflammatory bowel disease','ibd','crohn','ulcerative colitis',
  'celiac disease','osteoporosis','osteopenia','fracture','gout','fibromyalgia','chronic pain','sickle cell','thalassemia','hemophilia',
  'von willebrand','anemia','leukemia','lymphoma','myeloma','melanoma','lung cancer','breast cancer','prostate cancer','colorectal cancer',
  'pancreatic cancer','ovarian cancer','cervical cancer','bladder cancer','renal cell carcinoma','hepatocellular carcinoma','glioblastoma'
]);
const OUTCOME_WORDS = new Set([
  'mortality','death','survival','all-cause mortality','cardiovascular mortality','mi','myocardial infarction','stroke','heart failure','hf',
  'hospitalization','readmission','quality of life','qol','adverse event','side effect','toxicity','bleeding','major bleeding','minor bleeding',
  'gi bleeding','intracranial hemorrhage','infection','sepsis','hypoglycemia','hyperglycemia','weight gain','weight loss','bmi','blood pressure',
  'systolic','diastolic','ldl','hdl','triglycerides','total cholesterol','hba1c','a1c','fasting glucose','insulin level','c-reactive protein',
  'crp','troponin','bnp','nt-probnp','creatinine','egfr','albuminuria','gfr','liver enzyme','alt','ast','bilirubin','inr','ptt','platelet',
  'wbc','rbc','hemoglobin','hematocrit','neutrophil','lymphocyte','monocyte','eosinophil','basophil','tumor marker','psa','cea','ca-125',
  'afp','ldh','response rate','orr','overall response rate','progression-free survival','pfs','overall survival','os','disease-free survival',
  'dfs','recurrence','relapse','remission','complete response','partial response','stable disease','progressive disease','objective response'
]);
const POPULATION_WORDS = new Set([
  'patients','participants','subjects','adults','children','adolescents','elderly','older adults','young adults','men','women','males','females',
  'pregnant','lactating','postmenopausal','premenopausal','smokers','nonsmokers','former smokers','obese','overweight','underweight',
  'diabetic','hypertensive','normotensive','dyslipidemic','healthy volunteers','asymptomatic','symptomatic','outpatients','inpatients','icu',
  'intensive care','emergency department','primary care','tertiary care','hospitalized','community-dwelling','nursing home','long-term care',
  'veterans','military','healthcare workers','immunocompromised','immunosuppressed','hiv-positive','cancer survivors','stroke survivors',
  'heart failure patients','ckd patients','dialysis','transplant recipients','pediatric','neonatal','geriatric'
]);
const BIOMARKER_WORDS = new Set([
  'biomarker','genetic marker','snps','single nucleotide polymorphism','allele','genotype','phenotype','gene expression','protein expression',
  'methylation','mutation','variant','deletion','insertion','duplication','translocation','fusion','amplification','loss of heterozygosity',
  'loh','microsatellite instability','msi','tumor mutational burden','tmb','pd-l1','her2','egfr','kras','braf','alk','ros1','ret','ntrk',
  'brca1','brca2','tp53','apc','myc','ras','mek','akt','mtor','jak','stat','nf-kb','tgf-beta','vegf','il-6','tnf-alpha','crp','hs-crp',
  'procalcitonin','d-dimer','ferritin','transferrin','iron','vitamin d','b12','folate','homocysteine','troponin i','troponin t','ck-mb',
  'myoglobin','bnp','nt-probnp','galectin-3','st2','gdf-15','supar','neutrophil-to-lymphocyte ratio','nlr','platelet-to-lymphocyte ratio',
  'plr','systemic immune-inflammation index','sii'
]);
const INTERVENTION_WORDS = new Set([
  'surgery','resection','transplantation','radiation','radiotherapy','chemotherapy','immunotherapy','targeted therapy','hormone therapy',
  'gene therapy','stem cell transplant','bone marrow transplant','dialysis','hemodialysis','peritoneal dialysis','catheterization','stenting',
  'angioplasty','cabg','coronary artery bypass','valve replacement','pacemaker','defibrillator','ablation','lvad','ecmo','ventilation',
  'mechanical ventilation','cpap','bipap','oxygen therapy','rehabilitation','physical therapy','occupational therapy','speech therapy',
  'cognitive behavioral therapy','cbt','psychotherapy','counseling','diet','exercise','lifestyle modification','smoking cessation',
  'alcohol reduction','weight management','bariatric surgery','gastric bypass','sleeve gastrectomy','banding','vaccination','immunization',
  'screening','colonoscopy','mammography','psa testing','mri','ct scan','pet scan','ultrasound','x-ray','biopsy','lumbar puncture',
  'thoracentesis','paracentesis','endoscopy','colonoscopy','bronchoscopy','laparoscopy','arthroscopy'
]);

function classifyEntity(word: string): GraphNodeType {
  const w = word.toLowerCase();
  if (DRUG_WORDS.has(w)) return 'drug';
  if (CONDITION_WORDS.has(w)) return 'condition';
  if (OUTCOME_WORDS.has(w)) return 'outcome';
  if (POPULATION_WORDS.has(w)) return 'population';
  if (BIOMARKER_WORDS.has(w)) return 'biomarker';
  if (INTERVENTION_WORDS.has(w)) return 'intervention';
  return 'unknown';
}

export function extractEntities(text: string): Array<{ word: string; type: GraphNodeType }> {
  const words = new Set<string>();
  for (const w of extractMatches(text, DRUG_RX)) words.add(w);
  for (const w of extractMatches(text, CONDITION_RX)) words.add(w);
  for (const w of extractMatches(text, OUTCOME_RX)) words.add(w);
  for (const w of extractMatches(text, POPULATION_RX)) words.add(w);
  for (const w of extractMatches(text, BIOMARKER_RX)) words.add(w);
  for (const w of extractMatches(text, INTERVENTION_RX)) words.add(w);
  return [...words].map((w) => ({ word: w, type: classifyEntity(w) }));
}

export function extractRelations(text: string, _chunkId: string): Array<{ source: string; target: string; relation: GraphEdgeRelation }> {
  const relations: Array<{ source: string; target: string; relation: GraphEdgeRelation }> = [];
  const entities = extractEntities(text);
  if (entities.length < 2) return relations;

  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  for (const sentence of sentences) {
    const sentEntities = extractEntities(sentence);
    if (sentEntities.length < 2) continue;

    for (const [rx, relation] of RELATION_RX) {
      rx.lastIndex = 0;
      if (rx.test(sentence)) {
        // Link first two distinct entities in this sentence
        const [a, b] = sentEntities;
        if (a && b && a.word !== b.word) {
          relations.push({ source: a.word, target: b.word, relation });
        }
        break; // one relation per sentence max
      }
    }
  }
  return relations;
}

export function buildNodes(entities: Array<{ word: string; type: GraphNodeType }>, chunkId: string): KnowledgeGraphNode[] {
  const byWord = new Map<string, KnowledgeGraphNode>();
  for (const { word, type } of entities) {
    const existing = byWord.get(word);
    if (existing) {
      if (!existing.supportingChunks.includes(chunkId)) {
        existing.supportingChunks.push(chunkId);
        existing.confidence = Math.min(1, existing.confidence + 0.05);
        existing.lastUpdatedAt = new Date().toISOString();
      }
    } else {
      byWord.set(word, {
        id: `node-${word.replace(/\s+/g, '_')}`,
        type,
        label: word,
        aliases: [],
        confidence: 0.5,
        supportingChunks: [chunkId],
        firstSeenAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
    }
  }
  return [...byWord.values()];
}

export function buildEdges(
  relations: Array<{ source: string; target: string; relation: GraphEdgeRelation }>,
  chunkId: string,
): KnowledgeGraphEdge[] {
  const key = (s: string, t: string, r: string) => `${s}|${t}|${r}`;
  const byKey = new Map<string, KnowledgeGraphEdge>();
  for (const { source, target, relation } of relations) {
    const k = key(source, target, relation);
    const existing = byKey.get(k);
    if (existing) {
      if (!existing.supportingChunks.includes(chunkId)) {
        existing.supportingChunks.push(chunkId);
        existing.confidence = Math.min(1, existing.confidence + 0.05);
        existing.lastUpdatedAt = new Date().toISOString();
      }
    } else {
      byKey.set(k, {
        id: `edge-${source.replace(/\s+/g, '_')}-${target.replace(/\s+/g, '_')}-${relation}`,
        source,
        target,
        relation,
        confidence: 0.5,
        supportingChunks: [chunkId],
        firstSeenAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
      });
    }
  }
  return [...byKey.values()];
}

export function graphFromChunk(chunk: RagChunk): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const text = `${chunk.title} ${chunk.text}`;
  const entities = extractEntities(text);
  const nodes = buildNodes(entities, chunk.id);
  const relations = extractRelations(text, chunk.id);
  const edges = buildEdges(relations, chunk.id);
  return { nodes, edges };
}

export function mergeGraph(
  existingNodes: KnowledgeGraphNode[],
  existingEdges: KnowledgeGraphEdge[],
  newNodes: KnowledgeGraphNode[],
  newEdges: KnowledgeGraphEdge[],
): { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } {
  const nodeMap = new Map(existingNodes.map((n) => [n.id, n]));
  for (const n of newNodes) {
    const existing = nodeMap.get(n.id);
    if (existing) {
      for (const cid of n.supportingChunks) {
        if (!existing.supportingChunks.includes(cid)) {
          existing.supportingChunks.push(cid);
          existing.confidence = Math.min(1, existing.confidence + 0.05);
        }
      }
      existing.lastUpdatedAt = new Date().toISOString();
    } else {
      nodeMap.set(n.id, n);
    }
  }

  const edgeMap = new Map(existingEdges.map((e) => [e.id, e]));
  for (const e of newEdges) {
    const existing = edgeMap.get(e.id);
    if (existing) {
      for (const cid of e.supportingChunks) {
        if (!existing.supportingChunks.includes(cid)) {
          existing.supportingChunks.push(cid);
          existing.confidence = Math.min(1, existing.confidence + 0.05);
        }
      }
      existing.lastUpdatedAt = new Date().toISOString();
    } else {
      edgeMap.set(e.id, e);
    }
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}
