import {test,expect} from 'vitest';
import {TRIAL_WELCOME,trialPermissionReply} from '../convex/pilotTrial';
import {TRIAL_CHECKOUT_COPY,checkoutButton} from '../convex/checkoutPresentation';
test('neutral Join does not force Hindi, request payment or overwhelm with a plan interview',()=>{
 expect(TRIAL_WELCOME).toContain('No payment needed');expect(TRIAL_WELCOME).toContain('24-hour');expect(TRIAL_WELCOME).toContain('₹99');expect(TRIAL_WELCOME).toContain('delete');expect(TRIAL_WELCOME).not.toMatch(/Main InTune|bhej|tumhara|apna/i);
});
test('explicit English trial consent gets English acknowledgement, while Hinglish stays supported',()=>{
 expect(trialPermissionReply('Yes',true)).toBe('Done 👍 I’ll send just that one message. No automatic charge.');expect(trialPermissionReply('No',false)).toBe('No problem, I won’t send it. Your notes stay saved either way.');expect(trialPermissionReply('Trial reminder haan',true)).toContain('Ho gaya');
});
test('reworded trial checkout keeps the validated private payment button and legacy queued copy',()=>{
 const url='https://graceful-ptarmigan-19.convex.site/pilot/checkout.html#'+'a'.repeat(64);
 expect(checkoutButton(TRIAL_CHECKOUT_COPY+'\n\n'+url,url)?.url).toBe(url);
 const old='Tumhara24-hour free trial khatam ho gaya hai. Continue karna chaho toh ₹99 once for seven days—no automatic charge or renewal. Tumhare saved notes ab bhi available hain. Your paid seven days begin when the paid welcome is delivered.';
 expect(checkoutButton(old+'\n\n'+url,url)?.url).toBe(url);expect(checkoutButton(TRIAL_CHECKOUT_COPY+'\n\nhttps://untrusted.example',url)).toBeNull();
});
