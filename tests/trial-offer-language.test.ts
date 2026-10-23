import {test,expect} from 'vitest';
import {trialUsefulOffer,TRIAL_NUDGE_QUESTION,PAID_NUDGE_QUESTION} from '../convex/pilotTrial';
test.each(['My breakfast routine is oats or toast','Toast','Both','Please save my question'])('English trial offer follows current English input: %s',text=>{const reply=trialUsefulOffer(text);expect(reply).toBe(TRIAL_NUDGE_QUESTION);expect(reply).not.toMatch(/chahiye|likhiye|ट्रायल|Trial reminder yes/);expect(reply).toContain('₹99');});
test('Hinglish and Hindi follow the current language and ask a plain Yes or No',()=>{expect(trialUsefulOffer('Mera note save karo')).toContain('Yes ya No likhiye');expect(trialUsefulOffer('मेरी बात याद रखो')).toContain('Yes या No लिखिए');});
test('paid and coupon weeks get the founder-approved week-end question, without a price',()=>{expect(trialUsefulOffer('Save my note','coupon')).toBe(PAID_NUDGE_QUESTION);expect(PAID_NUDGE_QUESTION).not.toContain('₹99');});
