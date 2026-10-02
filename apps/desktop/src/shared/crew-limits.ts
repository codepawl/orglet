/** A crew holds up to eight orglets; a lead plans for all of them in one turn. */
export const MAX_CREW_MEMBERS = 8;

// The lead may be outside the roster. Each distinct orglet can reference one distinct skill.
export const MAX_CREW_TEMPLATE_WORKERS = MAX_CREW_MEMBERS + 1;
