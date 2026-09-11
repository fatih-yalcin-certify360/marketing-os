import {describe,it,expect} from 'vitest';
import {packageReviewInput} from '@c360/contracts';
const review={decision:'ready_for_pilot',criteria:Object.fromEntries(['facts','usefulness','originality','brand','usability','measurement'].map(k=>[k,{verdict:'pass',evidence:'Vergeleken met het genoemde materiaal; specifieke passage gecontroleerd.'}])),comparisonReference:'Bestaande tekst met dezelfde briefing',testPlan:'Vergelijk taakbegrip bij dezelfde doelgroep en noteer fouten en nabewerkingstijd.',baselineMinutes:null,editingMinutes:null};
describe('human review is a recorded assessment, not an AI score',()=>{
 it('requires concrete evidence and all accepted criteria for a pilot',()=>{
   expect(packageReviewInput.safeParse(review).success).toBe(true);
   expect(packageReviewInput.safeParse({...review,criteria:{...review.criteria,facts:{verdict:'revise',evidence:'Deze passage is nog niet geverifieerd.'}}}).success).toBe(false);
   expect(packageReviewInput.safeParse({...review,criteria:{...review.criteria,facts:{verdict:'pass',evidence:'Goed'}}}).success).toBe(false);
 });
 it('retains unknown timing instead of manufacturing a saving',()=>{
   const parsed=packageReviewInput.parse(review);expect(parsed.baselineMinutes).toBeNull();expect(parsed.editingMinutes).toBeNull();
   expect(packageReviewInput.safeParse({...review,editingMinutes:-1}).success).toBe(false);
 });
});
