import {test,expect} from 'vitest';
import {trialUsefulOffer} from '../convex/pilotTrial';
test.each(['My breakfast routine is oats or toast','Toast','Both','Please save my question'])('English trial offer follows current English input: %s',text=>{const reply=trialUsefulOffer(text);expect(reply).toContain('If you');expect(reply).not.toMatch(/chahiye|bhejo|Nahi|ट्रायल/);expect(reply).toContain('₹99');expect(reply).toContain('Trial reminder yes');});
test('Hinglish and Hindi follow the current language without changing consent command',()=>{expect(trialUsefulOffer('Mera note save karo')).toContain('bhejo');expect(trialUsefulOffer('मेरी बात याद रखो')).toContain('भेजें');});
