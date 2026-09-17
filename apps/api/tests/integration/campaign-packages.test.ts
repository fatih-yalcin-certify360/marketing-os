import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { eq } from 'drizzle-orm';
import { createCampaignInput } from '@c360/contracts';
import { brandProfileVersions, briefVersions, courseVersions } from '../../src/core/db/schema.js';
import { createTestHarness, labelIdBySlug, type TestHarness } from '../../src/testing/harness.js';
let h:TestHarness;let labelId:string;let campaignId:string;let base:string;
beforeAll(async()=>{
  h=await createTestHarness();labelId=labelIdBySlug(h.seed,'lindenhaeghe');
  const s=h.appContext.services;const courseVersionId=h.seed.pilot.courseVersionId!;
  await h.db.update(courseVersions).set({reviewState:'approved'}).where(eq(courseVersions.id,courseVersionId));
  const brand=await s.brand.requireApproved(h.db,labelId);
  await h.db.update(brandProfileVersions).set({typography:{headingFamily:'Arial',bodyFamily:'Arial',licenceNote:null}}).where(eq(brandProfileVersions.id,brand.id));
  const personas=await s.personas.propose(h.db,h.currentUser,{labelId,courseVersionId});
  for(const p of personas.personas)await s.personas.approve(h.db,h.currentUser,labelId,p.id);
  const campaign=await s.campaigns.create(h.db,h.currentUser,labelId,createCampaignInput.parse({name:'Campaign package integration',entryMode:'start_from_briefing',courseVersionId,suppliedBrief:'Help oriënterende professionals een bewuste opleidingskeuze te maken.'}));campaignId=campaign.id;base=`/api/v1/labels/${labelId}/campaigns/${campaignId}/packages`;
  const premature=await h.app.inject({method:'POST',url:base,payload:{mode:'generate',selected:['blog_faq']}});
  expect(premature.json<{error:{code:string}}>().error.code).toBe('gate_not_passed');
  const brief=await s.campaigns.draftBrief(h.db,h.currentUser,{labelId,campaignId,personaVersionIds:personas.personas.map(p=>p.id)});
  await h.db.update(briefVersions).set({ctaUrl:'https://example.org/course'}).where(eq(briefVersions.id,brief.id));
  await s.campaigns.approveBrief(h.db,h.currentUser,labelId,campaignId,brief.id,null);
  const queued = await h.app.inject({method:'POST',url:base,payload:{mode:'recommend',selected:[]}});
  expect(queued.statusCode,queued.body).toBe(202);
  await s.campaignPackages.generate(h.db,h.currentUser,{labelId,campaignId,jobId:queued.json<{id:string}>().id,attempt:1,mode:'recommend',selected:[]});
});
afterAll(async()=>{await h.close();});
describe('campaign-first packages',()=>{
  /*
   * Recommending and permitting are different acts.
   *
   * A form the model did not propose used to be refused here, with a message
   * telling the person to change an approved briefing if they wanted something
   * else — a suggestion acting as a lock. The channel plan already settles this
   * the other way round, and so does this now (2026-09-16).
   *
   * Asserted on the rule rather than on what the mock happens to propose: if
   * the mock recommended all three forms, a test that looked for an unproposed
   * one would pass while proving nothing.
   */
  it('accepts every form once a recommendation run exists, proposed or not',async()=>{
    const s=h.appContext.services;
    const all=['blog_faq','fit_check','google_studio'] as const;
    await expect(
      s.campaignPackages.assertSelection(h.db,h.currentUser,labelId,campaignId,[...all]),
    ).resolves.toBeDefined();

    // What still gates: the run that produces the material the package is built
    // from. A campaign that has had none cannot make one.
    const other=await s.campaigns.create(h.db,h.currentUser,labelId,createCampaignInput.parse({
      name:'Zonder voorstelronde',entryMode:'start_from_briefing',
      courseVersionId:h.seed.pilot.courseVersionId!,objective:'conversion',
    }));
    await expect(
      s.campaignPackages.assertSelection(h.db,h.currentUser,labelId,other.id,['blog_faq']),
    ).rejects.toMatchObject({code:'gate_not_passed'});
  });

  it('generates from approved brief, ships selected branded assets and separates Studio upload from preview',async()=>{
    const queued=await h.app.inject({method:'POST',url:base,payload:{mode:'generate',interactionStyle:'dilemma',selected:['blog_faq','google_studio']}});
    expect(queued.statusCode,queued.body).toBe(202);
    const jobId=queued.json<{id:string}>().id;
    const saved=await h.appContext.services.campaignPackages.generate(h.db,h.currentUser,{labelId,campaignId,jobId,attempt:1,mode:'generate',interactionStyle:'dilemma',selected:['blog_faq','google_studio']});
    const again=await h.appContext.services.campaignPackages.generate(h.db,h.currentUser,{labelId,campaignId,jobId,attempt:1,mode:'generate',selected:['blog_faq','google_studio']});
    expect(again.id).toBe(saved.id);
    const response=await h.app.inject({method:'GET',url:`${base}/${saved.id}/file`});expect(response.statusCode).toBe(200);
    const zip=await JSZip.loadAsync(response.rawPayload);
    const snapshot=JSON.parse(await zip.file('campagne-context.json')!.async('string')) as {interactionStyle:string};
    expect(snapshot.interactionStyle).toBe('dilemma');
    expect(zip.file('keuzehulp/index.html')).toBeNull();
    const brand=await h.appContext.services.brand.requireApproved(h.db,labelId);
    expect(await zip.file('blog/style.css')!.async('string')).toContain(brand.colors.primary);
    expect(await zip.file('blog/index.html')!.async('string')).toContain('name="description"');
    const ad=await JSZip.loadAsync(await zip.file('google-studio/300x250.zip')!.async('nodebuffer'));
    expect(await ad.file('index.html')!.async('string')).toContain('width=300,height=250');
    expect(await ad.file('index.html')!.async('string')).toContain('s0.2mdn.net/ads/studio/Enabler.js');
    expect(await ad.file('ad.js')!.async('string')).toContain("Enabler.exit('Course'");
    expect(ad.file('preview-sdk.js')).toBeNull();
    expect(Object.keys(ad.files).every((file)=>!file.includes('/'))).toBe(true);
    const evidenceUrl=`${base}/${saved.id}/evidence`;
    const evidence=await h.app.inject({method:'GET',url:evidenceUrl});
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json<{reviews:unknown[]}>().reviews).toEqual([]);
    expect(zip.file('bewijs-en-beperkingen.json')).not.toBeNull();
    const review={decision:'needs_changes',criteria:Object.fromEntries(['facts','usefulness','originality','brand','usability','measurement'].map(key=>[key,{verdict:'revise',evidence:'Een concreet punt moet nog door de inhoudsdeskundige worden gecontroleerd.'}])),comparisonReference:'Bestaande cursuspagina, versie voor de pilot',testPlan:'Laat doelgroepgebruikers de hoofdvraag beantwoorden en noteer de concrete onduidelijkheden.',baselineMinutes:null,editingMinutes:null};
    expect((await h.app.inject({method:'POST',url:`${base}/${saved.id}/reviews`,payload:review})).statusCode).toBe(201);
    expect((await h.app.inject({method:'POST',url:`${base}/${saved.id}/reviews`,payload:{...review,decision:'ready_for_pilot'}})).statusCode).toBe(422);
    const allPass={...review,decision:'ready_for_pilot',criteria:Object.fromEntries(Object.keys(review.criteria).map(key=>[key,{verdict:'pass',evidence:'Specifieke passage vergeleken met een gecontroleerde referentie.'}]))};
    // Harness generation is mock: even a complete human form cannot certify it for a live pilot.
    expect((await h.app.inject({method:'POST',url:`${base}/${saved.id}/reviews`,payload:allPass})).statusCode).toBe(409);
    const reviews=(await h.app.inject({method:'GET',url:evidenceUrl})).json<{reviews:{assessment:{decision:string;editingMinutes:number|null};reviewerUserId:string}[]}>().reviews;
    expect(reviews).toHaveLength(1);expect(reviews[0]?.assessment.editingMinutes).toBeNull();expect(reviews[0]?.reviewerUserId).toBe(h.currentUser.userId);
    const other=labelIdBySlug(h.seed,'demolabel-3');
    expect((await h.app.inject({method:'GET',url:evidenceUrl.replace(labelId,other)})).statusCode).toBe(404);
    expect((await h.app.inject({method:'POST',url:`${base.replace(labelId,other)}/${saved.id}/reviews`,payload:review})).statusCode).toBe(403);

    expect((await h.app.inject({method:'GET',url:`${base.replace(labelId,other)}/${saved.id}/file`})).statusCode).toBe(404);
    // An actual new approved brand version makes the old output stale and non-downloadable.
    const [old]=await h.db.select().from(brandProfileVersions).where(eq(brandProfileVersions.id,brand.id));
    await h.db.update(brandProfileVersions).set({reviewState:'archived'}).where(eq(brandProfileVersions.id,brand.id));
    await h.db.insert(brandProfileVersions).values({...old!,id:randomUUID(),version:brand.version+1,reviewState:'approved'});
    const stale=await h.app.inject({method:'GET',url:`${base}/${saved.id}/file`});
    expect(stale.json<{error:{code:string}}>().error.code).toBe('dependency_changed');
  });
  it('refuses empty selections and keeps recommendations a separate generation step',async()=>{
    expect((await h.app.inject({method:'POST',url:base,payload:{mode:'generate',selected:[]}})).statusCode).toBe(422);
    const queued=await h.app.inject({method:'POST',url:base,payload:{mode:'recommend',selected:[]}});
    expect(queued.statusCode,queued.body).toBe(202);
    const saved=await h.appContext.services.campaignPackages.generate(h.db,h.currentUser,{labelId,campaignId,jobId:queued.json<{id:string}>().id,attempt:1,mode:'recommend',selected:[]});
    const item=(await h.appContext.services.campaignPackages.list(h.db,h.currentUser,labelId,campaignId)).find(i=>i.id===saved.id)!;
    expect(item.report.content).toBeNull();expect(item.report.recommendations?.items.length).toBeGreaterThan(0);
    // R-4, first slice: every recommended form names the stage it serves, and
    // the recommendation is the smallest useful set rather than every form.
    expect(item.report.recommendations?.items.every(r=>r.stage!==null)).toBe(true);
    // One form per stage the campaign covers (this campaign has no objective, so a full funnel): the set is bounded by the stages, not by the catalogue.
    expect(new Set(item.report.recommendations?.items.map(r=>r.stage)).size).toBe(item.report.recommendations?.items.length);
    expect((await h.app.inject({method:'GET',url:`${base}/${saved.id}/file`})).statusCode).toBe(409);
  });
});
