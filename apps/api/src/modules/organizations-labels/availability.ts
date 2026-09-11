import type { ModuleAvailability } from '@c360/contracts';

/**
 * Honest capability reporting.
 *
 * Requirement 4: "İlk aşamada hazır olmayan alanları çalışıyormuş gibi
 * gösterme." The frontend renders navigation from this list and disables
 * anything that is not `available`, with the reason shown to the user. Updating
 * this table is therefore part of finishing a phase — not a cosmetic step.
 */
export const MODULE_AVAILABILITY: readonly ModuleAvailability[] = Object.freeze([
  {
    area: 'werkruimte',
    status: 'available',
    note: 'Beschikbaar: overzicht, labeltoegang, budget en achtergrondtaken.',
    plannedPhase: 0,
  },
  {
    area: 'kennis_beheer',
    status: 'available',
    note: 'Beschikbaar: merkprofiel en opleidingskaart met controle per veld.',
    plannedPhase: 1,
  },
  {
    area: 'kansen',
    status: 'available',
    note: 'Beschikbaar: doelgroepvoorstellen en onderbouwde kansen per opleiding.',
    plannedPhase: 1,
  },
  {
    area: 'campagnes',
    status: 'available',
    note: 'Beschikbaar: briefing, goedkeuring, concepten, contentpakket en export.',
    plannedPhase: 1,
  },
  {
    area: 'content',
    status: 'available',
    note: 'Beschikbaar: LinkedIn, Instagram en Facebook met twee ontwerpvarianten per beeld.',
    plannedPhase: 2,
  },
  {
    area: 'kalender',
    status: 'planned',
    note: 'Relatieve planning en kalender volgen in fase 3.',
    plannedPhase: 3,
  },
  {
    area: 'resultaten',
    status: 'planned',
    note: 'Resultaten en onderbouwde leerpunten volgen in fase 4.',
    plannedPhase: 4,
  },
]);
