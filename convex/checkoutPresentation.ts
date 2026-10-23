export const TRIAL_CHECKOUT_COPY='Your 24-hour free trial has ended. Continuing is optional at ₹99 once for seven days, with no automatic charge or renewal. Your saved notes remain available. Your paid seven days begin when the paid welcome is delivered.';
const LEGACY_TRIAL_CHECKOUT_COPY='Tumhara24-hour free trial khatam ho gaya hai. Continue karna chaho toh ₹99 once for seven days—no automatic charge or renewal. Tumhare saved notes ab bhi available hain. Your paid seven days begin when the paid welcome is delivered.';
export const trialCheckoutMessage=(url:string)=>TRIAL_CHECKOUT_COPY+'\n\n'+url;
// Presentation only: the private checkout URL, order and access rules stay intact.
const valueIntroduction = 'Hi, I’m InTune 👋 One less thing to remember during perimenopause. I help keep track of the plans and details you share, with reminders you ask for.';
export const checkoutCopy = (testMode = false) => valueIntroduction +
  '\n\n₹99 once for seven days. No automatic renewal.' +
  (testMode ? '\n\nThis is a Razorpay Test Mode checkout. No real payment is taken.' : '');
// Keep a trusted button on an older checkout already queued before this copy change.
const legacyCheckoutCopy = (testMode = false) => testMode
  ? 'Your seven days with InTune cost ₹99, with no automatic renewal.\n\nThis is a Razorpay Test Mode checkout. Your week starts when your WhatsApp welcome arrives.'
  : 'Your seven days with InTune cost ₹99, with no automatic renewal.\n\nPay securely through Razorpay. Your week starts when your WhatsApp welcome arrives.';

export function checkoutMessage(url: string, testMode = false) {
  return checkoutCopy(testMode) + '\n\n' + url;
}

export function checkoutButton(body: string, checkoutRoot?: string) {
  if (!checkoutRoot) return null;
  const split = body.lastIndexOf('\n\n');
  if (split < 0) return null;
  const text = body.slice(0, split);
  const testMode = text === checkoutCopy(true) || text === legacyCheckoutCopy(true);
  if (!testMode && text !== checkoutCopy() && text !== legacyCheckoutCopy() && text !== TRIAL_CHECKOUT_COPY && text !== LEGACY_TRIAL_CHECKOUT_COPY) return null;
  try {
    const url = new URL(body.slice(split + 2)), root = new URL(checkoutRoot);
    if (url.origin !== root.origin || url.username || url.password || url.search ||
      url.pathname !== '/pilot/checkout.html' || !/^#[a-f0-9]{64}$/.test(url.hash)) return null;
    if (!(url.protocol === 'https:' && url.hostname.endsWith('.convex.site') ||
      url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) return null;
    return {text, url: url.href, label: testMode ? 'Try ₹99 test payment' : 'Pay ₹99 securely'};
  } catch { return null; }
}

// Founder-approved trial-end template body (intune_trial_end_v1, submitted to Meta 22 October 2026).
export const TRIAL_END_TEMPLATE_TEXT='Your free InTune trial has ended. Your saved notes are still here whenever you need them.\n\nIf you\'d like to keep going, it\'s ₹99 once for seven days, with no automatic charge or renewal. Tap Pay for your secure checkout.';
// Meta-approved week-end template intune_access_expiry_v1 (approved 22 October 2026); {{1}} date, {{2}} India time.
export const weekEndNudgeText=(date:string,time:string)=>`Your InTune access ends on ${date} at ${time} IST. You can record body changes, sleep, periods, workouts or questions for your doctor. For example:\n\n• “I woke up twice last night and struggled to get back to sleep.”\n• “My periods have become irregular. Keep a note of this.”\n• “I’ve been feeling more irritable this week.”\n• “I completed my 20-minute walk today.”\n• “Remind me tomorrow at 6 pm to do my usual workout.”\n• “Save this question for my doctor: Could these changes be related to perimenopause?”\n\nAsk “What have I recorded?” to look back. Your saved information remains available after access ends.`;
const WEEK_END_PATTERN=/^Your InTune access ends on (.+?) at (.+?) IST\. You can record body changes/;
export function whatsappReplyPayload(to: string, body: string, checkoutRoot?: string) {
  const weekEnd = body.match(WEEK_END_PATTERN);
  if (weekEnd && process.env.INTUNE_EXPIRY_TEMPLATE_APPROVED === '1') return {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {name: process.env.INTUNE_EXPIRY_TEMPLATE ?? 'intune_access_expiry_v1', language: {code: 'en'},
      components: [{type: 'body', parameters: [{type: 'text', text: weekEnd[1]}, {type: 'text', text: weekEnd[2]}]}]},
  };
  // The approved trial-end nudge goes as its Meta template (needed outside the 24-hour window).
  if (body === TRIAL_END_TEMPLATE_TEXT && process.env.INTUNE_TRIAL_END_TEMPLATE_APPROVED === '1') return {
    messaging_product: 'whatsapp', to, type: 'template',
    template: {name: process.env.INTUNE_TRIAL_END_TEMPLATE ?? 'intune_trial_end_v1', language: {code: 'en'}},
  };
  const button = checkoutButton(body, checkoutRoot);
  return button ? {
    messaging_product: 'whatsapp', to, type: 'interactive',
    interactive: {type: 'cta_url', body: {text: button.text},
      action: {name: 'cta_url', parameters: {display_text: button.label, url: button.url}}},
  } : {messaging_product: 'whatsapp', to, type: 'text', text: {body, preview_url: false}};
}
