let catalog;
export function heritageSites(){
  return catalog??=fetch(new URL('./places/heritage.json',import.meta.url)).then(r=>{
    if(!r.ok)throw Error('廟宇資料 '+r.status);
    return r.json();
  }).then(d=>d.sites).catch(e=>{catalog=null;throw e;});
}

export function installHeritagePicker(sites,site,visit){
  const stage=document.querySelector('.stage');
  const bar=document.createElement('nav');bar.id='heritagePicker';
  bar.setAttribute('aria-label','古蹟廟宇地景預覽');
  const label=document.createElement('label');label.htmlFor='heritageSelect';label.textContent='古蹟廟宇';
  const select=document.createElement('select');select.id=label.htmlFor;
  const groups=new Map();
  for(const s of sites){
    if(!groups.has(s.city)){
      const group=document.createElement('optgroup');group.label=s.city;groups.set(s.city,group);select.append(group);
    }
    groups.get(s.city).append(new Option(s.name,s.id));
  }
  select.value=site.id;select.title=site.address;
  const ref=document.createElement('a');ref.target='_blank';ref.rel='noopener';ref.textContent='實景資料 ↗';ref.href=site.source;
  bar.append(label,select,ref);stage.before(bar);
  document.body.classList.add('heritagePreview');
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./heritage-preview.css',import.meta.url);
  document.head.append(css);
  select.addEventListener('change',()=>{
    const next=sites.find(s=>s.id===select.value);
    ref.href=next.source;select.title=next.address;visit(next);
    const url=new URL(location.href);url.searchParams.set('heritage',next.id);history.replaceState(null,'',url);
  });
}