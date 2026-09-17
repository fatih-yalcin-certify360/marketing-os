import {z} from 'zod';
/** Stable question ids preserve answers when the wording or UI grouping changes. */
export const PERSONA_QUESTIONS = [
 {id:'q01',group:'Werk & achtergrond',questionNl:'Wat is de functie, beroepsrol of huidige bezigheid?'},
 {id:'q02',group:'Werk & achtergrond',questionNl:'In welke sector en bij welk type organisatie werkt deze persoon?'},
 {id:'q03',group:'Werk & achtergrond',questionNl:'Wat zijn de dagelijkse taken en verantwoordelijkheden?'},
 {id:'q04',group:'Werk & achtergrond',questionNl:'Hoeveel relevante werkervaring heeft deze persoon?'},
 {id:'q05',group:'Werk & achtergrond',questionNl:'Wat is de opleidingsachtergrond en welke kennis en vaardigheden zijn aanwezig?'},
 {id:'q06',group:'Werk & achtergrond',questionNl:'In welke loopbaanfase bevindt deze persoon zich?'},
 {id:'q07',group:'Persoonlijke context',questionNl:'Welke leeftijdscategorie is relevant, en waarom beïnvloedt die de leerbehoefte of keuze?'},
 {id:'q08',group:'Persoonlijke context',questionNl:'In welke regio woont of werkt deze persoon en hoeveel reistijd is acceptabel?'},
 {id:'q09',group:'Persoonlijke context',questionNl:'Welke persoonlijke omstandigheden beïnvloeden deelname, zoals werktijden of zorgtaken?'},
 {id:'q10',group:'Behoefte & motivatie',questionNl:'Wat wil deze persoon professioneel of persoonlijk bereiken?'},
 {id:'q11',group:'Behoefte & motivatie',questionNl:'Welke concrete problemen of uitdagingen ervaart deze persoon?'},
 {id:'q12',group:'Behoefte & motivatie',questionNl:'Hoe gaat deze persoon daar nu mee om en wat ontbreekt aan die aanpak?'},
 {id:'q13',group:'Behoefte & motivatie',questionNl:'Welke kennis of vaardigheden wil deze persoon ontwikkelen?'},
 {id:'q14',group:'Behoefte & motivatie',questionNl:'Welke gebeurtenis is aanleiding om een opleiding of cursus te zoeken?'},
 {id:'q15',group:'Behoefte & motivatie',questionNl:'Waarom zou deze persoon juist nu willen beginnen?'},
 {id:'q16',group:'Behoefte & motivatie',questionNl:'Wat wil deze persoon na afloop beter of zelfstandig kunnen?'},
 {id:'q17',group:'Behoefte & motivatie',questionNl:'Waaraan merkt deze persoon dat de opleiding de investering waard was?'},
 {id:'q18',group:'Behoefte & motivatie',questionNl:'Wat motiveert deze persoon het meest om te leren of zich te ontwikkelen?'},
 {id:'q19',group:'Drempels & leren',questionNl:'Welke twijfels, zorgen of eerdere leerervaringen beïnvloeden de keuze?'},
 {id:'q20',group:'Drempels & leren',questionNl:'Hoeveel tijd is beschikbaar voor lessen en zelfstudie?'},
 {id:'q21',group:'Drempels & leren',questionNl:'Welke voorkeuren of beperkingen zijn er rond lesvorm, locatie, planning en begeleiding?'},
 {id:'q22',group:'Drempels & leren',questionNl:'Welke taalvaardigheid of voorkennis is relevant voor het volgen van de opleiding?'},
 {id:'q23',group:'Keuze & aankoop',questionNl:'Welk budget is beschikbaar en wie betaalt?'},
 {id:'q24',group:'Keuze & aankoop',questionNl:'Wie beslist over deelname en welke toestemming is nodig?'},
 {id:'q25',group:'Keuze & aankoop',questionNl:'Welke personen beïnvloeden de opleidingskeuze?'},
 {id:'q26',group:'Keuze & aankoop',questionNl:'Welke drie criteria wegen het zwaarst bij het vergelijken van opleidingen?'},
 {id:'q27',group:'Keuze & aankoop',questionNl:'Welke alternatieven worden overwogen, inclusief zelfstudie, begeleiding op het werk of uitstel?'},
 {id:'q28',group:'Keuze & aankoop',questionNl:'Welke informatie of welk bewijs is nodig om vertrouwen in een opleider te krijgen?'},
 {id:'q29',group:'Keuze & aankoop',questionNl:'Wat kan ervoor zorgen dat deze persoon niet inschrijft of de keuze uitstelt?'},
 {id:'q30',group:'Oriëntatie & taal',questionNl:'Waar zoekt deze persoon informatie over opleidingen en ontwikkeling?'},
 {id:'q31',group:'Oriëntatie & taal',questionNl:'Welke zoektermen en vragen gebruikt deze persoon daarbij?'},
 {id:'q32',group:'Oriëntatie & taal',questionNl:'Welke websites, vakmedia, sociale kanalen of netwerken gebruikt deze persoon hiervoor?'},
 {id:'q33',group:'Oriëntatie & taal',questionNl:'Naar wiens ervaringen of aanbevelingen luistert deze persoon?'},
 {id:'q34',group:'Oriëntatie & taal',questionNl:'Welke vragen moeten beantwoord zijn voordat deze persoon beslist?'},
 {id:'q35',group:'Oriëntatie & taal',questionNl:'Hoe omschrijft deze persoon de eigen behoefte, twijfel en ambitie in eigen woorden?'},
 {id:'q36',group:'Onderbouwing',questionNl:'Welke antwoorden zijn gebaseerd op gesprekken, observaties of gegevens en welke zijn aannames?'},
] as const;
export const personaQuestionId=z.enum(PERSONA_QUESTIONS.map(q=>q.id));

/**
 * The thirteen questions a persona cannot be written without.
 *
 * Thirty-six is the full interview, and it is the right depth once a persona
 * matters. It is the wrong place to *start*: a marketer sitting down to test
 * the product has to answer thirty-six questions before anything exists, and
 * the honest response to that is not to shorten the interview but to say which
 * part of it decides the outcome.
 *
 * These thirteen are the fields that agency persona work actually turns on —
 * who the person is, what they are trying to get done, what is in the way, how
 * the decision is made and who makes it, what else they would do instead, where
 * they look, and their own words. Everything downstream reads them: the name,
 * the need, the motivation, the barriers, the decision criteria and the
 * orientation of a generated persona all come from this subset
 * (`personaFromQuestionnaire`).
 *
 * The other twenty-three are not dropped; they stay open, and the system can
 * fill them from the label's own material afterwards. Two are deliberately not
 * in the core: q07–q09 (age, region, personal circumstances), because a persona
 * is built from behaviour rather than demographics, and q36 (what is grounded
 * and what is assumed), because the system records that per answer instead of
 * asking someone to remember it.
 */
export const PERSONA_CORE_QUESTION_IDS = [
  // Who this is, and in what kind of organisation. Sets the language of everything else.
  'q01',
  'q02',
  // What they are trying to get done, and what is not working now.
  'q10',
  'q11',
  // Why now: the event that turns a standing wish into a search.
  'q14',
  // What is in the way, and the constraint that decides most of these purchases.
  'q19',
  'q20',
  // Who pays and who approves — rarely the same person in professional education.
  'q23',
  'q24',
  // How the choice is actually made, and what they would do instead.
  'q26',
  'q27',
  // Where they encounter the subject; this is what the channel plan leans on.
  'q32',
  // Their own words, which is what copy can be written from.
  'q35',
] as const;

export type PersonaCoreQuestionId = (typeof PERSONA_CORE_QUESTION_IDS)[number];

/** The core questions themselves, in the order of the full interview. */
export const PERSONA_CORE_QUESTIONS = PERSONA_QUESTIONS.filter(
  (question): question is (typeof PERSONA_QUESTIONS)[number] =>
    (PERSONA_CORE_QUESTION_IDS as readonly string[]).includes(question.id),
);

/** Why each core question earns its place, for the screen that asks it. */
export const PERSONA_CORE_WHY_NL: Readonly<Record<PersonaCoreQuestionId, string>> = Object.freeze({
  q01: 'De rol bepaalt de taal van alles wat volgt, en wordt de naam van de persona.',
  q02: 'Sector en type organisatie bepalen wie er meebeslist en welk bewijs telt.',
  q10: 'Het doel achter de opleiding; hier begint elke boodschap.',
  q11: 'Het probleem van nu. Zonder dit schrijf je over de opleiding in plaats van over de lezer.',
  q14: 'De aanleiding scheidt "ooit" van "nu" — en bepaalt het moment waarop een campagne landt.',
  q19: 'Het bezwaar dat de inschrijving tegenhoudt. Wat je hier niet weet, weerleg je niet.',
  q20: 'Beschikbare tijd is bij beroepsopleidingen de zwaarste praktische drempel.',
  q23: 'Budget en betaler: bij een werkgever die betaalt gaat het gesprek over iets anders.',
  q24: 'Wie akkoord moet geven. Vaak niet dezelfde persoon als de deelnemer.',
  q26: 'Waarop vergeleken wordt. Dit is waar de propositie tegenaan moet kunnen.',
  q27: 'Het echte alternatief is vaak niets doen of zelfstudie, niet een andere opleider.',
  q32: 'Via welke kanalen deze persoon op het onderwerp stuit; hierop leunt het kanaaladvies.',
  q35: 'De eigen woorden. Hieruit komt de kop die herkend wordt.',
});
/**
 * Where an answer comes from, when the system filled it in.
 *
 * `research_finding` is a claim from a research run (the `sourceRef` is the
 * finding's source URL or document name), `course_fact` a confirmed field of
 * the course card (`Opleidingskaart · <label>`), `campaign_input` the idea or
 * briefing the person typed when starting the campaign. A hand-written answer
 * has no kind. The kind, the reference and the retrieval date are what let a
 * reviewer open the source behind an answer instead of trusting the quote.
 */
export const personaAnswerSourceKind=z.enum(['research_finding','course_fact','campaign_input']);
export type PersonaAnswerSourceKind=z.infer<typeof personaAnswerSourceKind>;
/**
 * Who put an answer there, when the system knows.
 *
 * - `ai_source`: the model answered from a passage of the material the
 *   system supplied and the passage was found; the source fields say where.
 * - `ai_inference`: the model reasoned the answer from the profile and the
 *   material without a literal passage — an assumption, and `reasoningNl`
 *   says how it got there ("door AI afgeleid").
 * - `system`: the service wrote the cell because the model left the
 *   question open or answered it twice; the answer text says so.
 * - `user`: a person typed or changed it.
 * Absent on answers stored before 2026-09-14.
 */
export const personaAnswerOrigin=z.enum(['ai_source','ai_inference','system','user']);
export type PersonaAnswerOrigin=z.infer<typeof personaAnswerOrigin>;
export const personaAnswer=z.object({
  answer:z.string().max(1000),
  status:z.enum(['provided','assumption','unknown']),
  sourceQuote:z.string().max(1200).nullable(),
  /** Optional provenance, set by the system; absent on hand-written and older answers. */
  sourceRef:z.string().max(2000).nullable().optional(),
  sourceKind:personaAnswerSourceKind.nullable().optional(),
  sourceRetrievedAt:z.string().max(40).nullable().optional(),
  origin:personaAnswerOrigin.nullable().optional(),
  /** For an inferred answer: from which profile trait or passage the model reasoned, in one or two Dutch sentences. */
  reasoningNl:z.string().max(600).nullable().optional(),
});
export type PersonaAnswer=z.infer<typeof personaAnswer>;
/**
 * What the model returns when it fills the questionnaire from research.
 *
 * Every one of the 36 questions is answered (since v2 of the prompt): from a
 * literal passage of the material the system supplied — `quote` and
 * `sourceRef` name it, the service verifies both — or as a reasoned
 * assumption whose `reasoningNl` says what it was inferred from. A quote
 * that is not found demotes the answer to an assumption; a question the
 * model still leaves out is filled by the service with an explicit "not
 * derivable" cell, never with a plausible guess.
 */
export const personaQuestionnaireProposal=z.object({
  answers:z.array(z.object({
    questionId:personaQuestionId,
    answer:z.string().max(1000),
    status:z.enum(['provided','assumption','unknown']),
    quote:z.string().max(1200).nullable(),
    sourceRef:z.string().max(2000).nullable(),
    /** For an assumption: what it was inferred from. Null for a quoted answer. */
    reasoningNl:z.string().max(600).nullable().default(null),
  })).max(36),
  /** What the material could not answer and why, in Dutch. */
  noteNl:z.string().max(600),
});
export type PersonaQuestionnaireProposal=z.infer<typeof personaQuestionnaireProposal>;
export const personaQuestionnaire=z.partialRecord(personaQuestionId,personaAnswer);
export type PersonaQuestionnaire=z.infer<typeof personaQuestionnaire>;
export const personaTextInput=z.object({text:z.string().trim().min(30).max(20000),requestKey:z.uuid()});
export const personaTextExtraction=z.object({answers:z.array(z.object({questionId:personaQuestionId,answer:z.string().max(1000),status:z.enum(['provided','assumption','unknown']),quote:z.string().max(1200).nullable()})).max(36)});
