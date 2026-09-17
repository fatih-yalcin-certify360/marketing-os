import { and, eq } from 'drizzle-orm';
import { briefVersions } from '../../core/db/schema.js';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { packageQualityDossier, type CampaignPackageReport, type RadarRun } from '@c360/contracts';
import type { Db } from '../../core/db/types.js';
import { loadBrandResources } from '../../integrations/brand-portal/service.js';
import { fontFamilyNames, fontFaceStyle } from '../../integrations/brand-portal/font-names.js';
import { buildMarketPackage } from '../market-radar/package.js';
import { buildQuizFiles } from './quiz.js';
import { AppError } from '../../core/errors/app-error.js';
const esc = (s: string): string => s.replace(/[&<>"']/gu, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]!);
const SIZES = [[300,250],[336,280],[300,600]] as const;
export async function buildCampaignPackage(db: Db, storageRoot: string, report: CampaignPackageReport): Promise<Buffer> {
  if (!report.content) throw new AppError('conflict');
  const brand = report.brand;
  const [brief] = await db.select({cta:briefVersions.cta}).from(briefVersions).where(and(eq(briefVersions.id,report.briefVersionId),eq(briefVersions.campaignId,report.campaignId),eq(briefVersions.labelId,brand.labelId))).limit(1);
  const ctaLabel = report.ctaLabel ?? brief?.cta ?? 'Bekijk de opleiding';
  const resources = await loadBrandResources(db, storageRoot, brand);
  const safeFonts = new Set(['arial', 'helvetica', 'georgia', 'times new roman', 'verdana', 'sans-serif', 'serif', 'system-ui']);
  if (!resources.fontFiles.length && [brand.typography.headingFamily, brand.typography.bodyFamily].some((font) => !safeFonts.has(font.toLowerCase()))) throw new AppError('dependency_changed', { publicMessage: 'De goedgekeurde merkfonts ontbreken. Synchroniseer de fontbestanden vóór productie.' });
  if (brand.logoAssetId && !resources.logoDataUri) throw new AppError('dependency_changed', { publicMessage: 'Het goedgekeurde merklogo kan niet worden geladen.' });
  const assets: Record<string, Buffer> = {};
  let fontCss = '';
  for (const [i, filename] of resources.fontFiles.entries()) {
    const bytes = await readFile(filename); const ext = bytes.subarray(0,4).toString() === 'OTTO' ? 'otf' : 'ttf';
    const face = fontFaceStyle(bytes);
    const file = `font-${String(i)}.${ext}`; assets[file] = bytes;
    for (const family of [brand.typography.headingFamily, brand.typography.bodyFamily]) {
      if (fontFamilyNames(bytes).some((name) => name.toLowerCase() === family.toLowerCase()))
        fontCss += `@font-face{font-family:${JSON.stringify(family)};src:url(${file});font-weight:${String(face.weight)};font-style:${face.style};font-display:swap;}\n`;
    }
  }
  if (resources.logoDataUri) assets['logo.png'] = Buffer.from(resources.logoDataUri.split(',')[1]!, 'base64');
  const { primary, surface, accent, onPrimary, onSurface } = brand.colors;
  let logoBackground = surface;
  if (assets['logo.png']) {
    const {data,info} = await sharp(assets['logo.png']).resize(32,32,{fit:'inside'}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const light = (rgb: number[]): number => rgb.map(v=>{const n=v/255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i]!,0);
    let total=0,count=0;
    for(let i=0;i<data.length;i+=info.channels)if(data[i+3]!>128){total+=light([data[i]!,data[i+1]!,data[i+2]!]);count++;}
    const logoLight=count?total/count:1;
    const contrast=(hex:string):number=>{const value=light([1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)));return (Math.max(logoLight,value)+.05)/(Math.min(logoLight,value)+.05);};
    logoBackground=contrast(primary)>contrast(surface)?primary:surface;
  }
  const css = `${fontCss}\nbody{background:${surface};color:${onSurface};font-family:${JSON.stringify(brand.typography.bodyFamily)},sans-serif}h1,h2,h3,h4{font-family:${JSON.stringify(brand.typography.headingFamily)},sans-serif}main{background:${surface}}a{color:${primary}}.hint{color:${onSurface}}button,.cta{border-color:${primary};color:${onSurface};background:${surface}}button:hover,button:focus-visible,.cta{background:${primary};color:${onPrimary}}button:focus-visible,a:focus-visible{outline-color:${accent}}main{box-shadow:0 18px 60px ${onSurface}12;border-top:6px solid ${primary}}#questions{padding:20px;border:1px solid ${primary}45;border-radius:16px;background:linear-gradient(135deg,${surface},${primary}12)}#questions button{width:100%;transition:transform .15s}#questions button:hover{transform:translateX(3px)}@media(max-width:480px){body{padding:12px}main{padding:20px}#questions{padding:12px}}.brand-logo{background:${logoBackground};padding:10px;border-radius:4px;max-width:190px;max-height:75px;object-fit:contain;display:block;margin-bottom:16px}`;
  const chosen = report.selected.filter((x): x is 'blog_faq' | 'fit_check' => x !== 'google_studio');
  const radar: RadarRun = { id: report.sourceRadarRunId ?? report.campaignId, courseVersionId: report.courseVersionId, createdAt: brand.createdAt,
    report: { cards: [], notes: [], failures: [], isMock: report.isMock, audience:null, advertising:null, keywords:null, insights: [], digest: null, claims: [],
      ...report.sourceSnapshot, package:{ selected:chosen, status:'draft', brandProfileVersionId:brand.id, confirmedFacts:report.confirmedFacts, content:report.content, courseUrl:report.courseUrl, notes:[] } } };
  const zip = await JSZip.loadAsync(await buildMarketPackage(radar, chosen, report.courseName, ctaLabel));
  zip.remove('manifest.json');
  // The keuzehulp as a quiz with outcomes (2026-09-15) replaces the reflection list.
  if (chosen.includes('fit_check')) {
    const quiz = buildQuizFiles({ content: report.content, courseName: report.courseName, courseUrl: report.courseUrl, ctaLabel, campaignId: report.campaignId, isMock: report.isMock });
    for (const path of Object.keys(quiz) as (keyof typeof quiz)[]) zip.file(path, quiz[path]);
  }
  for (const folder of ['blog','keuzehulp']) {
    const page = zip.file(`${folder}/index.html`);
    if (!page) continue;
    let html = await page.async('string');
    if (assets['logo.png']) html = html.replace('<main>', '<main><img class="brand-logo" src="logo.png" alt="'+esc(brand.brandName)+'">');
    if (folder === 'blog') html = html.replace('</head>', `<meta name="description" content="${esc(report.content.intro.slice(0,155))}"></head>`);
    zip.file(`${folder}/index.html`, html);
    zip.file(`${folder}/style.css`, (await zip.file(`${folder}/style.css`)!.async('string'))+'\n'+css);
    for (const [name,bytes] of Object.entries(assets)) zip.file(`${folder}/${name}`,bytes);
  }
  const preflight: unknown[] = [];
  if (report.selected.includes('google_studio')) {
    const banner = report.content.banner;
    for (const [width,height] of SIZES) {
      const ad = new JSZip();
      const title = `${brand.brandName} ${String(width)}x${String(height)}`;
      const logo = assets['logo.png'] ? `<img src="logo.png" alt="${esc(brand.brandName)}">` : `<strong>${esc(brand.brandName)}</strong>`;
      const body = `<div id="ad"><div class="brand-art" aria-hidden="true"><i></i><i></i><i></i></div>${logo}<div id="intro"><h1>${esc(banner.headline)}</h1><p>${esc(banner.body)}</p><button id="explore" type="button">Verken jouw keuze</button></div><div id="question" hidden><h2>${esc(banner.question)}</h2>${banner.options.map((o,i)=>`<button class="choice" data-choice="${String(i)}" type="button">${esc(o.label)}</button>`).join('')}</div><div id="result" hidden><p id="feedback" aria-live="polite"></p><button id="again" type="button">Andere keuze</button></div><button id="exit" type="button">${esc(ctaLabel)} ↗</button></div>`;
      const html = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="ad.size" content="width=${String(width)},height=${String(height)}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><link rel="stylesheet" href="style.css"><script src="https://s0.2mdn.net/ads/studio/Enabler.js"></script></head><body>${body}<script src="ad.js"></script></body></html>`;
      const model = JSON.stringify({ options:banner.options, destination:report.courseUrl }).replace(/</gu,'\\u003c');
      const js = `"use strict";\nconst model=${model};\nfunction start(){\nconst intro=document.getElementById('intro'),question=document.getElementById('question'),result=document.getElementById('result'),feedback=document.getElementById('feedback');\ndocument.getElementById('explore').addEventListener('click',()=>{intro.hidden=true;question.hidden=false;Enabler.counter('Explore');question.querySelector('button').focus();});\ndocument.querySelectorAll('.choice').forEach((button)=>button.addEventListener('click',()=>{const index=Number(button.dataset.choice);feedback.textContent=model.options[index].feedback;question.hidden=true;result.hidden=false;Enabler.counter('Choice '+(index+1));document.getElementById('exit').focus();}));\ndocument.getElementById('again').addEventListener('click',()=>{result.hidden=true;question.hidden=false;question.querySelector('button').focus();});\ndocument.getElementById('exit').addEventListener('click',()=>Enabler.exit('Course',model.destination));\n}\nif(Enabler.isInitialized())start();else Enabler.addEventListener(studio.events.StudioEvent.INIT,start);\n`;
      const adCss = `${fontCss}*{box-sizing:border-box}html,body{margin:0;width:${String(width)}px;height:${String(height)}px;overflow:hidden}body{font-family:${JSON.stringify(brand.typography.bodyFamily)},sans-serif;background:${surface};color:${onSurface}}#ad{position:relative;isolation:isolate;overflow:hidden;height:100%;border:1px solid ${primary};padding:12px;display:flex;flex-direction:column;gap:7px}img{background:${logoBackground};padding:4px;border-radius:3px;max-width:140px;height:30px;object-fit:contain;object-position:left}h1,h2{font-family:${JSON.stringify(brand.typography.headingFamily)},sans-serif;font-size:${String(height>300?26:19)}px;line-height:1.15;margin:4px 0}p{font-size:13px;line-height:1.3;margin:5px 0}button{font:inherit;font-size:13px;cursor:pointer;padding:7px;border-radius:5px;background:${surface};color:${onSurface};border:1px solid ${primary}}button:focus-visible{outline:2px solid ${accent};outline-offset:1px}#exit{margin-top:auto;background:${primary};color:${onPrimary}}.choice{display:block;width:100%;margin:7px 0}#feedback{font-size:17px}#ad>div:not(.brand-art){animation:reveal .3s ease-out}.brand-art{overflow:hidden;position:absolute;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(ellipse at 110% -15%,${primary}33,transparent 60%),linear-gradient(130deg,${surface} 60%,${primary}18)}.brand-art i{position:absolute;display:block;width:220px;height:220px;border:28px solid ${primary}24;border-radius:50%;right:-125px;bottom:20px;transform:rotate(-30deg)}.brand-art i:nth-child(2){width:170px;height:170px;right:-80px;bottom:45px;border-color:${accent}18;border-width:2px}.brand-art i:nth-child(3){width:60px;height:60px;right:10px;bottom:90px;border-radius:16px;border:0;background:${primary}18}#ad>img{flex-shrink:0}#exit{font-weight:650;box-shadow:0 3px 0 ${onSurface}24}#explore{border-radius:20px;padding:6px 12px}#intro,#question,#result{position:relative} ${height>300?`#ad{padding:22px;gap:24px}h1,h2{font-size:32px;line-height:1.12}p{font-size:16px;line-height:1.45}#intro p{margin:18px 0}#explore{margin-top:10px}.brand-art i{width:360px;height:360px;right:-180px;bottom:75px;border-width:58px}.brand-art i:nth-child(2){width:260px;height:260px;right:-85px;bottom:125px;border-width:3px}.brand-art i:nth-child(3){width:105px;height:105px;right:45px;bottom:195px}#exit{padding:13px}`:''}@keyframes reveal{from{opacity:.3}to{opacity:1}}@media(prefers-reduced-motion:reduce){#ad>div{animation:none}}[hidden]{display:none!important}`;
      ad.file('index.html',html);ad.file('style.css',adCss);ad.file('ad.js',js);
      for (const [name,bytes] of Object.entries(assets)) ad.file(name,bytes);
      const total = Buffer.byteLength(html+adCss+js)+Object.values(assets).reduce((n,b)=>n+b.length,0);
      if (total>5_000_000 || Object.keys(ad.files).length>100) throw new AppError('validation_failed',{publicMessage:'De merkbestanden passen niet binnen de bannerlimiet. Optimaliseer de fonts en het logo zonder de merkregels te wijzigen.'});
      const buffer = await ad.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
      zip.file(`google-studio/${String(width)}x${String(height)}.zip`,buffer);
      // Local preview is outside upload ZIP; production always uses Google's SDK.
      zip.file(`preview/${String(width)}x${String(height)}/index.html`,html.replace('<script src="https://s0.2mdn.net/ads/studio/Enabler.js"></script>', '<script src="preview-sdk.js"></script>'));
      zip.file(`preview/${String(width)}x${String(height)}/preview-sdk.js`, `const Enabler={isInitialized:()=>true,counter:(name)=>console.log('Preview counter',name),exit:(name,url)=>window.open(url,'_blank','noopener')};`);
      zip.file(`preview/${String(width)}x${String(height)}/ad.js`,js);zip.file(`preview/${String(width)}x${String(height)}/style.css`,adCss);
      for (const [name,bytes] of Object.entries(assets)) zip.file(`preview/${String(width)}x${String(height)}/${name}`,bytes);
      preflight.push({target:'google_studio',width,height,zipBytes:buffer.length,downloadBytes:total,files:Object.keys(ad.files).length,animationSeconds:0.3,exit:'Enabler.exit / Course',structuralChecks:'passed',browserLayout:'requires_review',googleQa:'not_submitted',publisherSpecifications:'must_be_checked'});
    }
  }
  zip.file('LEESMIJ.txt', `CONCEPT CAMPAGNEPAKKET\nCampagne: ${report.campaignId}\nBriefing: ${report.briefVersionId}\nMerk: ${brand.brandName}, versie ${String(brand.version)}, release ${brand.portal?.release ?? 'handmatig goedgekeurd'}\n\nDit pakket volgt de goedgekeurde briefing en vastgelegde actuele merkregels. Controleer interpretaties, copy en visuele toepassing vóór publicatie.\nBlog: HTML/Markdown met meta-description. Geen garantie op SEO-resultaat.\nKeuzehulp: open index.html; JS en TypeScript zijn meegeleverd. Iframe-pad aanpassen aan de eigen hosting.\nGoogle Studio: upload elke ZIP onder google-studio afzonderlijk naar Studio. Niet bedoeld als Google Ads-upload. Preview gebruikt een lokale SDK-vervanger en bewijst geen Google-goedkeuring. Productie gebruikt de echte Enabler. Configureer en test Course-exit, counters en de uiteindelijke bestemming in Studio. Uitgeverspecificaties en Google QA blijven verplicht.\nTechnische bronnen (gecontroleerd 2026-09-10): https://support.google.com/richmedia/answer/2672545 en https://support.google.com/richmedia/answer/2672562 en https://support.google.com/displayvideo/answer/10261241\n`);
  zip.file('merkcontrole.txt', [brand.typography.licenceNote ?? '', ...(brand.portal?.warnings ?? []), 'Copy, claims en visuele toepassing blijven te controleren vóór publicatie.'].join('\n'));
  zip.file('bewijs-en-beperkingen.json',JSON.stringify(packageQualityDossier(report),null,2));
  zip.file('campagne-context.json',JSON.stringify({...report,ctaLabel},null,2));
  zip.file('platform-controle.json',JSON.stringify(preflight,null,2));
  const manifest = [];
  for (const [file,entry] of Object.entries(zip.files)) if(!entry.dir) manifest.push({path:file,bytes:(await entry.async('uint8array')).length});
  zip.file('manifest.json',JSON.stringify({campaignId:report.campaignId,briefVersionId:report.briefVersionId,brandProfileVersionId:brand.id,status:'draft',files:manifest},null,2));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
