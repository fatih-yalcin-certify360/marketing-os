import { eq, and } from 'drizzle-orm';
import { emptyFact, type CourseFact } from '@c360/contracts';
import type { Db } from './types.js';
import { brandProfileVersions, courseVersions } from './schema.js';

/**
 * Demo brand profile and course card for the pilot label.
 *
 * Everything here is marked `origin: 'demo'` and named so it reads as Demo in
 * the interface. **No real Lindenhaeghe or Wft Basis facts are invented**: the
 * fields that would carry regulatory or commercial risk — price, dates,
 * accreditation, entry conditions — are either left empty or deliberately left
 * *unconfirmed*, which is exactly the state the product is designed to handle.
 *
 * `entryConditions` is seeded with an unconfirmed value on purpose: it makes
 * the per-field verification mechanic visible immediately, and it demonstrates
 * that an unchecked fact blocks a publish-ready export while still allowing a
 * draft.
 */

const DEMO_COURSE_KEY = 'wft-basis-demo';

function confirmedFact(value: string, sourceRef: string): CourseFact {
  return {
    value,
    state: 'user_confirmed',
    sourceRef,
    uncertaintyNl: null,
    confirmedByUserId: null,
    confirmedAt: new Date().toISOString(),
  };
}

function unconfirmedFact(value: string, uncertaintyNl: string): CourseFact {
  return {
    value,
    state: 'unverified',
    sourceRef: 'Demo-invoer (niet gecontroleerd)',
    uncertaintyNl,
    confirmedByUserId: null,
    confirmedAt: null,
  };
}

export interface CampaignSeedResult {
  brandProfileVersionId: string | null;
  courseVersionId: string | null;
}

export async function seedCampaignData(
  db: Db,
  organizationId: string,
  labelId: string,
): Promise<CampaignSeedResult> {
  // ---- brand profile, approved so a campaign can be started ---------------
  const existingBrand = await db
    .select({ id: brandProfileVersions.id })
    .from(brandProfileVersions)
    .where(eq(brandProfileVersions.labelId, labelId))
    .limit(1);

  let brandProfileVersionId = existingBrand[0]?.id ?? null;

  if (brandProfileVersionId === null) {
    const inserted = await db
      .insert(brandProfileVersions)
      .values({
        organizationId,
        labelId,
        version: 1,
        brandName: 'Lindenhaeghe (Demo)',
        colors: {
          // Certify360 interface tokens as an obvious placeholder palette.
          // The real brand palette has not been supplied.
          primary: '#183B3E',
          surface: '#F5F6F9',
          accent: '#A793ED',
          onPrimary: '#FFFFFF',
          onSurface: '#183B3E',
        },
        typography: {
          headingFamily: 'Helvetica',
          bodyFamily: 'Helvetica',
          licenceNote: 'Demo: systeemfont gebruikt. Echte merkfonts nog niet aangeleverd.',
        },
        tone: {
          traits: ['helder', 'persoonlijk', 'met bewijs'],
          description:
            'Schrijf helder en persoonlijk. Onderbouw wat je stelt en vermijd overdrijving of stellige beloftes.',
        },
        rules: [
          { kind: 'must', text: 'Onderbouw een claim of laat hem weg.' },
          {
            kind: 'must_not',
            text: 'Geen garanties over slagingskans, resultaat of doorlooptijd.',
          },
          {
            kind: 'must_not',
            text: 'Geen prijzen, data of toelatingsvoorwaarden noemen die niet zijn gecontroleerd.',
          },
        ],
        exampleContent: '',
        logoText: 'lindenhaeghe',
        imageUsageNote:
          'Demo: alleen tekstbeelden uit de render-laag. Geen fotografie of logo-bestand aangeleverd.',
        reviewState: 'approved',
        origin: 'demo',
      })
      .returning({ id: brandProfileVersions.id });
    brandProfileVersionId = inserted[0]?.id ?? null;
  }

  // ---- course card, approved but with one deliberately unchecked field ----
  const existingCourse = await db
    .select({ id: courseVersions.id })
    .from(courseVersions)
    .where(and(eq(courseVersions.labelId, labelId), eq(courseVersions.courseKey, DEMO_COURSE_KEY)))
    .limit(1);

  let courseVersionId = existingCourse[0]?.id ?? null;

  if (courseVersionId === null) {
    const inserted = await db
      .insert(courseVersions)
      .values({
        organizationId,
        labelId,
        courseKey: DEMO_COURSE_KEY,
        version: 1,
        name: 'Wft Basis (Demo)',
        externalCode: null,
        sourceKind: 'manual',
        sourceRef: 'Demo-invoer — echte opleidingsinformatie nog niet aangeleverd',
        courseUrl: null,
        facts: {
          summary: confirmedFact(
            'Demo-omschrijving: een basisopleiding als eerste formele stap in het vakgebied. Deze tekst is voorbeeldinvoer en beschrijft niet de werkelijke opleiding.',
            'Demo-invoer',
          ),
          targetAudience: confirmedFact(
            'Demo: mensen die zich oriënteren op een eerste formele stap, en mensen die al in de praktijk werken en de basis willen vastleggen.',
            'Demo-invoer',
          ),
          // Deliberately unconfirmed: shows the verification mechanic and
          // blocks a publish-ready export until someone checks it.
          entryConditions: unconfirmedFact(
            'Demo: geen specifieke vooropleiding vereist.',
            'Niet gecontroleerd. De werkelijke toelatingsvoorwaarden zijn niet aangeleverd; controleer dit bij de opleidingsafdeling voordat het wordt gepubliceerd.',
          ),
          duration: emptyFact,
          contentOutline: emptyFact,
          // Left empty rather than guessed: a wrong published price is exactly
          // the failure this design exists to prevent.
          price: emptyFact,
          dates: emptyFact,
          accreditation: emptyFact,
        },
        priceCents: null,
        priceNote: null,
        dates: [],
        reviewState: 'draft',
        origin: 'demo',
      })
      .returning({ id: courseVersions.id });
    courseVersionId = inserted[0]?.id ?? null;
  }

  return { brandProfileVersionId, courseVersionId };
}
