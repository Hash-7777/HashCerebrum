// Safety gate — regex-based content policy checks used across ALL LLM call sites.
// Extracted from brain/swarm/paper.ts so Peer Review, editor, and rewrite paths
// can share the same protections without importing from a feature module.

// Jailbreak / roleplay / translation-bypass / token-smuggling / reverse-psychology
//
// PRECISION RULE — this app is biomedical, so every alternative must require a
// token that has no ordinary clinical reading. Bare `virus`, `worm`, `exploit`,
// `act as`, and `play a` were previously listed here and silently diverted real
// research questions ("hepatitis B virus", "statins act as", "exploit the PD-1
// pathway", "does inflammation play a role") away from the evidence pipeline.
// Anchor a persona noun, a security object, or a computing qualifier instead.
const JAILBREAK_RX =
  /\b(act\s+as\s+(?:a\s+|an\s+|the\s+)?(?:\w+\s+){0,2}?(?:doctor|physician|nurse|pharmacist|clinician|expert|specialist|ai\b|(?:ai|language)\s+model|assistant|character|persona|dan\b|hacker|jailbreak)|in\s+character|play\s+(?:as\b|the\s+role\s+of\b)|pretend\s+(?:to\s+be|you\s+are)|you\s+are\s+now|roleplay|fictional\s+game|text-based\s+game|translate.*(?:execute|run|perform)|exécute|traduis.*exécute|forget\s+(?:all|any)\s+(?:medical\s+)?rules?|bypass\s+(?:your|the|any|all|standard|patient)\s+(?:disclaimer|rules?|guardrails?|safeguard|limitation)|hack\s+(?:into|a|the)|word\s+game|combine\s+(?:the\s+)?letters?|spell\s+out|token\s+smuggl|do\s+not\s+(?:list|tell|reveal|share|mention)\s+(?:them|it|this|that|these|any|your|the)|to\s+avoid.*repeat\s+(?:them|it|back)|what\s+you\s+are\s+avoiding|red-team|security\s+attack|penetration\s+test|exploit\s+(?:a\s+|an\s+|the\s+|this\s+)?(?:vulnerabilit\w+|cve\b|buffer\s+overflow|kernel|zero-day|rce\b|sql\s+injection)|computer\s+virus|malware|ransomware|spyware|rootkit)\b/i;

export function isJailbreakAttempt(text: string): boolean {
  return JAILBREAK_RX.test(text);
}

// Prompt injection — an instruction aimed at THIS assistant, embedded inside a
// message. Distinct from `isJailbreakAttempt` (persona/roleplay coercion) and
// from `isMetaOrAppQuestion` (harmless curiosity about the app, answerable in
// chat). An injection is never answered: the run stops and the user is asked to
// remove it, because continuing would either obey the instruction or silently
// downgrade a legitimate research question onto an ungrounded path.
//
// Every pattern requires an object that governs the ASSISTANT — a possessive,
// a system scope, or a chat-protocol marker — so ordinary clinical phrasing
// ("reveal the extent of fibrosis", "disregard previous guidelines") is inert.

// Chat-protocol / turn markers injected into free text.
const ROLE_MARKER_RX =
  /\[\s*(?:system|assistant|developer|inst)\s*[:\]]|<\|?(?:im_start|im_end|system|assistant)\|?>|(?:^|\n)\s*#{2,}\s*(?:system|instruction)|\bnew\s+instructions?\s*:|\bsystem\s+override\b|\bfrom\s+now\s+on\s+you\s+(?:are|will|must|should)\b/i;

// Demands to disclose the assistant's own governing text or credentials. The
// possessive/system scope is mandatory — a bare article is ordinary English.
const EXFIL_RX =
  /\b(?:reveal|show|print|output|repeat|display|dump|disclose|tell\s+me)\s+(?:me\s+)?(?:your|the)\s+(?:full\s+|entire\s+|exact\s+|original\s+|verbatim\s+|system\s+)*(?:prompt|instructions?|rules?|api\s+keys?|credentials?|configuration|config|source\s+code)\b/i;

// Override aimed at governing text that is unambiguously the assistant's, by
// possessive or system scope. Clinical "guidelines"/"rules" need that scope.
const SCOPED_OVERRIDE_RX =
  /\b(?:ignore|disregard|forget|override|bypass|discard|drop)\s+(?:your|the\s+system|all\s+(?:your|previous|prior)|any\s+(?:of\s+your|previous|prior))\s+(?:\w+\s+){0,2}?(?:rules?|guidelines?|constraints?|restrictions?|limitations?|policies|policy|guardrails?)\b/i;

// Override aimed at nouns that only an assistant has. Any determiner is enough.
const OVERRIDE_RX =
  /\b(?:ignore|disregard|forget|override|bypass|discard|drop)\s+(?:(?:all|any|the|these|those|previous|prior|earlier|above|preceding|initial|original|system|your)\s+){0,3}(?:system\s+)?(?:instructions?|prompts?|directives?|guardrails?)\b/i;

// "Do patients who disregard discharge instructions get readmitted?" is a real
// research question. An override verb aimed at clinical paperwork is not an
// injection, so it only counts when another signal is also present.
const CLINICAL_INSTRUCTION_RX =
  /\b(?:patient|discharge|dosing|prescrib\w+|administration|manufacturer|aftercare|care|medication|pre-?operative|post-?operative|safety)\s+instructions?\b/i;

export function isPromptInjection(text: string): boolean {
  if (ROLE_MARKER_RX.test(text) || EXFIL_RX.test(text) || SCOPED_OVERRIDE_RX.test(text)) return true;
  if (!OVERRIDE_RX.test(text)) return false;
  return !CLINICAL_INSTRUCTION_RX.test(text);
}

export const PROMPT_INJECTION_REFUSAL =
  'This message contains an instruction addressed to the assistant itself — for example text telling it to ignore ' +
  'its instructions, follow a new system message, or reveal its configuration. I have not run the research, because ' +
  'acting on an embedded instruction like that is exactly how a sourced answer gets quietly turned into an unsourced ' +
  'one.\n\nPlease remove that part and send the question again. Everything else about it is fine — the medical content ' +
  'was not the problem, and nothing was blocked because of the topic.';

// Off-topic detector: questions that are clearly not biomedical research
const OFF_TOPIC_RX =
  /\b(Napoleon|Waterloo|military\s+(?:strategy|tactic|breakdown|history)|battle\s+of|ancient\s+Rome|World\s+War|Cold\s+War|political\s+(?:party|leader|campaign|election)|stock\s+market|crypto\s+currency|bitcoin|football|soccer|basketball|NBA|FIFA|Olympics\s+(?!medical|health|doping)|movie\s+review|celebrity\s+gossip|travel\s+guide|cooking\s+recipe|car\s+repair|programming\s+tutorial)\b/i;

export function isOffTopicQuestion(text: string): boolean {
  return OFF_TOPIC_RX.test(text);
}

// Self-harm / suicide intent expressed in the first person
const SELF_HARM_RX =
  /\b(kill|harm|hurt|end)\s+(myself|my\s?self)|take\s+my\s+(own\s+)?life|commit\s+suicide|end\s+my\s+life|(so|to)\s+(i|that\s+i)\s+(can\s+)?(die|don'?t\s+wake|won'?t\s+wake|never\s+wake)|(won'?t|never|don'?t)\s+wake\s+up|overdose\s+(on\b.*\b(myself|me)|and\s+(die|end))|how\s+(much|many).*\b(i|me|my)\b.*\b(die|overdose|won'?t\s+wake|never\s+wake|not\s+wake)\b/i;

export function isSelfHarmQuery(text: string): boolean {
  return SELF_HARM_RX.test(text);
}

// Requests to harm people or critical infrastructure
const HARMFUL_REQUEST_RX =
  /\b(disable|sabotage|attack|poison|contaminate|disrupt|cripple|destroy|take\s+down)\b[^.?!]*\b(water\s+(supply|system|treatment)|power\s+(grid|station)|electrical\s+grid|food\s+supply|hospital\s+(network|system)|public\s+health\s+(system|infrastructure)|critical\s+infrastructure)\b|\b(bio(?:logical)?\s+weapon|bioweapon|chemical\s+weapon|nerve\s+agent|dirty\s+bomb|improvised\s+explosive|ied\b|mass\s+casualt|weaponi[sz]e|how\s+to\s+(make|build|synthesi[sz]e)\s+(a\s+)?(bomb|explosive|weapon))\b|\b(?:fatal|lethal|deadly|toxic)\s+(?:drug\s+)?(?:interaction|combination|dose|overdose|mix(?:ture)?)\b[^.?!]{0,90}\b(?:without\s+(?:being\s+)?(?:obvious|detect\w*|notic\w*|trace\w*|suspicio\w*|caught)|undetect\w*|unnotic\w*|untrace\w*|covert\w*|secret\w*|no\s+trace)\b|\b(?:give|administer|slip|spike|dose|feed)\s+(?:someone|somebody|a\s+person|him|her|them|my\s+\w+)\b[^.?!]{0,70}\b(?:secret\w*|covert\w*|unnotic\w*|without\s+(?:their|them|his|her)\s+(?:know\w*|notic\w*|consent)|to\s+(?:harm|hurt|sicken|poison|kill|injure|incapacitate)\b)|\b(?:embryo\s+selection|designer\s+bab(?:y|ies)|select\w*\s+(?:embryos?|genes?)|gene[\s-]?edit\w*\s+(?:embryos?|bab\w+))\b[^.?!]{0,90}\b(?:intelligence|\biq\b|athletic|height|traits?|enhanc\w*|superior|smarter|stronger|designer)\b/i;

export function isHarmfulRequest(text: string): boolean {
  return HARMFUL_REQUEST_RX.test(text);
}

// Deterministic replies (never model-generated)
export const SELF_HARM_MESSAGE =
  "I'm really sorry you're going through this, and I can't help with that request. " +
  'Please reach out right now to someone who can help: contact your local emergency number, ' +
  'or a suicide and crisis line in your country — for example, in the US call or text 988; ' +
  'in the UK and Ireland call Samaritans on 116 123. ' +
  "If you're in immediate danger, please call your local emergency services. " +
  'You deserve support from a person who can help, and reaching out is a strong first step.';

export const HARMFUL_REQUEST_REFUSAL =
  "I can't help with that. HashCerebrum is a biomedical research assistant and won't provide " +
  'guidance on harming people or critical infrastructure, including under a "historical" or ' +
  '"emergency-drill" framing. If your interest is defensive — prevention, detection, clinical ' +
  'treatment, or public-health preparedness — rephrase the question around those goals and I can help.';
