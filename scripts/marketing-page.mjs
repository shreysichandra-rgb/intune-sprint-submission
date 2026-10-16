export function renderMarketingPage(source,{production=false,chatUrl=''}={}) {
 if(!source.includes('href="__INTUNE_CHAT_URL__"')||!source.includes('Record your symptoms.'))throw Error('Landing source does not match its publishing contract');
 if(!production)return source.replaceAll('href="__INTUNE_CHAT_URL__"','href="#pilot"');
 if(!/^https:\/\/wa\.me\/[1-9]\d{7,14}$/.test(chatUrl))throw Error('Verified InTune business chat destination required');
 const page=source.replace('<meta name="robots" content="noindex,nofollow">','').replaceAll('href="__INTUNE_CHAT_URL__"',`href="${chatUrl}?text=Join"`);
 if(/__INTUNE_CHAT_URL__|noindex|preview-bar|Compare designs/.test(page))throw Error('Preview-only content remains');
 return page.replace('</body>','<script src="/pilot/ad-entry.js" defer></script></body>');
}
