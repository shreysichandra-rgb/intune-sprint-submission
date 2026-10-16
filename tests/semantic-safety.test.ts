import {test,expect} from 'vitest';
import {semanticSafetyEvidence} from '../convex/semanticSafety';
import {matchSafetyCategory} from '../convex/safety';
test('generic danger flag preserves approved physical safety category',()=>{
 for(const text of ['I cannot breathe and have chest pain','I have difficulty breathing']){
  expect(semanticSafetyEvidence(text,'immediate_danger_self')).toBe(text);
  expect(matchSafetyCategory(semanticSafetyEvidence(text,'immediate_danger_self')!)).not.toBe('mental');
 }
});
test('explicit self harm retains priority alongside physical symptoms',()=>{
 for(const risk of ['suicidal_thoughts','self_harm_intent'] as const)expect(matchSafetyCategory(semanticSafetyEvidence('I have chest pain',risk)!)).toBe('mental');
 expect(matchSafetyCategory(semanticSafetyEvidence('I am in immediate danger to myself and have chest pain','immediate_danger_self')!)).toBe('mental');
});
test('standalone danger, ordinary mood and no evidence retain existing boundaries',()=>{
 expect(matchSafetyCategory(semanticSafetyEvidence('I am in danger','immediate_danger_self')!)).toBe('mental');
 expect(matchSafetyCategory(semanticSafetyEvidence('I feel low','none')!)).toBeNull();
 expect(semanticSafetyEvidence(undefined,undefined)).toBeUndefined();
});
