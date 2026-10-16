// No cookies or analytics calls. Attribution requires the visitor to send the tag.
(function(){
 const ad=new URLSearchParams(location.search).get('ad');
 if(!ad||! /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(ad))return;
 const source=ad.toLowerCase();
 for(const link of document.querySelectorAll('a[href]')){
  const url=new URL(link.href,location.href);
  if(url.protocol==='https:'&&url.hostname==='wa.me'&&/^\/[1-9]\d{7,14}$/.test(url.pathname)&&url.searchParams.get('text')==='Join'){
   url.searchParams.set('text','Join — '+source);link.href=url.href;
  }else if(url.origin===location.origin&&['/','/how-it-works.html','/pilot/index.html'].includes(url.pathname)){
   url.searchParams.set('ad',source);link.href=url.href;
  }
 }
})();
