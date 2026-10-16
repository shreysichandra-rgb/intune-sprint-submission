// Approved categories only. This is text matching, not diagnosis or severity scoring.
export const safetyCategories=['chest','breathing','fainting','neurological','headache','bleeding','allergy','rash','seizure','abdominal_pelvic','fever','mental','urinary','diarrhoea'] as const;
export type SafetyCategory=typeof safetyCategories[number];
export function matchSafetyCategory(text:string):SafetyCategory|null{
 const value=text.toLowerCase().replace(/’/g,"'");
 const mental=/\b(suicid\w*|self[ -]?harm|kill myself|hurt myself|harm myself|end my life|end it all|(?:immediate )?danger to (?:myself|self))\b/;
 // A denial in one clause must not cancel explicit risk in another clause.
 const risk=value.split(/\bbut\b|[.;!?]/).some(clause=>mental.test(clause)&&!/(?:\bnot\b|\bno\b|don'?t|do not|never)\s+(?:(?:having|have|feeling|feel|want|intend|any|to|in|at|thinking about|planning|considering|thoughts of)\s+){0,4}(?:suicid|self[ -]?harm|kill myself|hurt myself|harm myself|end my life|end it all|(?:immediate )?danger)/.test(clause));
 if(risk)return 'mental';
 const rules:[SafetyCategory,RegExp][]=[
 ['chest',/\bchest (pain|pressure)\b/],
 ['breathing',/\b(shortness of breath|difficulty breathing|trouble breathing|can'?t breathe|cannot breathe|can'?t catch my breath)\b/],
 ['fainting',/\b(faint(?:ed|ing)?|loss of consciousness|lost consciousness|passed out)\b/],
 ['neurological',/\b(sudden (?:weakness|numbness)|facial droop|difficulty speaking|trouble speaking)\b/],
 ['headache',/\bheadaches?\b/],['bleeding',/\b(?:(?:unusually )?heavy|uncontrolled|concerning) bleeding\b|\bbleeding\b[^.!?]{0,40}\b(?:heavy|uncontrolled|concerning)\b/],['allergy',/\ballergic reaction\b/],
 ['rash',/\b(?:skin )?rash(?:es)?\b/],['seizure',/\bseizures?\b/],
 ['abdominal_pelvic',/\b(?:abdominal|pelvic|abdomen|stomach|tummy) pain\b/],['fever',/\bfever\b/],
 ['urinary',/\b(?:urinary symptoms?|pain(?:ful)? urination|burning (?:when|while) (?:peeing|urinating)|pain (?:when|while) (?:peeing|urinating))\b/],
 ['diarrhoea',/\bdiarrh(?:oea|ea)\b/],
 ];
 return rules.find(([,pattern])=>pattern.test(value))?.[0]??null;
}

// AI labels cannot turn ordinary mood or menstrual text into crisis evidence.
export function supportedSafetyEvidence(category:string,text:string,evidence:string):boolean {
 if(!evidence.trim()||!text.toLowerCase().includes(evidence.toLowerCase()))return false;
 if(category==='mental'||category==='bleeding')return matchSafetyCategory(text)===category;
 return true;
}

// An explicit answer to the approved return question, never a new health report.
export function safetyReturnAffirmative(text:string):boolean{
 return ['yes','yes please','yeah','yep','ok','okay','confirm','haan'].includes(text.trim().toLowerCase().replace(/[.!]+$/,''));
}
