import {describe,it,expect} from 'vitest';
import {parseBrightAnswers} from '../../src/modules/ai-visibility/bright-data.js';
const q='Welke aanbieders bieden een CROV-opleiding aan?';
describe('Bright Data response evidence',()=>{
 it('keeps the original answer, distinguishes sources, and leaves missing citations unknown',()=>{
  const [a]=parseBrightAnswers([{prompt:q,answer_text:'CS Opleidingen en Habeo+',citations:[{url:null}],search_sources:[{url:'https://example.org/course',title:'Course'}],links_attached:[{url:'javascript:alert(1)'}],web_search_triggered:true,model:null,country:'NL'}],[q]);
  expect(a?.answer).toBe('CS Opleidingen en Habeo+');expect(a?.citationStatus).toBe('unknown');expect(a?.model).toBeNull();expect(a?.sources).toEqual([{url:'https://example.org/course',title:'Course',kind:'search_source'}]);
 });
 it('matches exact prompts rather than attributing reordered or missing answers by position',()=>{
  const result=parseBrightAnswers([{prompt:'Other question',answer_text:'Other answer'},{prompt:q,answer_text:'Correct answer'}],[q,'Missing question']);
  expect(result[0]?.answer).toBe('Correct answer');expect(result[1]?.status).toBe('failed');
 });
 it('does not call empty, duplicate or provider-error results a successful absence',()=>{
  for(const data of [[],[{prompt:q,answer_text:''}],[{prompt:q,answer_text:'Partial',error:'Failed'}],[{prompt:q,answer_text:'One'},{prompt:q,answer_text:'Two'}]])expect(parseBrightAnswers(data,[q])[0]?.status).toBe('failed');
 });
 it('preserves source-less answers without inventing evidence',()=>{
  const a=parseBrightAnswers([{prompt:q,answer_text:'A valid answer without references'}],[q])[0]!;
  expect(a.status).toBe('succeeded');expect(a.sources).toEqual([]);expect(a.webSearchTriggered).toBeNull();
 });
});
