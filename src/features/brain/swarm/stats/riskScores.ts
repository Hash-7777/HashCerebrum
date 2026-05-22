//! Clinical risk scores — deterministic calculators for common prognostic
//! and diagnostic tools. Each function takes a single patient record
//! (column-name → string value) and returns a score, risk category,
//! and plain-language interpretation.
//!
//! The LLM narrates these values but never invents them.

export interface RiskScoreResult {
  score: number;
  category: string;
  interpretation: string;
  components: Record<string, number | string>;
}

function yes(value: string | undefined): boolean {
  if (!value) return false;
  return /^(1|y|yes|true|t|pos|positive|present|abnormal|active|exposed)$/.test(value.trim().toLowerCase());
}

function num(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ─── CURB-65 (community-acquired pneumonia mortality) ───────────────────────

export function curb65(record: Record<string, string>): RiskScoreResult | null {
  let score = 0;
  let present = 0;
  const components: Record<string, number | string> = {};

  const confusionVal = record.confusion ?? record.altered_mentation ?? record.gcs;
  if (confusionVal !== undefined) present += 1;
  const confusion = yes(confusionVal);
  components.confusion = confusion ? 1 : 0;
  if (confusion) score += 1;

  const bunVal = record.bun ?? record.blood_urea_nitrogen ?? record.urea;
  if (bunVal !== undefined) present += 1;
  const bun = num(bunVal);
  components.bun = bun !== null ? bun : 'missing';
  if (bun !== null && bun > 19) score += 1;

  const rrVal = record.respiratory_rate ?? record.rr;
  if (rrVal !== undefined) present += 1;
  const rr = num(rrVal);
  components.respiratory_rate = rr !== null ? rr : 'missing';
  if (rr !== null && rr >= 30) score += 1;

  const sbpVal = record.sbp ?? record.systolic_bp ?? record.bp_systolic;
  if (sbpVal !== undefined) present += 1;
  const sbp = num(sbpVal);
  components.systolic_bp = sbp !== null ? sbp : 'missing';
  if (sbp !== null && sbp < 90) score += 1;

  const dbpVal = record.dbp ?? record.diastolic_bp ?? record.bp_diastolic;
  if (dbpVal !== undefined) present += 1;
  const dbp = num(dbpVal);
  components.diastolic_bp = dbp !== null ? dbp : 'missing';
  if (dbp !== null && dbp <= 60) score += 1;

  const ageVal = record.age;
  if (ageVal !== undefined) present += 1;
  const age = num(ageVal);
  components.age = age !== null ? age : 'missing';
  if (age !== null && age >= 65) score += 1;

  if (present === 0) {
    return null; // no applicable columns
  }

  const mortality = [0.6, 2.7, 6.8, 14.0, 27.8, 27.8][score] ?? 27.8;
  const category = score <= 1 ? 'Low risk' : score === 2 ? 'Moderate risk' : 'High risk';
  return {
    score,
    category,
    interpretation: `CURB-65 = ${score} (${category}). Estimated 30-day mortality ≈ ${mortality}%. ${score >= 3 ? 'Consider ICU admission.' : ''}`,
    components,
  };
}

// ─── qSOFA (quick Sepsis-related Organ Failure Assessment) ──────────────────

export function qsofa(record: Record<string, string>): RiskScoreResult | null {
  let score = 0;
  let present = 0;
  const components: Record<string, number | string> = {};

  const rrVal = record.respiratory_rate ?? record.rr;
  if (rrVal !== undefined) present += 1;
  const rr = num(rrVal);
  components.respiratory_rate = rr !== null ? rr : 'missing';
  if (rr !== null && rr >= 22) score += 1;

  const sbpVal = record.sbp ?? record.systolic_bp ?? record.bp_systolic;
  if (sbpVal !== undefined) present += 1;
  const sbp = num(sbpVal);
  components.systolic_bp = sbp !== null ? sbp : 'missing';
  if (sbp !== null && sbp <= 100) score += 1;

  const alteredVal = record.altered_mentation ?? record.confusion ?? record.gcs;
  if (alteredVal !== undefined) present += 1;
  const altered = yes(alteredVal);
  components.altered_mentation = altered ? 1 : 0;
  if (altered) score += 1;

  if (present === 0) {
    return null;
  }

  const category = score >= 2 ? 'High risk of poor outcome' : 'Lower risk';
  return {
    score,
    category,
    interpretation: `qSOFA = ${score}. ${category}. ${score >= 2 ? 'Suspect sepsis and consider further organ assessment (SOFA).' : ''}`,
    components,
  };
}

// ─── SOFA (Sepsis-related Organ Failure Assessment) ─────────────────────────

function sofaOrganScore(
  value: number | null,
  thresholds: { points: number; max?: number }[],
): number {
  if (value === null) return 0;
  for (const { points, max } of thresholds) {
    if (max === undefined || value <= max) return points;
  }
  return thresholds[thresholds.length - 1]?.points ?? 0;
}

export function sofa(record: Record<string, string>): RiskScoreResult | null {
  const components: Record<string, number | string> = {};
  let present = 0;

  const platelets = num(record.platelets ?? record.plt);
  if (record.platelets !== undefined || record.plt !== undefined) present += 1;
  components.platelets = platelets !== null ? platelets : 'missing';
  const pltScore = sofaOrganScore(platelets, [
    { points: 0, max: 150 },
    { points: 1, max: 100 },
    { points: 2, max: 50 },
    { points: 3, max: 20 },
    { points: 4 },
  ]);

  const bili = num(record.bilirubin ?? record.bili ?? record.total_bilirubin);
  if (record.bilirubin !== undefined || record.bili !== undefined || record.total_bilirubin !== undefined) present += 1;
  components.bilirubin = bili !== null ? bili : 'missing';
  const biliScore = sofaOrganScore(bili, [
    { points: 0, max: 1.2 },
    { points: 1, max: 1.9 },
    { points: 2, max: 5.9 },
    { points: 3, max: 11.9 },
    { points: 4 },
  ]);

  const map = num(record.map ?? record.mean_arterial_pressure);
  if (record.map !== undefined || record.mean_arterial_pressure !== undefined) present += 1;
  components.map = map !== null ? map : 'missing';
  const mapScore = map !== null && map >= 70 ? 0 : map !== null ? 1 : 0;

  const gcs = num(record.gcs ?? record.glasgow_coma_scale);
  if (record.gcs !== undefined || record.glasgow_coma_scale !== undefined) present += 1;
  components.gcs = gcs !== null ? gcs : 'missing';
  const gcsScore = sofaOrganScore(gcs, [
    { points: 0, max: 14 },
    { points: 1, max: 12 },
    { points: 2, max: 9 },
    { points: 3, max: 5 },
    { points: 4 },
  ]);

  const creat = num(record.creatinine ?? record.creat);
  if (record.creatinine !== undefined || record.creat !== undefined) present += 1;
  components.creatinine = creat !== null ? creat : 'missing';
  const creatScore = sofaOrganScore(creat, [
    { points: 0, max: 1.1 },
    { points: 1, max: 1.9 },
    { points: 2, max: 3.4 },
    { points: 3, max: 4.9 },
    { points: 4 },
  ]);

  const pao2 = num(record.pao2_fio2 ?? record.pf_ratio);
  if (record.pao2_fio2 !== undefined || record.pf_ratio !== undefined) present += 1;
  components.pao2_fio2 = pao2 !== null ? pao2 : 'missing';
  const pao2Score = sofaOrganScore(pao2, [
    { points: 0, max: 399 },
    { points: 1, max: 299 },
    { points: 2, max: 199 },
    { points: 3, max: 99 },
    { points: 4 },
  ]);

  const score = pltScore + biliScore + mapScore + gcsScore + creatScore + pao2Score;

  if (present === 0) {
    return null;
  }

  const category = score >= 2 ? 'Organ dysfunction present' : 'Minimal organ dysfunction';
  return {
    score,
    category,
    interpretation: `SOFA = ${score} (${category}). In-hospital mortality risk increases with each point (≥2 suggests sepsis).`,
    components,
  };
}

// ─── CHA₂DS₂-VASc (stroke risk in atrial fibrillation) ─────────────────────

export function chadsVasc(record: Record<string, string>): RiskScoreResult | null {
  let score = 0;
  let present = 0;
  const components: Record<string, number | string> = {};

  const chfVal = record.chf ?? record.heart_failure ?? record.cardiac_failure;
  if (chfVal !== undefined) present += 1;
  const chf = yes(chfVal);
  components.chf = chf ? 1 : 0;
  if (chf) score += 1;

  const htnVal = record.htn ?? record.hypertension;
  if (htnVal !== undefined) present += 1;
  const htn = yes(htnVal);
  components.htn = htn ? 1 : 0;
  if (htn) score += 1;

  const ageVal = record.age;
  if (ageVal !== undefined) present += 1;
  const age = num(ageVal);
  components.age = age !== null ? age : 'missing';
  if (age !== null) {
    if (age >= 75) score += 2;
    else if (age >= 65) score += 1;
  }

  const dmVal = record.dm ?? record.diabetes ?? record.diabetes_mellitus;
  if (dmVal !== undefined) present += 1;
  const dm = yes(dmVal);
  components.dm = dm ? 1 : 0;
  if (dm) score += 1;

  const strokeVal = record.stroke ?? record.tia ?? record.thromboembolism;
  if (strokeVal !== undefined) present += 1;
  const stroke = yes(strokeVal);
  components.stroke_tia = stroke ? 2 : 0;
  if (stroke) score += 2;

  const vascularVal = record.vascular_disease ?? record.pvd ?? record.mi ?? record.prior_mi;
  if (vascularVal !== undefined) present += 1;
  const vascular = yes(vascularVal);
  components.vascular_disease = vascular ? 1 : 0;
  if (vascular) score += 1;

  const sexVal = record.sex ?? record.gender;
  if (sexVal !== undefined) present += 1;
  const female = /^(f|female|w|woman)$/.test((sexVal ?? '').trim().toLowerCase());
  components.female = female ? 1 : 0;
  if (female) score += 1;

  if (present === 0) {
    return null;
  }

  const annualRisk: Record<number, number> = {
    0: 0, 1: 1.3, 2: 2.2, 3: 3.2, 4: 4.0, 5: 6.7, 6: 9.8, 7: 9.6, 8: 6.7, 9: 15.2,
  };
  const risk = annualRisk[score] ?? 15.2;
  const category = score === 0 ? 'Low risk' : score === 1 ? 'Moderate risk' : 'High risk';
  return {
    score,
    category,
    interpretation: `CHA₂DS₂-VASc = ${score} (${category}). Estimated annual stroke risk ≈ ${risk}%. ${score >= 2 ? 'Oral anticoagulation recommended.' : score === 1 ? 'Consider oral anticoagulation.' : 'No anticoagulation generally needed.'}`,
    components,
  };
}

// ─── HAS-BLED (bleeding risk on anticoagulation) ────────────────────────────

export function hasBled(record: Record<string, string>): RiskScoreResult | null {
  let score = 0;
  let present = 0;
  const components: Record<string, number | string> = {};

  const htnVal = record.htn ?? record.hypertension;
  if (htnVal !== undefined) present += 1;
  const htn = yes(htnVal);
  components.htn = htn ? 1 : 0;
  if (htn) score += 1;

  const renalVal = record.renal_disease ?? record.ckd ?? record.creatinine;
  if (renalVal !== undefined) present += 1;
  const renal = yes(renalVal);
  components.renal_disease = renal ? 1 : 0;
  if (renal) score += 1;

  const liverVal = record.liver_disease ?? record.cirrhosis ?? record.hepatic;
  if (liverVal !== undefined) present += 1;
  const liver = yes(liverVal);
  components.liver_disease = liver ? 1 : 0;
  if (liver) score += 1;

  const strokeVal = record.stroke ?? record.prior_stroke;
  if (strokeVal !== undefined) present += 1;
  const stroke = yes(strokeVal);
  components.prior_stroke = stroke ? 1 : 0;
  if (stroke) score += 1;

  const bleedingVal = record.bleeding ?? record.prior_bleeding ?? record.major_bleed;
  if (bleedingVal !== undefined) present += 1;
  const bleeding = yes(bleedingVal);
  components.prior_bleeding = bleeding ? 1 : 0;
  if (bleeding) score += 1;

  const inrVal = record.labile_inr ?? record.unstable_inr;
  if (inrVal !== undefined) present += 1;
  const inr = yes(inrVal);
  components.labile_inr = inr ? 1 : 0;
  if (inr) score += 1;

  const ageVal = record.age;
  if (ageVal !== undefined) present += 1;
  const age = num(ageVal);
  components.age = age !== null ? age : 'missing';
  if (age !== null && age > 65) score += 1;

  const drugsVal = record.alcohol ?? record.alcohol_excess ?? record.bleeding_drugs;
  if (drugsVal !== undefined) present += 1;
  const drugs = yes(drugsVal);
  components.alcohol_drugs = drugs ? 1 : 0;
  if (drugs) score += 1;

  if (present === 0) {
    return null;
  }

  const category = score >= 3 ? 'High bleeding risk' : 'Lower bleeding risk';
  return {
    score,
    category,
    interpretation: `HAS-BLED = ${score} (${category}). Major bleeding risk per 100 patient-years: ≈${1.0 + score * 1.1}%. Use to balance against stroke risk (CHA₂DS₂-VASc).`,
    components,
  };
}

// ─── Wells Score (DVT / PE pre-test probability) ────────────────────────────

export function wells(record: Record<string, string>): RiskScoreResult | null {
  let score = 0;
  let present = 0;
  const components: Record<string, number | string> = {};

  const dvtVal = record.dvt_symptoms ?? record.leg_swelling ?? record.leg_pain;
  if (dvtVal !== undefined) present += 1;
  const dvt = yes(dvtVal);
  components.dvt_symptoms = dvt ? 1 : 0;
  if (dvt) score += 1;

  const peVal = record.pe ?? record.prior_pe ?? record.prior_dvt;
  if (peVal !== undefined) present += 1;
  const pe = yes(peVal);
  components.prior_pe_dvt = pe ? 1 : 0;
  if (pe) score += 1;

  const hrVal = record.heart_rate ?? record.hr;
  if (hrVal !== undefined) present += 1;
  const hr = num(hrVal);
  components.heart_rate = hr !== null ? hr : 'missing';
  if (hr !== null && hr > 100) score += 1;

  const surgeryVal = record.recent_surgery ?? record.immobilization;
  if (surgeryVal !== undefined) present += 1;
  const surgery = yes(surgeryVal);
  components.recent_surgery_immob = surgery ? 1 : 0;
  if (surgery) score += 1;

  const hemoptysisVal = record.hemoptysis;
  if (hemoptysisVal !== undefined) present += 1;
  const hemoptysis = yes(hemoptysisVal);
  components.hemoptysis = hemoptysis ? 1 : 0;
  if (hemoptysis) score += 1;

  const cancerVal = record.cancer ?? record.malignancy ?? record.active_malignancy;
  if (cancerVal !== undefined) present += 1;
  const cancer = yes(cancerVal);
  components.cancer = cancer ? 1 : 0;
  if (cancer) score += 1;

  const altDxVal = record.alternative_diagnosis ?? record.alternative_dx;
  if (altDxVal !== undefined) present += 1;
  const altDx = yes(altDxVal);
  components.alternative_diagnosis_less_likely = altDx ? 1 : 0;
  if (altDx) score += 1;

  if (present === 0) {
    return null;
  }

  const category = score <= 1 ? 'Low probability' : score <= 4 ? 'Moderate probability' : 'High probability';
  return {
    score,
    category,
    interpretation: `Wells score = ${score} (${category}). ${score <= 1 ? 'PE unlikely; consider D-dimer.' : 'PE likely; proceed to imaging (CTPA).' }`,
    components,
  };
}

// ─── MELD (Model for End-Stage Liver Disease) ───────────────────────────────

export function meld(record: Record<string, string>): RiskScoreResult | null {
  const bili = num(record.bilirubin ?? record.bili ?? record.total_bilirubin);
  const inr = num(record.inr);
  const creat = num(record.creatinine ?? record.creat);
  const sodium = num(record.sodium ?? record.na);

  if (bili === null || inr === null || creat === null) {
    return null;
  }

  const components: Record<string, number | string> = {
    bilirubin: bili,
    inr,
    creatinine: creat,
    sodium: sodium !== null ? sodium : 'missing',
  };

  // MELD 3.0 formula (simplified without albumin and sex for broader compatibility)
  // Original MELD = 3.78×ln(bili) + 11.2×ln(inr) + 9.57×ln(creat) + 6.43
  const lnBili = Math.log(Math.max(bili, 1.0));
  const lnInr = Math.log(Math.max(inr, 1.0));
  const lnCreat = Math.log(Math.max(creat, 1.0));
  let score = 3.78 * lnBili + 11.2 * lnInr + 9.57 * lnCreat + 6.43;

  // Bounds per UNOS policy
  if (bili < 1.0) score -= 3.78 * (Math.log(1.0) - lnBili);
  if (creat < 1.0) score -= 9.57 * (Math.log(1.0) - lnCreat);
  score = Math.round(score);
  score = Math.max(6, Math.min(score, 40));

  const category = score >= 30 ? 'Severe' : score >= 15 ? 'Moderate' : 'Mild';
  const threeMonth = score >= 40 ? 71.3 : score >= 30 ? 52.6 : score >= 20 ? 19.6 : score >= 10 ? 6.0 : 1.9;

  return {
    score,
    category,
    interpretation: `MELD = ${score} (${category}). Estimated 3-month mortality ≈ ${threeMonth}%. Higher scores = higher transplant priority.`,
    components,
  };
}

// ─── Registry / dispatcher ──────────────────────────────────────────────────

export type RiskScoreId =
  | 'curb65'
  | 'qsofa'
  | 'sofa'
  | 'chads_vasc'
  | 'has_bled'
  | 'wells'
  | 'meld';

export interface RiskScoreMeta {
  id: RiskScoreId;
  name: string;
  requiredColumns: string[];
  compute: (record: Record<string, string>) => RiskScoreResult | null;
}

export const RISK_SCORES: RiskScoreMeta[] = [
  { id: 'curb65', name: 'CURB-65', requiredColumns: ['confusion', 'bun', 'respiratory_rate', 'sbp', 'age'], compute: curb65 },
  { id: 'qsofa', name: 'qSOFA', requiredColumns: ['respiratory_rate', 'sbp', 'altered_mentation'], compute: qsofa },
  { id: 'sofa', name: 'SOFA', requiredColumns: ['platelets', 'bilirubin', 'map', 'gcs', 'creatinine', 'pao2_fio2'], compute: sofa },
  { id: 'chads_vasc', name: 'CHA₂DS₂-VASc', requiredColumns: ['chf', 'htn', 'age', 'dm', 'stroke', 'vascular_disease', 'sex'], compute: chadsVasc },
  { id: 'has_bled', name: 'HAS-BLED', requiredColumns: ['htn', 'renal_disease', 'liver_disease', 'stroke', 'bleeding', 'age', 'alcohol'], compute: hasBled },
  { id: 'wells', name: 'Wells Score', requiredColumns: ['dvt_symptoms', 'prior_pe', 'heart_rate', 'surgery', 'cancer'], compute: wells },
  { id: 'meld', name: 'MELD', requiredColumns: ['bilirubin', 'inr', 'creatinine'], compute: meld },
];

/** Try every registered risk score and return the first one that matches
 *  the record's columns (i.e., returns a non-null result). */
export function computeRiskScores(record: Record<string, string>): RiskScoreResult[] {
  const out: RiskScoreResult[] = [];
  for (const meta of RISK_SCORES) {
    const result = meta.compute(record);
    if (result) {
      out.push({ ...result, scoreId: meta.id, scoreName: meta.name } as RiskScoreResult & { scoreId: string; scoreName: string });
    }
  }
  return out;
}
