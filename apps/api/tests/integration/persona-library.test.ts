import {beforeAll,afterAll,it,expect} from 'vitest';
import {createTestHarness,labelIdBySlug,type TestHarness} from '../../src/testing/harness.js';
import type {PersonaVersion} from '@c360/contracts';
import {randomUUID} from 'node:crypto';
let h:TestHarness;
beforeAll(async()=>{h=await createTestHarness();});afterAll(async()=>{await h.close();});
it('creates a manual course persona, lists it for reuse, versions edits and rejects other-label course links',async()=>{
 const label=labelIdBySlug(h.seed,'lindenhaeghe');const course=h.seed.pilot.courseVersionId!;
 const root=`/api/v1/labels/${label}`;
 const proposal={name:'HR-professional',summary:'Een HR-professional met opleidingsbehoefte.',need:'Wil praktijksituaties zelfstandig oplossen.',motivation:'Meer vertrouwen krijgen in dagelijkse beslissingen.',barriers:['Beschikbare studietijd'],decisionCriteria:['Praktische toepasbaarheid'],relationToCourse:'Deze opleiding sluit aan op de benodigde vakkennis.',grounding:[],assumptions:['De werkgever betaalt mogelijk mee.'],orientationSources:[]};
 const created=await h.app.inject({method:'POST',url:`${root}/courses/${course}/personas`,payload:proposal});expect(created.statusCode,created.body).toBe(201);const p=created.json<PersonaVersion>();expect(p.origin).toBe('user');expect(p.courseVersionId).toBe(course);
 const list=await h.app.inject({method:'GET',url:`${root}/courses/${course}/personas`});expect(list.json<{items:PersonaVersion[]}>().items.some(x=>x.id===p.id)).toBe(true);
 expect((await h.appContext.services.personas.requireForCampaign(h.db,label,randomUUID(),course,[p.id]))[0]?.id).toBe(p.id);
 const edited=await h.app.inject({method:'PATCH',url:`${root}/personas/${p.id}`,payload:{need:'Wil meer grip krijgen op complexe praktijksituaties.'}});expect(edited.statusCode).toBe(200);expect(edited.json<PersonaVersion>().version).toBe(2);
 expect((await h.appContext.services.personas.requireForCampaign(h.db,label,randomUUID(),course,[p.id]))[0]?.need).toBe(proposal.need);
 const other=labelIdBySlug(h.seed,'demolabel-3');const cross=await h.app.inject({method:'POST',url:`/api/v1/labels/${other}/courses/${course}/personas`,payload:proposal});expect(cross.statusCode).toBe(404);
 expect((await h.app.inject({method:'POST',url:`${root}/courses/${course}/personas`,payload:{...proposal,need:''}})).statusCode).toBe(422);
});
