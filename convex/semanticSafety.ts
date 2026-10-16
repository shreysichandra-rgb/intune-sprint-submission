import {matchSafetyCategory} from './safety';
import {riskText} from './semanticBridge';

// A general danger flag must not replace explicitly described medical danger
// with invented self-harm evidence. Explicit suicide/self-harm keeps V1 priority.
export function semanticSafetyEvidence(canonical:string|undefined,risk:keyof typeof riskText|'none'|undefined):string|undefined {
 const category=canonical?matchSafetyCategory(canonical):null;
 if(risk==='immediate_danger_self'&&category&&category!=='mental')return canonical;
 return risk&&risk!=='none'?riskText[risk]:canonical;
}
