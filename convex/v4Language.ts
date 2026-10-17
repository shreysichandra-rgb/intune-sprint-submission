import {v4ReplyLanguage} from './v4Reply';
/** Only a language-only explanation request. Mixed facts, controls and quoted
 * text must continue through the normal independent interpretation checks. */
export function languageExplanationReply(text:string,state:any,trialEnabled:boolean):string|null {
 if(state.control.safetyPaused)return null;
 const language=v4ReplyLanguage(text);
 // Ordinary English explanation questions still need their owned context;
 // this shortcut is only an explicit language-support request.
 if(language==='English'&&!/\benglish\b/i.test(text))return null;
 if(!language||!/(?:\b(?:explain|samjh\w*|samj\w*)\b|समझ)/iu.test(text))return null;
 const words=text.toLowerCase().normalize('NFKC').replace(/[.!?,।]/gu,' ').trim().split(/\s+/u);
 const allowed=new Set('thoda thodi sa hindi hinglish english me mein mai in please plz pls explain samjaye samjhaaye samjhaye samjhaiye samjhao samjha samjha do samjhana mujhe muje can could you u it this intune ko about the a little bit to kya kripya कृपया थोड़ा थोड़ा हिंदी हिन्दी हिंग्लिश इंग्लिश अंग्रेजी में समझाइए समझाओ समझाएं समझा दो मुझे इसे यह'.split(' '));
 if(!words.length||words.some(w=>!allowed.has(w)))return null;
 const hindi=language==='Hindi',english=language==='English';
 const base=english?'Of course. InTune helps you remember the notes and existing plans you share, retrieve them and set reminders you request.':hindi?'बिलकुल। InTune आपकी बताई बातें और पहले से बने प्लान याद रखने, उन्हें वापस देखने और आपके कहे समय पर रिमाइंडर देने में मदद करता है।':'Bilkul. InTune aapki batayi baatein aur pehle se bane plans yaad rakhne, wapas dekhne aur aapke kahe waqt par reminders dene mein madad karta hai.';
 let next:string;
 if(state.control.tracking==='stopped'||!state.control.storage)next=english?'Tracking is off. You can type Help to see your available controls.':hindi?'ट्रैकिंग बंद है। अपने विकल्प देखने के लिए Help लिखें।':'Abhi tracking band hai. Available controls dekhne ke liye Help likhiye.';
 else if(state.access.mode==='eligible')next=english?'Your payment or coupon has been accepted. New tracking starts after WhatsApp confirms your welcome arrived; you do not need to pay again.':hindi?'आपका पेमेंट या कूपन स्वीकार हो चुका है। स्वागत संदेश पहुँचने की पुष्टि के बाद ट्रैकिंग शुरू होगी। दोबारा पेमेंट नहीं करना है।':'Aapka payment ya coupon accept ho chuka hai. Welcome pahunchne ki confirmation ke baad tracking shuru hogi. Dobara payment nahi karna hai.';
 else if(state.access.mode==='unpaid')next=trialEnabled?(english?'Send Join to start your free 24-hour trial, with no card or payment to start. After that, continuing is optional at ₹99 once for seven days, with no automatic charge or renewal.':hindi?'बिना कार्ड या पेमेंट के 24 घंटे का फ्री ट्रायल शुरू करने के लिए Join लिखें। उसके बाद जारी रखना चाहें तो सात दिनों के लिए एक बार ₹99 हैं। अपने आप पैसे नहीं कटेंगे और रिन्यू नहीं होगा।':'Bina card ya payment ke 24 ghante ka free trial shuru karne ke liye Join likhiye. Uske baad continue karna optional hai: ₹99 ek baar, saat din ke liye. Automatic charge ya renewal nahi hai.'):(english?'Send Join to see the ₹99 seven-day offer. No automatic renewal.':hindi?'सात दिनों के ₹99 ऑफर के लिए Join लिखें। अपने आप रिन्यू नहीं होगा।':'Saat din ke ₹99 offer ke liye Join likhiye. Automatic renewal nahi hai.');
 else if(!['active_paid','active_test'].includes(state.access.mode))next=english?'New tracking is inactive. You can still retrieve, correct or delete your saved notes.':hindi?'नई ट्रैकिंग अभी चालू नहीं है। अपनी पुरानी बातें देखना, सुधारना या हटाना अभी भी उपलब्ध है।':'Nayi tracking abhi active nahi hai. Purani saved baatein dekhna, sudharna ya delete karna abhi bhi available hai.';
 else next=english?'For example, type one question to keep for your doctor. Text only for now; you can ask me to delete your details.':hindi?'जैसे, डॉक्टर से पूछने के लिए अपना एक सवाल लिखकर भेजें। अभी सिर्फ़ टेक्स्ट इस्तेमाल करें। अपनी बातें हटाने के लिए कह सकती हैं।':'Jaise, doctor se poochhne ke liye apna ek sawaal type karke bhejiye. Abhi text only hai. Aap apni details delete karne ko keh sakti hain.';
 return base+' '+next;
}
