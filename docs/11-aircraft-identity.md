# 11 Aircraft Identity

How every flight and sighting is linked to one physical aircraft (requirements I1–I4).

## Is registration + type code enough?

No. It fails in both directions.

| Case | What happens with registration + type code | Real-world example |
|------|---------------------------------------------|--------------------|
| An airframe changes registration (sold, leased, moved to another country). | One airframe becomes two "aircraft". Counts go up wrongly. | An A330 moves from one airline to another and gets a new registration. |
| A registration is reused on a different airframe of the same type. | Two airframes become one "aircraft". Counts go down wrongly. | US N-numbers and Chinese B- registrations are reassigned to new aircraft; airlines sometimes reuse a registration on a replacement aircraft of the same type. |
| A registration is reused on a different type. | Correctly split, but by accident. | |
| The type code is typed wrong (e.g. `N999ZZ` entered as A319 instead of B752). | A typo silently creates a new "aircraft" instead of being flagged. | Common in hand-kept logs. |

The last case matters most: if the type code is part of the key, the consistency check in requirement D1 cannot work, because a mismatched type never collides with anything.

## Identity key

The physical airframe is identified by **manufacturer + manufacturer serial number (MSN)**. The MSN never changes over the life of the airframe.

- Known MSN: `identityKey = msn:<manufacturer>:<msn>`, e.g. `msn:airbus:10741`.
- Unknown MSN: the airframe is **provisional**, `identityKey = prov:<registration>:<first date seen>`. A provisional airframe is upgraded when a lookup or the user supplies the MSN.

The registration is not the key. It is a time-bound attribute: an airframe has a list of `RegistrationPeriod {registration, from, to}`.

The type code is not part of the key. It is an attribute of the airframe that each record is checked against.

The ICAO 24-bit hex address is not the key either. It follows the registration and changes when the registration changes.

## Normalizing a registration

1. Trim, uppercase, remove spaces.
2. Look up the country prefix ([10](10-domain-model.md) RegistrationPrefix).
3. Build two forms:
   - `match` form: letters and digits only (`B1234`, `N123AB`, `DABCD`). Used for lookups.
   - `display` form: with the dash the country uses (`B-1234`, `N123AB`, `D-ABCD`, `JA123A`).
4. If no prefix matches, keep the input, mark it `unknownFormat`, and raise warning `V-REG-FORMAT`.

## Resolving a record to an airframe

Input: the record's normalized registration `R`, date `D` (flights: the flight day, i.e. the local date of `takeoffAt`, else `scheduledDate`; sightings: `seenOn`), and optionally type code `T`, operator `O`, MSN `M`.

```
1. If M is given:
     find airframe with identityKey msn:<manufacturer>:<M>
     if found -> link. Go to step 6.
     else create a confirmed airframe with M and a RegistrationPeriod for R. Go to step 6.

2. Find local airframes with a RegistrationPeriod for R whose range contains D
   (open ends count as containing D).

3. Exactly one -> link. Go to step 6.

4. More than one -> this is a data problem (overlapping periods for one registration).
   Raise C-REG-OVERLAP. Link nothing. Ask the user to choose or fix the periods.

5. None:
   a. Ask the lookup service for R (see 13). It returns zero or more airframes,
      each with MSN, type, and a registration history if the source has one.
   b. Pick the airframe whose history contains D.
      - Found -> create/merge the confirmed airframe, link.
      - The source only knows the current holder of R, without dates:
          link to it only if D is after that airframe's first flight date
          and T (if given) matches its type; otherwise raise X-REG-REUSE-POSSIBLE
          and create a provisional airframe.
   c. Lookup unavailable (offline, no data):
      reuse a provisional airframe for R if one exists and its type matches T;
      otherwise create a new provisional airframe prov:<R>:<D>.

6. Check the record against the linked airframe:
   - T differs from airframe.typeCode       -> C-TYPE-MISMATCH (error)
   - model does not match typeCode patterns -> V-MODEL-TYPE (warning)
   - O differs from the operator in that period -> C-OPERATOR-MISMATCH (warning;
     leases and wet leases are common)
   - D before airframe.firstFlightDate      -> V-BEFORE-FIRST-FLIGHT (error)
```

The resolver runs on save, on import, and again when reference data or airframe facts are refreshed. It never changes the record's raw fields.

## A type mismatch, step by step

1. Sighting A: `N999ZZ`, B752. Sighting B: `N999ZZ`, A319.
2. Both resolve to the same airframe (one registration period, no reuse in the lookup data).
3. That airframe is a B752 per the lookup. Sighting B gets `C-TYPE-MISMATCH`.
4. The user either fixes the type on sighting B, or says "this really was a different aircraft". In the second case the user splits the registration period (see below) and the app looks up which airframe held `N999ZZ` on that date.

## User operations

| Operation | When | Effect |
|-----------|------|--------|
| Link to a different airframe | The resolver picked the wrong one. | Sets `airframeId` by hand; stored as a user override. |
| Merge airframes | Two provisional airframes are the same aircraft, or a provisional one matches a confirmed one. | All records move to the surviving airframe; the merge is logged and can be undone. |
| Split registration period | A registration was reused. | The period is cut at a date; records after the cut are re-resolved. |
| Set MSN | The user knows the MSN. | A provisional airframe becomes confirmed; may trigger a merge. |
| Edit airframe facts | A lookup is wrong. | Stored with `field_provenance` source `user`; wins over future lookups. |

## Counting

- Number of aircraft = number of distinct `airframeId` values (requirement I4).
- Provisional airframes are counted. The summary shows how many of the total are provisional, so the user knows how many might still merge.
- Records with no registration have no airframe. They are counted in record totals but not in aircraft totals; the stats page says how many were left out.

## Cross-links between flights and sightings

Because both point to `Airframe`, the app can show:
- Aircraft both flown on and photographed.
- For a sighting: "you flew on this aircraft on <date>". This replaces the manual "Taken this aircraft" note.
- For an airframe: all flights and sightings on one timeline, with its registrations and operators over time.
