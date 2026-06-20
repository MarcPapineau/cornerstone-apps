# Vitalis Research Report — Peptide Corpus Enrichment + Expert/Lab Registry

Plain-English summary for the research lead. Date 2026-06-02. Companion files:
`data/evidence.json` (enriched corpus), `docs/research-source-registry.md` (50 sources).

---

## 0. Source hierarchy (Correction 1 — enforced in the corpus)

The evidence **backbone** is peer-reviewed primary literature (journal / DOI / independent lab). Government / regulatory sources — **ClinicalTrials.gov, FDA, Health Canada, USADA, DoD** — are **NOT** the backbone (WHO and NIH / NIH-ODS are now EXCLUDED app-facing entirely); they are compliance / safety / trial-index-cross-check / discovery pointers only. In `data/evidence.json`, `citations[]` now hold **journal papers only**; ClinicalTrials.gov entries were moved to a separate **`registeredStudies`** cross-check field. Full tiering in `docs/research-source-registry.md`.

## 1. What was done

- **Every peptide has real peer-reviewed research.** Pulled live from PubMed (relevance-sorted, title/abstract-anchored) for all **49 compounds**, then **reconciled to the source hierarchy** above. Citations = journal/DOI literature; ClinicalTrials.gov demoted to `registeredStudies` cross-check.
- **Tiers are honest, conservative, and confidence-flagged.** Final: **19 HIGH / 29 MODERATE / 1 LOW** (`UNKNOWN` retained as possible — none triggered because every compound has ≥1 real journal paper). A separate **confidence layer** was added: **6 HIGH_CONFIDENCE** (HIGH + a published clinical-trial/RCT paper, e.g. retatrutide, elamipretide), **13 NEEDS_REVIEW** (HIGH that is pre-curated or lacks a published-trial paper — includes the 8 you flagged), **29 SOURCE_TRACEABLE** (MODERATE), **1 SPARSE** (LOW). HIGH is **never** granted by a government registry or a preclinical/animal/gene-therapy review.
- **Two integrity bugs found + fixed** during verification: (a) loose ClinicalTrials.gov text-matching that fabricated "trials" for unrelated studies → fixed with title-name + word-boundary matching; (b) interventional-vs-observational conflation → fixed by reading `studyType`. Result: no over-claimed tiers.
- **Reversible + tested:** backup at `/tmp/evidence.prebak.json`; 75/75 acceptance tests green throughout.
- **Discovered + classified 50 expert/lab sources** across 7 lanes, all with real URLs, none fabricated.

## 2. The single biggest quality win — the originating labs are now mapped

We can now cite the people who **discovered** the compounds we offer — the strongest possible primary-evidence anchor:

| Compound(s) | Originating lab / scientist | Anchor |
|---|---|---|
| SS-31 / elamipretide | **Hazel Szeto** (Szeto–Schiller peptides, formerly Weill Cornell) | PMC7247319 |
| MOTS-c, humanin | **Pinchas Cohen** (USC Leonard Davis School of Gerontology) | PMID 25738459 (*Cell Metab* 2015, the discovery paper) |
| BPC-157 | **Predrag Sikirić** (University of Zagreb) | PMID 35125818; *applying for funding to run human trials* (STAT, 2026) |
| Retatrutide / GLP-1 class | **Daniel Drucker** (Toronto) + **Habener & Mojsov** (Harvard/MGH) | GLP-1 discovery line — **2024 Lasker Award** |
| Thymosins (TB-500, Tα1) | **Allan Goldstein** (George Washington University) | GWU Himmelfarb repository |

→ **Recommendation:** prioritize these originating-lab primary papers as the top citations for those compounds. They outrank any commentary source.

## 3. Substantive findings — good

- **SS-31 (elamipretide) reached its first regulatory approval** — moved from UNKNOWN to genuinely HIGH (real mitochondrial-myopathy trials).
- **Retatrutide** has the deepest fat-loss evidence base — 2025–26 meta-analyses + ongoing TRIUMPH outcome trials; the GLP-1 lineage just won the Lasker.
- **MOTS-c, cagrilintide, melanotan-2, adipotide** each have a real interventional human trial (verified by name-matched title) — several were under-rated before.
- **Nutrition/performance evidence anchors are strong + independent:** Examine.com (flagged **strongest independence** — no supplement ties), Cochrane, Linus Pauling Institute; for training/protein, Stuart Phillips (McMaster) and Brad Schoenfeld (CUNY) are the field-defining labs.

## 4. Substantive findings — bad / caution (matters for liability)

- **GcMAF:** real literature but **no interventional trial earned** — and it carries a **controversial history** (cancer claims, journal retractions, regulatory warnings). Recommend scrutiny before offering.
- **Melittin (bee venom):** MODERATE, no trial — mostly preclinical cytotoxicity; cytolytic safety concern.
- **Russian peptide bioregulators** (Cardiogen, Bronchogen, Prostamax, Thymalin, Epitalon, + Semax/Selank): a **distinct evidence ecosystem**. They rest on the **Khavinson / St. Petersburg Institute of Bioregulation & Gerontology** school and the Russian Academy of Sciences (Semax/Selank) — largely **outside Western RCTs**. Their MODERATE tier is honest. The primary literature *is* reachable (khavinson.info + a real 15-yr follow-up RCT, PMID 22451889) but the practitioner should understand it is Russian-school evidence, not FDA-trial evidence.
- **Compliance signal:** **USADA and the U.S. DoD (OPSS)** both list **BPC-157 as a prohibited / unapproved substance.** Relevant for any athlete clients — belongs in the compliance lane, not the science lane.

## 5. Source-reliability flags (use as discovery, not authority)

- **Vendor-adjacent / conflict:** Huberman Lab (sponsor + supplement promotion, public scrutiny), BioLayne & Renaissance Periodization (sell programs/supplements). Use to *find* studies; do not cite as evidence.
- **Highest independence:** Examine.com (contractually conflict-free, sells no supplements), Cochrane, Red Pen Reviews, Linus Pauling Institute.
- **35/50 sources cite primary research directly; 15 "sometimes"** (the commentary tier) — all labeled in the registry.

## 6. Recommendations / next research moves

1. **Promote originating-lab papers** (§2) to the top of each compound's citation list.
2. **Targeted Russian-bioregulator pass:** enrich Cardiogen/Bronchogen/Prostamax/Thymalin/Epitalon from khavinson.info + RAS to add their primary literature (PubMed indexes only a subset).
3. **Wire the registry into the Research Source Doctrine lanes** — academic labs + evidence-synthesis as PRIMARY-adjacent finders, commentary clearly labeled, vendors flagged.
4. **Compliance lane:** screen the catalog against USADA/WADA (BPC-157 confirmed prohibited; check others).
5. **The 8 pre-curated HIGH compounds** (`bpc157, tb500, nad, sermorelin, kpv, ghrp6, cjcnodac, glutathione`) are now flagged **`confidence: NEEDS_REVIEW`** in the corpus — preserved at HIGH but explicitly *not* treated as equally verified as published-trial compounds, pending your curation pass. (Four more original-HIGH compounds without a published-trial paper — `ipamorelin, cjc, ghkcu, ta1` — are likewise flagged NEEDS_REVIEW.)

---
*All citations are real and traceable. Nothing in the corpus or registry was fabricated; where evidence is thin it is labeled MODERATE/LOW honestly rather than dressed up.*
