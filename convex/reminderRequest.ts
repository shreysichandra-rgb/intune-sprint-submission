/** Explicit reminder requests only; a time or preference is not permission. */
export function hasReminderRequest(text:string){
 if(/remind|nudge|check[ -]?in/i.test(text))return true;
 const request=/\byaad\s+dila(?:na|\s+(?:dena|do))\b|याद\s+दिला(?:ना|\s+(?:देना|दो))/i;
 return request.test(text)&&!/(?:\b(?:mat|nahi|nahin)\b|मत|नहीं)[^.!?]{0,35}(?:yaad|याद)|(?:yaad|याद)[^.!?]{0,35}(?:\b(?:mat|nahi|nahin)\b|मत|नहीं)/i.test(text);
}
