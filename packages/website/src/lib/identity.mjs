// Single source of truth for the Person JSON-LD entity. Validated at module
// load so a malformed identity.json fails the Astro build rather than
// emitting silently broken structured data.
import { z } from 'astro:content';
import identityData from '../../content/identity.json';

const schema = z.object({
  name: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  jobTitle: z.object({ fr: z.string(), en: z.string() }),
  // Optional, machine-only (GEO): a one-paragraph bio and expertise tags,
  // surfaced in the Person JSON-LD. Optional so identity.json stays valid
  // if a future edit drops them.
  description: z.object({ fr: z.string(), en: z.string() }).optional(),
  knowsAbout: z.object({ fr: z.array(z.string()), en: z.array(z.string()) }).optional(),
  affiliation: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
  })),
  sameAs: z.array(z.string().url()),
});

export const identity = schema.parse(identityData);
