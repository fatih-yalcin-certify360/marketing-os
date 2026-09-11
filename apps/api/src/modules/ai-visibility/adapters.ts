import {visibilityObservationInput,type VisibilityObservationInput,type VisibilityEngine} from '@c360/contracts';
export interface AIEngineAdapter {type:'manual_import'|'browser'|'official_api'|'third_party';healthCheck(engine:VisibilityEngine):Promise<{available:boolean;reason:string}>;capture(input:unknown):Promise<VisibilityObservationInput>;}
export class ManualImportAdapter implements AIEngineAdapter {
 readonly type='manual_import' as const;
 healthCheck(_engine:VisibilityEngine){return Promise.resolve({available:true,reason:'Handmatige registratie; context en volledigheid zijn door de gebruiker verklaard, niet automatisch vastgesteld.'});}
 capture(input:unknown){return visibilityObservationInput.parseAsync(input);}
}
/** Deliberately not a scraper. A permitted, validated implementation must replace this capability. */
export class UnavailableBrowserAdapter implements AIEngineAdapter {
 readonly type='browser' as const;
 healthCheck(_engine:VisibilityEngine){return Promise.resolve({available:false,reason:'Geen toegestane en gevalideerde automatische browseradapter geconfigureerd.'});}
 capture(_input:unknown):Promise<VisibilityObservationInput>{return Promise.reject(new Error('UNAVAILABLE: automatic consumer capture is not configured'));}
}
