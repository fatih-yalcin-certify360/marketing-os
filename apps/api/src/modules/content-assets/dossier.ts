import {
  CHANNEL_LABEL_NL,
  FUNNEL_STAGE_LABEL_NL,
  PERSONA_QUESTIONS,
  type ActorRef,
  type ContentAssetVersion,
  type PersonaVersion,
} from '@c360/contracts';

/**
 * One piece of content as a document you can hand to someone.
 *
 * ## Why this exists
 *
 * A piece of content lived only in the product. To show a colleague what was
 * made, for whom and on whose instruction, you sent a link and they needed an
 * account, a label and a screen — or you copied the text into a mail and every
 * bit of provenance fell off on the way.
 *
 * So this assembles the whole record: who it is for, what was asked, what came
 * out, and everything needed to judge it — the version, the review state, the
 * fact that a model wrote it, and the attention points that are still open.
 *
 * ## Why it is a model and not a file
 *
 * Two formats are produced from this — Word and PDF — and the thing that must
 * not differ between them is *what is in them*. Deciding the content once, in
 * one pure function with no file format in sight, is what keeps a fix in one
 * of them from being missing in the other. The renderers decide how a heading
 * looks; they never decide whether there is one.
 *
 * ## What it will not do
 *
 * Nothing here computes, softens or completes anything. A field that is empty
 * is printed as empty with the reason; the instruction of a piece made before
 * instructions were kept reads "niet vastgelegd" rather than being
 * reconstructed from the text it produced. A draft says it is a draft on the
 * first page.
 */

/** One element of the document, in reading order. */
export type DossierBlock =
  | { kind: 'title'; text: string }
  | { kind: 'subtitle'; text: string }
  /** A numbered part of the dossier; starts on its own page. */
  | { kind: 'heading'; text: string }
  | { kind: 'subheading'; text: string }
  | { kind: 'paragraph'; text: string }
  /** Set apart: the instruction in the requester's own words, a source quote. */
  | { kind: 'quote'; text: string }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'fields'; rows: readonly { term: string; value: string }[] }
  /** Small print: what is not verified, what is still open. */
  | { kind: 'note'; text: string }
  | { kind: 'pageBreak' };

export interface Dossier {
  /** The document's own title, and the name of the file. */
  title: string;
  subtitle: string;
  /** Without extension, without characters a file system argues about. */
  fileName: string;
  blocks: readonly DossierBlock[];
}

export interface DossierInput {
  asset: ContentAssetVersion;
  label: { name: string };
  course: { name: string; externalCode: string | null; courseUrl: string | null };
  /**
   * The audiences recorded on the piece, resolved, each with whoever wrote it.
   *
   * The author travels with the persona rather than being looked up in the
   * document: a dossier is read away from the product, where "wie heeft dit
   * bedacht" cannot be clicked on.
   */
  personas: readonly { version: PersonaVersion; createdBy: ActorRef | null }[];
  /** The person the piece was made by, as our own user record has them. */
  createdBy: { displayName: string; email: string } | null;
  /** The campaign it belongs to, for a piece that is not standalone. */
  campaignName: string | null;
  /** When this document was produced, ISO. Passed in so the function stays pure. */
  generatedAt: string;
}

const REVIEW_NL: Record<string, string> = {
  draft: 'Concept — nog niet beoordeeld',
  in_review: 'Ter beoordeling',
  changes_requested: 'Wijziging gevraagd',
  approved: 'Goedgekeurd',
  needs_rereview: 'Opnieuw beoordelen',
  archived: 'Gearchiveerd',
};

const ORIGIN_NL: Record<string, string> = {
  ai_generated: 'Door AI geschreven',
  user: 'Door een mens geschreven of aangepast',
  imported: 'Geïmporteerd',
  system: 'Door het systeem samengesteld',
};

const SOURCE_NL: Record<string, string> = {
  manual: 'Met de hand gevraagd',
  geo_report: 'Uit een AI-visibility-onderzoek',
  radar_card: 'Uit een kans in de Market Radar',
  radar_insight: 'Uit een inzicht in de Market Radar',
};

export function buildDossier(input: DossierInput): Dossier {
  const { asset, course, label } = input;
  const blocks: DossierBlock[] = [];
  const title = pieceTitle(asset);

  blocks.push({ kind: 'title', text: title });
  blocks.push({
    kind: 'subtitle',
    text: `${CHANNEL_LABEL_NL[asset.channel]} · ${label.name} · ${course.name}`,
  });

  // ---------------------------------------------------------- 1. the facts --
  blocks.push({ kind: 'heading', text: '1. Waar dit over gaat' });
  blocks.push({ kind: 'fields', rows: factRows(input) });

  /*
   * The state of the piece, said plainly and early.
   *
   * A dossier travels: it is mailed, printed and forwarded, and by then
   * nothing around it says any more that this is a draft a model wrote. So it
   * says so itself, on the first page, before the text anybody came to read.
   */
  blocks.push({ kind: 'note', text: statusNote(asset) });

  const blocking = asset.warnings.filter((warning) => warning.blocksPublishReady).length;
  if (asset.warnings.length > 0) {
    blocks.push({ kind: 'note', text: warningsNote(asset.warnings.length, blocking) });
  }

  // ------------------------------------------------------- 2. the audience --
  blocks.push({ kind: 'pageBreak' });
  blocks.push({ kind: 'heading', text: '2. Voor wie dit geschreven is' });
  if (input.personas.length === 0) {
    blocks.push({
      kind: 'paragraph',
      text:
        'Bij deze uiting is geen doelgroep gekozen. De tekst is geschreven voor de opleiding in het algemeen, op basis van de opleidingskaart en het merkprofiel — niet voor een specifieke persona.',
    });
  } else {
    for (const [index, entry] of input.personas.entries()) {
      if (index > 0) blocks.push({ kind: 'pageBreak' });
      blocks.push(...personaBlocks(entry.version, entry.createdBy));
    }
  }

  // ---------------------------------------------------- 3. the instruction --
  blocks.push({ kind: 'pageBreak' });
  blocks.push({ kind: 'heading', text: '3. Wat er gevraagd is' });
  if (asset.instructionNl !== null && asset.instructionNl.trim().length > 0) {
    blocks.push({
      kind: 'paragraph',
      text: 'De opdracht voor deze uiting, letterlijk zoals die is ingevoerd:',
    });
    for (const passage of paragraphs(asset.instructionNl)) {
      blocks.push({ kind: 'quote', text: passage });
    }
  } else if (asset.ownerScope === 'campaign') {
    blocks.push({
      kind: 'paragraph',
      text:
        'Deze uiting komt uit een campagne en is niet uit één opdracht geschreven, maar uit de goedgekeurde briefing en het gekozen concept van die campagne. Die staan in de campagne zelf; de versies waaruit dit stuk is voortgekomen staan achteraan dit dossier.',
    });
  } else {
    blocks.push({
      kind: 'paragraph',
      text:
        'De opdracht bij deze uiting is niet vastgelegd. Losse uitingen bewaren sinds 17 september 2026 de ingevoerde opdracht; dit stuk is daarvoor gemaakt en de oorspronkelijke tekst is niet te achterhalen. Hij is hier niet gereconstrueerd.',
    });
  }

  // -------------------------------------------------------- 4. the content --
  blocks.push({ kind: 'pageBreak' });
  blocks.push({ kind: 'heading', text: '4. De uiting' });
  blocks.push(...contentBlocks(asset));

  // ----------------------------------------------------- 5. what is open ----
  blocks.push({ kind: 'pageBreak' });
  blocks.push({ kind: 'heading', text: '5. Aandachtspunten en herkomst' });
  if (asset.warnings.length === 0) {
    blocks.push({
      kind: 'paragraph',
      text: 'De kanaalcontrole meldt geen aandachtspunten bij deze versie.',
    });
  } else {
    blocks.push({
      kind: 'bullets',
      items: asset.warnings.map(
        (warning) =>
          `${warning.blocksPublishReady ? 'Houdt een publicatieklaar pakket tegen — ' : ''}${warning.messageNl}`,
      ),
    });
  }
  blocks.push({ kind: 'subheading', text: 'Waar dit stuk op gebaseerd is' });
  blocks.push({ kind: 'fields', rows: provenanceRows(input) });
  blocks.push({
    kind: 'note',
    text:
      'Dit dossier is een weergave van wat er in het systeem staat op het moment van downloaden. Het is geen goedkeuring en geen bewijs van juistheid: cijfers, voorwaarden en erkenningen in de tekst horen tegen de bron gecontroleerd te worden voordat er iets mee naar buiten gaat.',
  });

  return { title, subtitle: `${CHANNEL_LABEL_NL[asset.channel]} · ${label.name}`, fileName: fileName(asset, title), blocks };
}

/** The piece's own name: the article title where there is one, else its opening line. */
function pieceTitle(asset: ContentAssetVersion): string {
  const website = asset.copy.website;
  if (website?.form === 'blog_article') return website.title;
  if (website?.form === 'course_page_update') return `Wijzigingen voor ${website.pageUrl}`;
  const hook = asset.copy.hook.trim();
  return hook.length <= 90 ? hook : `${hook.slice(0, 87).trimEnd()}…`;
}

function factRows(input: DossierInput): { term: string; value: string }[] {
  const { asset, course, label } = input;
  const rows: { term: string; value: string }[] = [
    { term: 'Label', value: label.name },
    {
      term: 'Opleiding',
      value: course.externalCode === null ? course.name : `${course.name} (${course.externalCode})`,
    },
    { term: 'Kanaal', value: CHANNEL_LABEL_NL[asset.channel] },
    {
      term: 'Fase in de funnel',
      value:
        asset.funnelStage === null
          ? 'Geen fase — los van de funnel geschreven'
          : FUNNEL_STAGE_LABEL_NL[asset.funnelStage],
    },
    {
      term: 'Doelgroep',
      value:
        input.personas.length === 0
          ? 'Geen specifieke doelgroep gekozen'
          : input.personas.map((entry) => entry.version.name).join(', '),
    },
    {
      term: 'Campagne',
      value: input.campaignName ?? 'Geen — dit is een losse uiting',
    },
    {
      term: 'Gemaakt door',
      value:
        input.createdBy === null
          ? 'Niet vastgelegd'
          : `${input.createdBy.displayName} (${input.createdBy.email})`,
    },
    { term: 'Gemaakt op', value: dutchDateTime(asset.createdAt) },
    { term: 'Versie', value: `v${String(asset.version)}` },
    { term: 'Status', value: REVIEW_NL[asset.reviewState] ?? asset.reviewState },
    { term: 'Geschreven door', value: ORIGIN_NL[asset.origin] ?? asset.origin },
  ];
  if (asset.originKind !== null) {
    rows.push({ term: 'Aanleiding', value: SOURCE_NL[asset.originKind] ?? asset.originKind });
  }
  rows.push({ term: 'Dossier gemaakt op', value: dutchDateTime(input.generatedAt) });
  return rows;
}

function statusNote(asset: ContentAssetVersion): string {
  const state = REVIEW_NL[asset.reviewState] ?? asset.reviewState;
  const written =
    asset.origin === 'ai_generated'
      ? 'De tekst is door een taalmodel geschreven op basis van de opleidingskaart en het merkprofiel.'
      : 'De tekst is door een mens geschreven of aangepast.';
  const approved =
    asset.reviewState === 'approved'
      ? 'Deze versie is goedgekeurd in het systeem.'
      : 'Deze versie is niet goedgekeurd en is dus niet vrijgegeven voor publicatie.';
  return `Status: ${state}. ${written} ${approved}`;
}

/** Everything the system knows about one audience, in the order it is read. */
function personaBlocks(persona: PersonaVersion, createdBy: ActorRef | null): DossierBlock[] {
  const blocks: DossierBlock[] = [
    { kind: 'subheading', text: persona.name },
    { kind: 'paragraph', text: persona.summary },
    {
      kind: 'fields',
      rows: [
        { term: 'Status', value: REVIEW_NL[persona.reviewState] ?? persona.reviewState },
        { term: 'Herkomst', value: ORIGIN_NL[persona.origin] ?? persona.origin },
        { term: 'Versie', value: `v${String(persona.version)}` },
        { term: 'Vastgelegd op', value: dutchDateTime(persona.createdAt) },
        {
          term: 'Vastgelegd door',
          value:
            createdBy === null
              ? 'Niet vastgelegd'
              : createdBy.email === null
                ? createdBy.displayName
                : `${createdBy.displayName} (${createdBy.email})`,
        },
      ],
    },
    { kind: 'subheading', text: 'Wat deze persoon nodig heeft' },
    { kind: 'paragraph', text: persona.need },
    { kind: 'subheading', text: 'Wat deze persoon drijft' },
    { kind: 'paragraph', text: persona.motivation },
    { kind: 'subheading', text: 'Wat in de weg staat' },
    { kind: 'bullets', items: persona.barriers },
    { kind: 'subheading', text: 'Waarop de keuze wordt gemaakt' },
    { kind: 'bullets', items: persona.decisionCriteria },
    { kind: 'subheading', text: 'Relatie met de opleiding' },
    { kind: 'paragraph', text: persona.relationToCourse },
  ];

  if (persona.orientationSources.length > 0) {
    blocks.push({ kind: 'subheading', text: 'Waar deze persoon zich oriënteert' });
    blocks.push({
      kind: 'bullets',
      items: persona.orientationSources.map((source) => {
        // `?? source.channel` guards a row stored under a channel name that has
        // since been renamed: the raw value says more than "[undefined]" would.
        const channel =
          source.channel === null ? '' : ` [${CHANNEL_LABEL_NL[source.channel] ?? source.channel}]`;
        // The evidence travels with the statement; without it a reader cannot
        // tell a checked claim from an assumption, and both look alike in a list.
        const proof =
          source.grounding === null
            ? ' — aanname, niet onderbouwd'
            : ` — bron: ${source.grounding.sourceRef}`;
        return `${source.statementNl}${channel}${proof}`;
      }),
    });
  }

  if (persona.assumptions.length > 0) {
    blocks.push({ kind: 'subheading', text: 'Aannames' });
    blocks.push({ kind: 'paragraph', text: 'Dit is niet vastgesteld; het is aangenomen.' });
    blocks.push({ kind: 'bullets', items: persona.assumptions });
  }

  if (persona.grounding.length > 0) {
    blocks.push({ kind: 'subheading', text: 'Onderbouwing' });
    blocks.push({
      kind: 'bullets',
      items: persona.grounding.map((item) => `${item.claim} — bron: ${item.sourceRef}`),
    });
  }

  /*
   * The interview, where it was filled in.
   *
   * Only the answered questions, each with the passage it came from. The
   * unanswered ones are counted rather than listed: thirty-six empty rows say
   * nothing a single number does not say better, and they would push the part
   * that does carry information off the page.
   */
  const questionnaire = persona.questionnaire ?? {};
  const answered = PERSONA_QUESTIONS.map((question) => ({
    question,
    answer: questionnaire[question.id],
  })).filter((row) => row.answer !== undefined && row.answer.status !== 'unknown' && row.answer.answer.trim().length > 0);

  if (answered.length > 0) {
    blocks.push({ kind: 'subheading', text: `Doelgroeponderzoek (${String(answered.length)} van de ${String(PERSONA_QUESTIONS.length)} vragen beantwoord)` });
    let group = '';
    for (const row of answered) {
      if (row.question.group !== group) {
        group = row.question.group;
        blocks.push({ kind: 'paragraph', text: group.toUpperCase() });
      }
      blocks.push({ kind: 'paragraph', text: `${row.question.questionNl}` });
      blocks.push({ kind: 'quote', text: row.answer?.answer.trim() ?? '' });
      const quote = row.answer?.sourceQuote;
      if (quote !== null && quote !== undefined && quote.trim().length > 0) {
        blocks.push({ kind: 'note', text: `Bronfragment: “${quote.trim()}”` });
      }
    }
    blocks.push({
      kind: 'note',
      text: `${String(PERSONA_QUESTIONS.length - answered.length)} van de ${String(PERSONA_QUESTIONS.length)} vragen zijn niet beantwoord. Wat hier staat is opgegeven informatie en is niet extern geverifieerd.`,
    });
  } else {
    blocks.push({
      kind: 'note',
      text: 'Er is geen ingevulde vragenlijst bij deze persona; de kaart hierboven is alles wat is vastgelegd.',
    });
  }

  return blocks;
}

/** The piece itself, in the form its channel actually has. */
function contentBlocks(asset: ContentAssetVersion): DossierBlock[] {
  const blocks: DossierBlock[] = [];
  const website = asset.copy.website;

  if (website?.form === 'blog_article') {
    blocks.push({ kind: 'subheading', text: website.title });
    blocks.push({ kind: 'note', text: `Metabeschrijving (voor de zoekresultaten): ${website.metaDescription}` });
    if (website.directAnswerNl.trim().length > 0) {
      blocks.push({ kind: 'quote', text: website.directAnswerNl });
    }
    for (const passage of paragraphs(website.intro)) blocks.push({ kind: 'paragraph', text: passage });

    for (const [index, section] of website.sections.entries()) {
      blocks.push({ kind: 'subheading', text: section.heading });
      for (const passage of paragraphs(section.text)) blocks.push({ kind: 'paragraph', text: passage });
      // The bridge sentence sits where the article says it sits, not at the end.
      if (index === website.midCtaAfterSection && website.midCtaNl.trim().length > 0) {
        blocks.push({ kind: 'paragraph', text: website.midCtaNl });
      }
    }

    if (website.scenarioNl.trim().length > 0) {
      blocks.push({ kind: 'subheading', text: 'Voorbeeldsituatie' });
      for (const passage of paragraphs(website.scenarioNl)) blocks.push({ kind: 'paragraph', text: passage });
    }
    if (website.coursePathNl.trim().length > 0) {
      blocks.push({ kind: 'subheading', text: 'Wat je hiervoor nodig hebt' });
      for (const passage of paragraphs(website.coursePathNl)) blocks.push({ kind: 'paragraph', text: passage });
    }
    if (website.faq.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Veelgestelde vragen' });
      for (const item of website.faq) {
        blocks.push({ kind: 'paragraph', text: item.question });
        blocks.push({ kind: 'quote', text: item.answer });
      }
    }
    if (website.closingCtaNl.trim().length > 0) {
      blocks.push({ kind: 'subheading', text: 'Afsluiting' });
      blocks.push({ kind: 'paragraph', text: website.closingCtaNl });
    }
    blocks.push({ kind: 'note', text: `Ankertekst van de link naar de opleidingspagina: ${website.internalLinkText}` });
    if (website.externalFacts.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Feiten van buiten de opleidingskaart' });
      blocks.push({
        kind: 'bullets',
        items: website.externalFacts.map((fact) => `${fact.statementNl} — bron: ${fact.sourceRef}`),
      });
    }
    return blocks;
  }

  if (website?.form === 'course_page_update') {
    blocks.push({ kind: 'paragraph', text: `Voorgestelde wijzigingen op ${website.pageUrl}.` });
    for (const [index, change] of website.changes.entries()) {
      blocks.push({ kind: 'subheading', text: `Wijziging ${String(index + 1)}: ${change.placement}` });
      blocks.push({ kind: 'paragraph', text: 'Schrijf dit:' });
      for (const passage of paragraphs(change.proposedText)) blocks.push({ kind: 'quote', text: passage });
      blocks.push({ kind: 'paragraph', text: 'In plaats van wat er nu staat:' });
      blocks.push({ kind: 'note', text: change.currentExcerpt });
      blocks.push({ kind: 'paragraph', text: `Waarom: ${change.reason}` });
    }
    return blocks;
  }

  if (asset.copy.ads !== null) {
    const ads = asset.copy.ads;
    blocks.push({ kind: 'subheading', text: 'Koppen' });
    blocks.push({ kind: 'bullets', items: ads.headlines });
    blocks.push({ kind: 'subheading', text: 'Beschrijvingen' });
    blocks.push({ kind: 'bullets', items: ads.descriptions });
    if (ads.paths.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Weergavepaden' });
      blocks.push({ kind: 'bullets', items: ads.paths });
    }
    if (ads.keywords.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Zoektermen' });
      blocks.push({ kind: 'bullets', items: ads.keywords });
      blocks.push({
        kind: 'note',
        text: 'Suggesties, geen zoekplan: er staat geen volume, klikprijs of concurrentiecijfer bij, omdat we die niet hebben.',
      });
    }
    if (ads.negativeKeywords.length > 0) {
      blocks.push({ kind: 'subheading', text: 'Uitsluitingen' });
      blocks.push({ kind: 'bullets', items: ads.negativeKeywords });
    }
    if (ads.matchTypeAdviceNl.trim().length > 0) {
      blocks.push({ kind: 'subheading', text: 'Advies over zoektypen' });
      blocks.push({ kind: 'paragraph', text: ads.matchTypeAdviceNl });
    }
    blocks.push({ kind: 'subheading', text: 'Waarom deze regels' });
    blocks.push({ kind: 'paragraph', text: ads.rationaleNl });
    if (ads.finalUrl !== null) {
      blocks.push({ kind: 'note', text: `Bestemmings-URL: ${ads.finalUrl}` });
    }
    return blocks;
  }

  // A post, a mail, or anything else that is running text.
  blocks.push({ kind: 'subheading', text: 'Openingsregel' });
  blocks.push({ kind: 'quote', text: asset.copy.hook });
  blocks.push({ kind: 'subheading', text: 'Tekst' });
  for (const passage of paragraphs(asset.copy.body)) blocks.push({ kind: 'paragraph', text: passage });
  for (const section of asset.copy.sections) {
    blocks.push({ kind: 'subheading', text: section.heading });
    for (const passage of paragraphs(section.text)) blocks.push({ kind: 'paragraph', text: passage });
  }
  if (asset.copy.hashtags.length > 0) {
    blocks.push({ kind: 'note', text: `Hashtags: ${asset.copy.hashtags.join(' ')}` });
  }
  blocks.push({
    kind: 'note',
    text:
      asset.copy.ctaUrl === null
        ? `Call to action: ${asset.copy.ctaText}`
        : `Call to action: ${asset.copy.ctaText} → ${asset.copy.ctaUrl}`,
  });
  if (asset.copy.imageAltText !== null && asset.copy.imageAltText.trim().length > 0) {
    blocks.push({ kind: 'note', text: `Alt-tekst bij het beeld: ${asset.copy.imageAltText}` });
  }
  if (asset.variants.length > 0) {
    blocks.push({
      kind: 'note',
      text: `Bij deze uiting horen ${String(asset.variants.length)} beeldvariant(en). Die zitten niet in dit document; ze staan bij de uiting in het systeem.`,
    });
  }
  return blocks;
}

function provenanceRows(input: DossierInput): { term: string; value: string }[] {
  const { asset } = input;
  const rows = [
    { term: 'Opleidingskaart', value: asset.courseVersionId },
    { term: 'Merkprofiel', value: asset.brandProfileVersionId },
  ];
  if (asset.briefVersionId !== null) rows.push({ term: 'Briefing', value: asset.briefVersionId });
  if (asset.conceptVersionId !== null) rows.push({ term: 'Concept', value: asset.conceptVersionId });
  for (const [index, id] of asset.personaVersionIds.entries()) {
    rows.push({ term: `Persona ${String(index + 1)}`, value: id });
  }
  rows.push({
    term: 'Promptversie',
    value: asset.promptVersion ?? 'Niet van toepassing — niet door AI geschreven',
  });
  rows.push({ term: 'Kanaalspecificatie', value: `v${String(asset.channelConfigVersion)}` });
  rows.push({ term: 'Interne id van deze versie', value: asset.id });
  return rows;
}

/**
 * How many attention points there are, in a sentence that reads.
 *
 * Written out rather than templated with "(en)" and "waarvan N": a dossier is
 * read by people outside the product, and a line that reads as a form field
 * makes the whole document read as machine output — which invites skipping the
 * one sentence that says publication is blocked.
 */
function warningsNote(total: number, blocking: number): string {
  if (total === 1) {
    return blocking === 1
      ? 'Er is 1 aandachtspunt bij deze versie, en het houdt een publicatieklaar pakket tegen. Het staat achteraan dit dossier.'
      : 'Er is 1 aandachtspunt bij deze versie; het houdt een publicatieklaar pakket niet tegen. Het staat achteraan dit dossier.';
  }
  const opening = `Er zijn ${String(total)} aandachtspunten bij deze versie`;
  if (blocking === 0) {
    return `${opening}; geen daarvan houdt een publicatieklaar pakket tegen. Ze staan achteraan dit dossier.`;
  }
  if (blocking === total) {
    return `${opening}, en ze houden alle een publicatieklaar pakket tegen. Ze staan achteraan dit dossier.`;
  }
  return `${opening}, waarvan ${String(blocking)} een publicatieklaar pakket ${
    blocking === 1 ? 'tegenhoudt' : 'tegenhouden'
  }. Ze staan achteraan dit dossier.`;
}

/** Split on blank lines, so a model's paragraphing survives into the document. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/u)
    .map((part) => part.replace(/\s*\n\s*/gu, ' ').trim())
    .filter((part) => part.length > 0);
}

/** A date a Dutch reader reads without decoding, in the Netherlands' own time. */
function dutchDateTime(iso: string): string {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return iso;
  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Amsterdam',
  }).format(stamp);
}

/**
 * A file name that survives being downloaded.
 *
 * Only letters, digits and hyphens: a Dutch title carries accents, quotation
 * marks and slashes, and a slash in a `filename` is a path — which is why this
 * folds rather than escapes.
 */
function fileName(asset: ContentAssetVersion, title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 60)
    // Again after the cut: slicing mid-word leaves the hyphen dangling.
    .replace(/-+$/u, '')
    .toLowerCase();
  return `dossier-${slug.length > 0 ? slug : asset.channel}-v${String(asset.version)}`;
}
