import {test,expect} from 'vitest';
import {V4_FIRST_ACTION} from '../convex/v4Reply';
import {V4_INSTRUCTIONS} from '../convex/v4Instructions';
test('first action fits a short WhatsApp reply with one question and one concrete example',()=>{
 expect(V4_FIRST_ACTION.trim().split(/\s+/).length).toBeLessThanOrEqual(65);
 expect(V4_FIRST_ACTION.match(/\?/g)).toHaveLength(1);
 expect(V4_FIRST_ACTION).toMatch(/body|sleep|symptom/);
 expect(V4_FIRST_ACTION).toMatch(/workout/);
 expect(V4_FIRST_ACTION).toMatch(/doctor/);
 expect(V4_FIRST_ACTION).not.toMatch(/•/);
});
test('habitual food alternatives do not force a choice interview',()=>{
 expect(V4_INSTRUCTIONS).not.toContain('ask which alternative she uses');
});
