# Vitalis Research-Source Registry

> Discovery + interpretation sources found via live web search (2026-06-02).
> DOCTRINE: these sources help DISCOVER and INTERPRET research — they are NOT final evidence unless the underlying primary paper/DOI is found and cited. Expert commentary is labeled; vendors are flagged vendor-adjacent.

---

## Source Hierarchy — which sources may back an evidence claim

**TIER 1 — Primary evidence (THE BACKBONE).** Peer-reviewed journal articles, DOIs, independent academic labs, systematic reviews / meta-analyses of *human* trials. **An evidence claim must cite this tier.**

**TIER 2 — Evidence synthesis (finder + grading).** Examine.com, Cochrane, Red Pen Reviews, Linus Pauling Institute. Use to locate and weigh Tier-1 sources — then cite the underlying paper for the claim.

**TIER 3 — Expert / practitioner commentary (LABELED).** Huberman, Attia, Rhonda Patrick, Stronger by Science, RP, BioLayne, peptide clinicians. Influences framing only; must be labeled "expert commentary / practitioner interpretation" unless backed by Tier 1. Vendor-adjacent sources flagged.

**TIER 4 — Government / regulatory (NOT EVIDENCE).** ClinicalTrials.gov, FDA, Health Canada, USADA, DoD/OPSS. **WHO and NIH / NIH-ODS are EXCLUDED app-facing entirely** (docs/vitalis-research-doctrine.md). Used ONLY as: compliance flag · safety/regulatory context · trial-index cross-check · source-discovery pointer. **Never the authority for whether a compound is useful or effective.**

> Applied to the corpus (`data/evidence.json`): `citations[]` now hold **Tier-1 journal papers only**; ClinicalTrials.gov entries were moved to a separate **`registeredStudies`** field (Tier-4 cross-check, not the evidence backbone).

---

### CATEGORY: anchors

All seven sources are verified with real URLs from search results. I have enough detail on credentials, independence, citation practices, and vendor ties for each. Let me note the key reliability nuances I confirmed:

- **Examine.com** explicitly states zero financial ties to supplement companies — the strongest independence signal.
- **Stronger by Science** and **BioLayne** both cite primary literature heavily; BioLayne sells programs/courses/supplements (vendor-adjacent on the commerce side) but the science output is rigorous.
- **Renaissance Periodization** is a commercial training company (sells programs/apps/supplements) — practitioner protocol that is vendor-adjacent; cites literature inconsistently in its consumer-facing content.
- **Huberman Lab / Attia / FoundMyFitness** are expert commentary; Huberman has had public scrutiny over sponsor/supplement promotion, so I'll flag conflict considerations honestly.

Here are the filled source blocks.

SOURCE: Huberman Lab (Andrew Huberman, PhD)
DOMAIN: Neuroscience of behavior, sleep, stress, circadian biology, neuroplasticity, hormones
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: Circadian rhythm and light exposure, sleep architecture, stress/cortisol regulation, dopamine and motivation, neuroplasticity, exercise and neurochemistry, general mechanism explainers
LINKS: https://www.hubermanlab.com/ ; https://www.youtube.com/@hubermanlab ; https://www.hubermanlab.com/about
RELIABILITY: Host is a tenured Stanford neurobiology professor — strong domain credibility for neuroscience. Mechanism-forward and frequently references studies in show notes, but episodes mix primary literature with personal protocol recommendations and extrapolation beyond what data supports. Not independent of commerce: the podcast is sponsor-funded and Huberman promotes specific supplement brands and his own protocols; uncertainty disclosure is inconsistent and some claims have drawn scientific criticism for overstatement. Treat as a credentialed entry point, not as primary evidence.
USE_FOR: Building intuition on neuroscience/physiology mechanisms, identifying topics and study leads worth verifying, lay-accessible framing of sleep/stress/circadian science
CANNOT_USE_FOR: A primary citation, dosing authority, peptide-specific clinical guidance, or settled-evidence claims — verify every actionable claim against primary literature
---
SOURCE: FoundMyFitness (Rhonda Patrick, PhD)
DOMAIN: Nutrition, micronutrients, aging/longevity biology, metabolic health, sauna/heat and cold stress
TYPE: expert commentary
CITES_PRIMARY: YES
USEFUL_TOPICS: Vitamin D and micronutrient biology, omega-3s, sauna/heat-shock and cold exposure, sulforaphane, fasting and metabolic health, aging biomarkers
LINKS: https://www.foundmyfitness.com/ ; https://www.foundmyfitness.com/about-dr-rhonda-patrick ; https://www.foundmyfitness.com/science-digest
RELIABILITY: Host is a PhD cell biologist; content is unusually citation-dense and links directly to peer-reviewed studies. Mechanism-focused with reasonable hedging on emerging areas. Largely independent and education-first (Science Digest behind a membership), though it is a paid-membership business and occasionally enthusiastic about under-powered nutrition findings. Among the more rigorous expert-commentary sources here.
USE_FOR: Finding primary citations on micronutrients, longevity, and heat/cold stress; well-sourced mechanism summaries; tracking emerging nutrition literature
CANNOT_USE_FOR: A standalone primary source, clinical dosing authority, or peptide-protocol guidance — use it to reach the underlying papers
---
SOURCE: Peter Attia — The Drive (Peter Attia, MD)
DOMAIN: Longevity, cardiometabolic and lipid science, exercise physiology, cancer screening, healthspan/lifespan medicine
CITES_PRIMARY: SOMETIMES
TYPE: expert commentary
USEFUL_TOPICS: ApoB/lipids and cardiovascular risk, Zone 2 and VO2max training, strength/stability for longevity, metabolic health, screening philosophy ("Medicine 3.0"), nutrition trade-offs
LINKS: https://peterattiamd.com/ ; https://peterattiamd.com/podcast/ ; https://peterattiamd.com/exercising-for-longevity/
RELIABILITY: Host is a Stanford/Johns Hopkins/NIH-trained physician; deep, technically careful interviews that often foreground study quality, effect sizes, and explicit uncertainty (a relative strength vs. peers). Runs a clinical practice (Early Medical) and membership/book business, so commercial interests exist, but content is rarely vendor-pitchy. Reasoning is clinician-level but still secondary commentary.
USE_FOR: Clinician-grade framing of longevity, lipids, exercise physiology, and risk; understanding how to weigh evidence quality; topic and expert leads
CANNOT_USE_FOR: A primary citation, a substitute for individualized medical advice, or peptide-dosing authority — confirm specifics against trials and guidelines
---
SOURCE: Examine.com
DOMAIN: Supplement and nutrition evidence synthesis across conditions and outcomes
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Whether a given supplement/nutrient has RCT/meta-analytic support for a specific outcome, effect-size and grade context, safety signals, dose ranges studied, interaction notes
LINKS: https://examine.com/ ; https://examine.com/database/ ; https://examine.com/about/
RELIABILITY: Highest independence signal of this set — explicitly not affiliated with any supplement or food company, research team contractually barred from conflicts of interest, sells no supplements (revenue from memberships). Every claim is citation-backed; interventions graded A–F by strength of evidence; uncertainty and conflicting trials are surfaced rather than hidden. Synthesizes rather than reports new data, so it lags the very newest literature and is supplement/nutrient-scoped (not peptide-protocol).
USE_FOR: The default first stop to check whether a supplement/nutrient claim is evidence-backed, find graded evidence and the underlying citations, and sanity-check dosing/safety
CANNOT_USE_FOR: Peptide clinical-protocol guidance (largely out of scope), individualized medical advice, or as a replacement for reading the cited trials when stakes are high
---
SOURCE: Stronger by Science (Greg Nuckols)
DOMAIN: Resistance-training science, hypertrophy, strength, and applied sports-nutrition
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Training volume/intensity/frequency for hypertrophy and strength, progressive overload, protein intake, program design, statistical literacy in fitness research, myth-debunking
LINKS: https://www.strongerbyscience.com/ ; https://www.strongerbyscience.com/about/ ; https://gregnuckols.com/
RELIABILITY: Led by an exercise-science MA and competitive powerlifter; articles are heavily cited, statistically literate, and notably good at expressing uncertainty and critiquing weak studies. Sells training programs and runs MASS (a paid research-review), so a commerce layer exists, but editorial content is education-first and not supplement-vendor driven. Among the most rigorous applied-training sources available.
USE_FOR: Evidence-based resistance-training and protein/nutrition-for-training guidance, interpreting study quality, program-design reasoning
CANNOT_USE_FOR: Peptide or pharmacological dosing authority, clinical/medical advice, or a primary citation — follow through to the referenced studies
---
SOURCE: Renaissance Periodization / RP Strength (Mike Israetel, PhD; Nick Shaw)
DOMAIN: Hypertrophy and strength programming, periodization, diet phasing for body composition
TYPE: practitioner protocol
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: Volume landmarks (MEV/MAV/MRV), periodization and deloads, training-to-failure and proximity-to-failure, diet/bulk-cut phasing, exercise selection and technique
LINKS: https://rpstrength.com/pages/team/michael-israetel ; https://www.youtube.com/@RenaissancePeriodization ; https://rpstrength.com/
RELIABILITY: Co-founder holds a PhD in sport physiology and frameworks are physiology-informed, but this is a commercial training/app/supplement company — vendor-adjacent. Consumer-facing YouTube/marketing content cites primary literature inconsistently and is partly opinion- and product-driven; uncertainty disclosure is variable. Treat the models (e.g., volume landmarks) as useful practitioner heuristics, not settled science.
USE_FOR: Practical hypertrophy programming heuristics, periodization/volume frameworks, exercise-technique guidance
CANNOT_USE_FOR: A primary or independent evidence source, supplement claims (commercial interest), or any clinical/peptide-dosing authority
---
SOURCE: BioLayne (Layne Norton, PhD)
DOMAIN: Evidence-based nutrition, protein/muscle protein synthesis, dieting (flexible dieting), fat loss, fitness-myth debunking
TYPE: expert commentary
CITES_PRIMARY: YES
USEFUL_TOPICS: Protein intake and leucine/muscle protein synthesis, energy balance and fat loss, flexible dieting, critical appraisal of fitness/nutrition studies, debunking fad claims
LINKS: https://biolayne.com/about/ ; https://biolayne.com/coach/layne-norton/ ; https://www.researchgate.net/profile/Layne-Norton
RELIABILITY: PhD in nutritional sciences with a publication record on protein/leucine; known for engaging primary literature critically and publicly correcting himself when evidence shifts — strong rigor and uncertainty-disclosure for an individual communicator. Caveat: runs a commercial ecosystem (coaching, courses, the REPS research review, and a supplement store), so it is vendor-adjacent; keep the science output separate from the storefront.
USE_FOR: Evidence-based nutrition and protein guidance, critical appraisal of fitness/diet claims, leads to primary literature on protein/energy balance
CANNOT_USE_FOR: Peptide clinical-dosing authority, individualized medical advice, or supplement endorsements taken at face value (commercial tie) — verify against primary sources
---

==========

### CATEGORY: peptide-clinicians

I now have 8 verified sources with real URLs spanning the full spectrum: academic lab, evidence synthesis, expert commentary, practitioner protocol, society, and independent risk-disclosure bodies. Compiling the final registry.

SOURCE: Predrag Sikiric Lab — Department of Pharmacology, University of Zagreb School of Medicine
DOMAIN: BPC-157 / cytoprotection / brain-gut axis / vascular & GI healing peptides
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: BPC-157 mechanism (FAK-paxillin, ERK1/2, NO system, angiogenesis), ischemia-reperfusion, GI ulcer/fistula/anastomosis healing, tendon/musculoskeletal models, vascular occlusion
LINKS: https://sciprofiles.com/profile/1479180 (profile) ; https://www.researchgate.net/lab/Predrag-Sikiric-Lab (lab) ; https://pmc.ncbi.nlm.nih.gov/articles/PMC8793015/ (representative 2022 paper on vessel occlusion / Pringle maneuver / Budd-Chiari)
RELIABILITY: Originating academic lab — produced the 1992 isolation paper and the large majority of all BPC-157 literature. High rigor within preclinical scope, peer-reviewed, but a near-monopoly on the data is itself a limitation (independence/replication concern); work is overwhelmingly animal-model. Sikiric publicly addresses skeptics (StatNews 2026-06-01), which is a transparency positive.
USE_FOR: Primary-source mechanism of action and preclinical pharmacology of BPC-157; the actual studies underlying every downstream claim
CANNOT_USE_FOR: Evidence of human efficacy/safety, dosing in humans, or proof that animal results translate clinically — this is preclinical literature, not clinical validation
---
SOURCE: Examine.com — BPC-157 Research Breakdown
DOMAIN: Independent evidence appraisal of supplements/peptides
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: What the evidence does/doesn't support, animal-vs-human evidence gap, oral bioavailability question, EGR-1/EGF mechanism notes, effect-size sobriety
LINKS: https://examine.com/supplements/bpc-157/research/
RELIABILITY: Independent, no-vendor, citation-dense; explicitly separates strong preclinical signal from "little evidence of human benefit" and discloses uncertainty. Strong on conflict-of-interest neutrality. Coverage skews to compounds with enough literature to grade.
USE_FOR: Neutral "what does the evidence actually say" framing; calibrating hype vs proof; an entry point to the primary citations
CANNOT_USE_FOR: Dosing protocols or clinical decision-making; it grades evidence, it does not prescribe
---
SOURCE: Dr. Craig Koniver (board-certified physician; Huberman Lab guest expert)
DOMAIN: Clinical peptide & hormone therapy for performance/longevity
TYPE: practitioner protocol
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: GLP-1 analogs, BPC-157 for wound healing/inflammation, GH-secretagogues, sleep/REM peptides, real-world clinical practice patterns and routes
LINKS: https://www.hubermanlab.com/episode/dr-craig-koniver-peptide-hormone-therapies-for-health-performance-longevity
RELIABILITY: Practicing clinician (Brown/Thomas Jefferson trained) giving experience-based protocols; the Huberman platform adds some editorial framing of risk/benefit, but content is practitioner-experience-weighted rather than trial-weighted, and Koniver runs a peptide-prescribing practice (commercial interest in the modality — practitioner-adjacent bias to flag).
USE_FOR: Understanding how peptide-literate clinicians actually deploy these compounds; practitioner perspective and route/stacking rationale
CANNOT_USE_FOR: A source of trial-grade evidence or proof of efficacy; do not treat clinical anecdote as primary data
---
SOURCE: Dr. William A. Seeds (author, "Peptide Protocols, Vol. 1"; SSRP Institute)
DOMAIN: Clinical peptide protocols / cellular medicine education for providers
TYPE: practitioner protocol
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: Provider-facing protocol structure, peptides and cellular senescence/inflammation, GLP-1 cellular mechanisms, pre/during/post-treatment support frameworks
LINKS: https://ssrpinstitute.org/resources/books/ ; https://www.amazon.com/Peptide-Protocols-William-Seeds-MD/dp/0578624354
RELIABILITY: Widely used provider handbook ("go-to" reference in the field) and references peer-reviewed studies, but it is a practitioner doctrine/protocol text, not a systematic review; author and institute are commercially embedded in peptide education/certification (practitioner-adjacent ties to flag). Independence is moderate.
USE_FOR: Canonical clinician-protocol conventions, naming, and how the practitioner community organizes peptide therapy
CANNOT_USE_FOR: An independent or systematic evidence base; not a substitute for primary trials or neutral appraisal
---
SOURCE: International Peptide Society (IPS) — now under A4M (American Academy of Anti-Aging Medicine)
DOMAIN: Clinical peptide education / practitioner certification & society
TYPE: practitioner protocol
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: Provider education, peer-reviewed abstract curation for clinical peptides, treatment protocols/dosing/indications, sourcing standards, certification pathways
LINKS: https://peptidesociety.org/about-21/ ; https://www.youtube.com/@ipsinternationalpeptidesoc3420
RELIABILITY: Organized educational body that points members to peer-reviewed literature and protocols; however it is a membership/certification organization operating inside the anti-aging-medicine industry (A4M), so positioning is pro-modality — independence is moderate and commercial alignment should be disclosed.
USE_FOR: Mapping the recognized clinical-education landscape, protocol/sourcing conventions, and where peptide-literate clinicians are trained
CANNOT_USE_FOR: An unbiased efficacy authority or regulatory-status source; society endorsement is not evidence of FDA approval or proven benefit
---
SOURCE: Dr. Christopher Robinson — Johns Hopkins University School of Medicine (regenerative medicine & pain)
DOMAIN: Academic regenerative/pain medicine; prospective peptide clinical trials
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: Translating peptides (BPC-157 and others) toward human chronic-pain trials, the clinical-trial-design gap, regenerative medicine
LINKS: https://www.statnews.com/2026/06/01/bpc-157-researcher-predrag-sikiric-addesses-skeptics-questions/ (named as applying for funding to run human peptide trials)
RELIABILITY: Academic physician-investigator at a top-tier institution explicitly working to generate the missing human trial data — high independence and rigor orientation. Note: trials are prospective/not yet reported, so this is a credibility/future-evidence signal, not a published-results source yet.
USE_FOR: Signal of legitimate academic clinical-trial efforts and the institutional view that human evidence is still needed
CANNOT_USE_FOR: Citing completed human efficacy/safety results — the trials referenced are in funding/planning stage, not published
---
SOURCE: U.S. Anti-Doping Agency (USADA) — Spirit of Sport / Supplement411
DOMAIN: Anti-doping risk, prohibited-substance status, athlete safety
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: BPC-157 prohibited status, experimental/unapproved classification, athlete contamination & strict-liability risk, why "research chemical" ≠ approved drug
LINKS: https://www.usada.org/spirit-of-sport/bpc-157-peptide-prohibited/
RELIABILITY: Independent regulatory/anti-doping authority with no commercial stake in selling peptides; explicitly discloses the unknown-safety and unapproved-status reality. Strong on risk/uncertainty, conservative by mandate.
USE_FOR: Authoritative regulatory/anti-doping status, athlete-facing risk warnings, and the unapproved/experimental framing
CANNOT_USE_FOR: Mechanism, dosing, or any "how to use" guidance — it is a prohibition/risk authority, not a clinical or mechanistic source
---
SOURCE: Operation Supplement Safety (OPSS) — U.S. Department of Defense / Uniformed Services University (CHAMP)
DOMAIN: Independent supplement/ingredient safety & regulatory status
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: BPC-157 and CJC-1295/ipamorelin regulatory status, "unapproved drug" classification, FDA bulks-list Category 2 (immunogenicity/impurity) rationale, 503A compounding limits, service-member risk
LINKS: https://www.opss.org/article/bpc-157-prohibited-peptide-and-unapproved-drug-found-health-and-wellness-products ; https://www.opss.org/ingredient-and-substance-index
RELIABILITY: Government/academic (DoD + Uniformed Services University) consumer-safety program — independent of industry, citation-backed, and explicit about unknown safety and legal status. High independence; conservative framing by mandate.
USE_FOR: Independent regulatory-status and safety-risk reference across multiple peptides (not just BPC-157); the "is this even legal/approved" check
CANNOT_USE_FOR: Mechanistic detail, efficacy evaluation, or dosing — it is a safety/regulatory authority, not a clinical-evidence or protocol source
---

==========

### CATEGORY: longevity

I have verified, real sources with working URLs. Compiling the registry of 7 longevity/aging-biology sources.

SOURCE: Matt Kaeberlein, PhD — Optispan Podcast / Dog Aging Project
DOMAIN: Geroscience, biology of aging, rapamycin/mTOR, healthspan interventions, companion-animal aging
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: mTOR/rapamycin biology and off-label use, the TAME trial, sirtuins/metformin/resveratrol critique, Dog Aging Project data, separating hype from evidence in longevity supplements
LINKS: https://www.optispan.life/podcast ; https://scholar.google.com/citations?user=YKWuXCYAAAAJ ; https://pubmed.ncbi.nlm.nih.gov/37191826/ (off-label rapamycin survey, Aging 2023)
RELIABILITY: High independence and rigor. Former UW professor of pathology/lab medicine, decades of peer-reviewed aging research; openly skeptical of overhyped interventions and discloses uncertainty. Conflict to flag: he is CEO of Optispan (healthtech company) and takes rapamycin off-label — vendor interest exists but he is unusually transparent about what is NOT proven in humans.
USE_FOR: Understanding mechanistic aging biology, realistic framing of rapamycin/mTOR, debunking longevity-supplement hype, what animal-model data does and does not translate to humans
CANNOT_USE_FOR: Prescribing or dosing rapamycin (or any drug) for a client; treating his personal regimen as a validated human protocol; product endorsement
---
SOURCE: Morgan Levine, PhD — Morgan Levine Lab / Altos Labs (founding PI); author of "True Age"
DOMAIN: Biological-age measurement, epigenetic/DNA-methylation aging clocks, biostatistics of aging
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: PhenoAge clock, DNAm clocks and their reliability/noise, how to interpret a biological-age result, cellular reprogramming research, lifestyle/pharma effects on pace of aging
LINKS: https://www.morganlevinelab.com/ ; https://medicine.yale.edu/news-article/a-computational-solution-for-bolstering-reliability-of-epigenetic-clocks-implications-for-clinical-trials-and-longitudinal-tracking/ ; https://www.foundmyfitness.com/episodes/morgan-levine
RELIABILITY: High rigor and independence. Former Yale ladder-rank professor, co-developer of PhenoAge; explicitly publishes on the limitations/measurement-noise of epigenetic clocks. Conflict to flag: now founding PI at Altos Labs (reprogramming biotech) and has written a consumer book — note commercial affiliation, but her academic work is peer-reviewed and cautious.
USE_FOR: Explaining what aging clocks actually measure, why a single methylation-age reading is noisy, evidence-grounded framing of "biological age" claims
CANNOT_USE_FOR: Marketing any specific consumer biological-age test as definitive; claiming a clock proves an intervention "reversed aging" in an individual
---
SOURCE: Steve Horvath, PhD, ScD — epigenetic-clock pioneer (Altos Labs; formerly UCLA)
DOMAIN: DNA-methylation aging clocks, pan-mammalian clocks, genomic biomarkers of aging
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: original 2013 multi-tissue Horvath clock, GrimAge (mortality prediction), pan-mammalian methylation clocks, clock validation across tissues and species
LINKS: https://www.ahlresearch.org/steve-horvath ; https://www.nature.com/articles/s41576-018-0004-3 (Nat Rev Genetics review on DNAm biomarkers/epigenetic-clock theory) ; https://www.uclahealth.org/news/release/ucla-researchers-lead-groundbreaking-studies-mammalian-aging
RELIABILITY: Very high — foundational, heavily cited primary literature; the field's reference point for methylation clocks. Discloses uncertainty in peer-reviewed reviews. Conflict to flag: now at Altos Labs; clock IP has commercial spin-offs, so treat clock-based product claims with independent scrutiny.
USE_FOR: Authoritative background on how epigenetic clocks were built and validated; citing the primary methodology behind biological-age testing
CANNOT_USE_FOR: Selling a direct-to-consumer methylation test as clinically actionable; equating a clock score with a diagnosis or a guaranteed lifespan
---
SOURCE: Rhonda Patrick, PhD — FoundMyFitness
DOMAIN: Nutritional/cellular aging biology, healthspan behaviors (sauna/heat shock, exercise, omega-3, micronutrients), translating mechanisms to lifestyle
TYPE: expert commentary
CITES_PRIMARY: YES
USEFUL_TOPICS: heat-shock proteins/sauna and longevity, exercise and brain aging, omega-3 index, micronutrient "triage" theory, hormetic stressors; detailed timestamped study citations in show notes
LINKS: https://www.foundmyfitness.com/ ; https://www.foundmyfitness.com/science-digest ; https://www.foundmyfitness.com/about-dr-rhonda-patrick
RELIABILITY: Good. Biomedical scientist with peer-reviewed publications (e.g., Experimental Gerontology sauna/healthspan review); episodes are densely referenced to primary literature. Watch for enthusiasm-driven framing of observational/mechanistic data as more actionable than RCTs warrant; she sells memberships and has had supplement-brand relationships, so treat specific product mentions as vendor-adjacent.
USE_FOR: Mechanistic, well-cited explainers linking aging biology to lifestyle levers (sauna, exercise, nutrition); finding the underlying primary studies via her show notes
CANNOT_USE_FOR: Treating mechanistic/observational findings as proven clinical outcomes; supplement-dose recommendations or brand endorsements
---
SOURCE: Peter Attia, MD — The Drive podcast
DOMAIN: Longevity medicine, healthspan strategy, metabolic/cardiovascular/cancer/cognitive risk, exercise physiology
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: lifespan vs healthspan framing, the "four horsemen" of chronic disease, ApoB/lipidology, VO2max and strength as longevity predictors, deep-dive interviews with aging-biology PIs (e.g., Kaeberlein)
LINKS: https://peterattiamd.com/podcast/ ; https://peterattiamd.com/podcast/archive/ ; https://peterattiamd.com/mattkaeberlein2/
RELIABILITY: Good for clinical-translation framing; long-form, detailed show notes. Independence caveat: physician-operator with a paid membership and broad commercial footprint; guest expertise varies and some claims lean ahead of consensus. Best used as a navigator to expert PIs and primary studies rather than as a primary source itself.
USE_FOR: Clinical/longevity-medicine framing, prioritizing high-evidence levers (exercise, lipids, metabolic health), discovering and contextualizing aging-biology researchers
CANNOT_USE_FOR: A primary-literature citation on its own; specific supplement/drug protocols presented in episodes as if individually validated for a client
---
SOURCE: Buck Institute for Research on Aging
DOMAIN: Independent geroscience research institute — cellular senescence/SASP, senolytics, mitochondrial aging, Nathan Shock Center
TYPE: independent lab
CITES_PRIMARY: YES
USEFUL_TOPICS: cellular senescence and the SASP (Campisi legacy), senolytics rationale and limits, senescence in Alzheimer's/age-related disease, the hallmarks-of-aging framework in practice
LINKS: https://www.buckinstitute.org/ ; https://www.buckinstitute.org/press-releases/ ; https://www.buckinstitute.org/news/8303/ (NIH SenNet cellular-senescence network grant)
RELIABILITY: Very high. Dedicated nonprofit research institute; NIH-funded (SenNet, NIA), peer-reviewed output, foundational senescence science. Institutional press releases can be optimistic about early findings — anchor claims to the underlying publications, and note startup spin-outs (e.g., Unity Biotechnology) as commercial offshoots, not endorsements.
USE_FOR: Authoritative grounding on senescence/senolytics and core aging-biology mechanisms; sourcing primary research and PI labs
CANNOT_USE_FOR: Recommending any senolytic regimen to a client; treating preclinical/early-trial results as established human therapies
---
SOURCE: Lifespan.io / Lifespan Research Institute (news outlet)
DOMAIN: Aging-research journalism, geroscience and rejuvenation-biotech news, longevity clinical-trial coverage, researcher interviews
TYPE: evidence synthesis
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: roundups of new aging studies and clinical trials, interviews/journal clubs with aging PIs, status of senolytics/partial-reprogramming/clock trials, field-wide context
LINKS: https://lifespan.io/news/ ; https://en.wikipedia.org/wiki/Lifespan_Research_Institute
RELIABILITY: Moderate-to-good as a tracking/synthesis layer. Staffed by biologists and journalists who link to source studies; merged with SENS Research Foundation in 2024. Caveat: it is an advocacy-oriented nonprofit (pro-longevity mission) and runs a biotech investor network and crowdfunding — framing can skew optimistic, so verify against the linked primary papers.
USE_FOR: Staying current on aging research/trials, finding and then reading the underlying primary studies, mapping who's who among aging-biology labs
CANNOT_USE_FOR: A standalone authority or primary citation; investment/advocacy framing as neutral clinical evidence; treating early-stage results as proven
---

==========

### CATEGORY: performance

All sources verified with real URLs from search results. Compiling the final registry of 8 sources spanning academic labs, evidence-synthesis platforms, research reviews, and science-communication educators.

SOURCE: Brad Schoenfeld — Applied Muscle Development Lab, CUNY Lehman College
DOMAIN: Resistance training variables & skeletal muscle hypertrophy
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: training volume, frequency, proximity to failure, rep ranges/load, rest-interval duration, repetition tempo, exercise selection/range of motion, blood-flow restriction, protein timing for growth
LINKS: https://scholar.google.com/citations?user=ReXrc5cAAAAJ&hl=en | https://academicworks.cuny.edu/le_pubs/274/ (Schoenfeld et al., "Resistance Training Volume Enhances Muscle Hypertrophy but Not Strength")
RELIABILITY: Independent peer-reviewed primary research; tenured academic (~41k citations); runs original RCTs and meta-analyses; conflicts disclosed in journal articles; no product line driving conclusions. Highest tier of rigor for hypertrophy mechanics.
USE_FOR: Authoritative grounding on how training variables drive muscle growth; sourcing the actual studies behind training claims; resolving disputes about volume/frequency/failure
CANNOT_USE_FOR: Peptide/PED or pharmacology guidance; individualized medical or supplement prescription; anything outside resistance-training and sports-nutrition scope
---
SOURCE: Stuart Phillips — Protein/Exercise Metabolism Research Group, McMaster University
DOMAIN: Dietary protein & skeletal-muscle protein turnover (hypertrophy + aging)
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: per-meal and daily protein requirements, leucine/EAA thresholds, muscle protein synthesis, protein quality/sources, protein during energy deficit, muscle preservation while dieting, sarcopenia
LINKS: https://emrg.science.mcmaster.ca/labs/protein-metabolism-research-lab/members/ | https://pubmed.ncbi.nlm.nih.gov/26980369/ ("Dietary Protein to Maintain Muscle Mass in Aging: A Case for Per-meal Protein Recommendations")
RELIABILITY: Tier-1 Canada Research Chair; stable-isotope-tracer + muscle-biopsy mechanistic work; ACSM/CAHS fellow; Clarivate Highly Cited. Notes industry partners among funders alongside CIHR/NIH/USDA — disclosed; weigh on protein-product-adjacent topics but methodology is gold-standard.
USE_FOR: Mechanistic, citable basis for protein dose/timing/quality and muscle preservation in a cut; the primary literature behind protein recommendations
CANNOT_USE_FOR: Anabolic/peptide pharmacology; clinical prescription; supplement brand endorsement (note funder ties when protein products are involved)
---
SOURCE: MASS Research Review (Monthly Applications in Strength Sport) — Helms, Trexler, Zourdos, Colenso-Semple
DOMAIN: Monthly synthesis of strength/physique/nutrition research
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: new RCTs on hypertrophy & strength, nutrition for physique athletes, periodization, fatigue management, study-quality critique, statistical literacy in lifting research
LINKS: https://www.strongerbyscience.com/MASS/
RELIABILITY: Reviewers are publishing PhDs (Helms/AUT-SPRINZ, Trexler, Zourdos); explicitly critiques methodology and discloses uncertainty/limitations rather than hyping single studies. Subscription product (paywalled) but content is study-interpretation, not supplement sales — low conflict.
USE_FOR: Staying current on what new research actually says and how reliable it is; expert interpretation that flags weak studies; translation of primary literature for coaching
CANNOT_USE_FOR: Primary data source itself (it's secondary commentary — cite the underlying paper); medical/peptide advice; settling a claim without checking the original study
---
SOURCE: Stronger By Science (Greg Nuckols, et al.)
DOMAIN: Evidence-based strength training, hypertrophy & nutrition education
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: training volume/intensity, strength vs hypertrophy adaptations, meta-analytic summaries, nutrition fundamentals, research-methods/statistics explainers, myth-busting
LINKS: https://www.strongerbyscience.com/ | https://gregnuckols.com/
RELIABILITY: Long-form articles with extensive in-text citation and explicit treatment of effect sizes and uncertainty; independent (revenue from programs/MASS, not supplement sales). Author is a practitioner-educator, not a primary academic — sound synthesis but secondary.
USE_FOR: Deep, well-cited explainers that connect multiple studies; understanding research-methods context; coach/client-facing education
CANNOT_USE_FOR: Original primary evidence (cite the linked studies); medical, dosing, or PED/peptide guidance
---
SOURCE: Examine.com
DOMAIN: Independent nutrition & supplement evidence database
TYPE: independent lab
CITES_PRIMARY: YES
USEFUL_TOPICS: supplement efficacy grading (creatine, protein, caffeine, beta-alanine, citrulline, etc.), dose-response, evidence strength by outcome, interaction/safety, separating marketed claims from RCT support
LINKS: https://examine.com/database/ | https://examine.com/about/
RELIABILITY: Contractually conflict-free; takes no money from supplement/food companies (revenue from subscriptions); multi-researcher grading + internal peer review of RCTs and meta-analyses; grades A–F by strength of evidence and discloses where evidence is weak. Strong independence signal.
USE_FOR: Checking whether a sports-nutrition supplement is actually backed by evidence and at what dose; neutral starting point before recommending any supplement
CANNOT_USE_FOR: Training-program design; clinical/medical diagnosis; peptide/PED protocols; a substitute for reading the graded primary studies on contested topics
---
SOURCE: Eric Helms — SPRINZ, Auckland University of Technology (Muscle & Strength Pyramids)
DOMAIN: Training, nutrition & psychology for physique/strength athletes
TYPE: expert commentary
CITES_PRIMARY: YES
USEFUL_TOPICS: hierarchy of training/nutrition priorities, protein and energy balance for physique sport, autoregulation/RPE, natural bodybuilding contest prep, evidence-based program design
LINKS: https://academics.aut.ac.nz/eric.helms/publications | https://muscleandstrengthpyramids.com/
RELIABILITY: PhD + dual master's; publishing academic and MASS co-founder; frameworks are explicitly evidence-graded and acknowledge uncertainty. Disclose: also a coach (3DMJ) and sells books/programs — commercial offerings exist but recommendations track the literature; low-moderate conflict.
USE_FOR: Prioritization frameworks that organize the evidence into actionable hierarchy; physique-athlete nutrition/training education with citable backing
CANNOT_USE_FOR: Primary data (secondary/expert layer); medical or pharmacological prescription; supplement/PED advice
---
SOURCE: Menno Henselmans (The Personal Trainer Development Center / research)
DOMAIN: Evidence-based hypertrophy & sports-nutrition education
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: optimal protein intake & diminishing returns, training-volume and frequency myths, hypertrophy modeling, carbohydrate intake for hypertrophy, debunking fitness misinformation
LINKS: https://mennohenselmans.com/eric-helms-protein/ | https://www.researchgate.net/publication/318368028_A_systematic_review_meta-analysis_and_meta-regression_of_the_effect_of_protein_supplementation
RELIABILITY: Co-author on peer-reviewed meta-analyses (protein supplementation; carbohydrate & hypertrophy), so some output is genuine primary/secondary research; much of the public-facing content is opinion-driven commentary that should be cross-checked. Independent educator; sells courses — moderate conflict, generally evidence-anchored.
USE_FOR: Provocative, citation-aware takes on protein/volume myths; cross-checking conventional claims; flagging where popular advice outruns the data
CANNOT_USE_FOR: Sole authority on contested points (verify against the cited meta-analyses); medical/peptide guidance; primary evidence when only a blog post is provided
---
SOURCE: Jeff Nippard (science-based bodybuilding, YouTube/jeffnippard.com)
DOMAIN: Science-communication for hypertrophy & training technique
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: exercise technique & biomechanics, volume/frequency/failure applied to lifters, program design walkthroughs, translating studies for a general audience, myth-busting "bro science"
LINKS: https://jeffnippard.com/ | https://www.youtube.com/channel/UC68TLK0mAEzUyHx5x5k-S1Q
RELIABILITY: BSc biochemistry; cites peer-reviewed studies on-screen and updates content when evidence changes; collaborates with academics (Helms, etc.). Educator/creator, not a researcher — interpretations are generally sound but secondary, and he sells programs (commercial interest). Verify specific numeric claims against sources he cites.
USE_FOR: Accessible, citation-backed explanations of training concepts and technique; client-facing education and orientation to the evidence
CANNOT_USE_FOR: Authoritative/primary citation (use the studies he references); medical, supplement-dosing, or PED/peptide advice
---

==========

### CATEGORY: clinical-nutrition

I have all the verification I need. All 8 sources have real, verified URLs from actual search results. Now I'll compile the registry with appropriate reliability assessments, flagging vendor-adjacent ties where they exist (Bikman's Insulin IQ commercial platform).

SOURCE: Examine.com
DOMAIN: Supplement & nutrition evidence analysis (micronutrients, ergogenic aids, metabolic interventions)
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Graded evidence for 950+ supplements/interventions, supplement-drug interactions, dose-response, outcome-specific effect grades (A–F), micronutrient supplementation, metabolic health compounds
LINKS: https://examine.com/ | Database: https://examine.com/database/ | About/independence: https://examine.com/about/
RELIABILITY: High independence — no ads, no sponsorships, sells no supplements, 100% subscription-funded; researchers contractually barred from conflicts of interest. Strong uncertainty disclosure via letter-grade evidence tiers. Every claim citation-backed. No vendor ties.
USE_FOR: Triangulating whether a given micronutrient/supplement has real evidence for a specific outcome, dosing ranges, interaction checks, and a neutral starting point before reading primary papers
CANNOT_USE_FOR: Individualized medical/clinical advice, prescribing, or as a substitute for reading the underlying trials when stakes are high; grades summarize evidence, they are not treatment recommendations
---
SOURCE: Linus Pauling Institute — Micronutrient Information Center (Oregon State University)
DOMAIN: Micronutrient biochemistry and physiology (vitamins, essential minerals, choline, EFAs, phytochemicals)
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: Mechanism of action per nutrient, deficiency/toxicity, biomarkers, RDA/upper-limit context, disease-prevention evidence, nutrient-nutrient interactions
LINKS: https://lpi.oregonstate.edu/mic | Nutrient index: https://lpi.oregonstate.edu/mic/nutrient-index | About/review process: https://lpi.oregonstate.edu/mic/about
RELIABILITY: Very high — university-based; each article written by PhD nutrition scientists, synthesizing basic/clinical/epidemiological literature with references throughout, then independently expert-reviewed (named authors + reviewers). Academic governance minimizes bias. No commercial product sales.
USE_FOR: Authoritative mechanism and physiology grounding for individual micronutrients, deficiency/toxicity framing, and citation trails into primary literature
CANNOT_USE_FOR: Cutting-edge or off-label peptide/supplement claims (scope is established micronutrients), personalized dosing, or clinical diagnosis
---
SOURCE: NIH Office of Dietary Supplements (ODS) — Health Professional Fact Sheets  [EXCLUDED app-facing — compliance / reference context ONLY, never an evidence authority]
DOMAIN: Dietary supplement & micronutrient evidence (vitamins, minerals, botanicals, metabolic-relevant nutrients)
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Per-nutrient health effects, intake recommendations, safety/upper limits, drug interactions, populations at risk, current state of evidence
LINKS: https://ods.od.nih.gov/ | All fact sheets: https://ods.od.nih.gov/factsheets/list-all/ | Vitamins & minerals: https://ods.od.nih.gov/factsheets/list-VitaminsMinerals/
RELIABILITY: Very high — U.S. government, non-commercial, no product sales; fact sheets are evidence-based, referenced, and maintained in parallel health-professional and consumer versions. Conservative and explicit about evidence gaps. No vendor conflicts.
USE_FOR: Baseline authoritative reference on micronutrient intake levels, safety ceilings, interactions, and consensus evidence state for a nutrient
CANNOT_USE_FOR: Novel/experimental compounds outside its catalog, individualized clinical protocols, or anything implying personal prescriptive advice
---
SOURCE: Chris Masterjohn, PhD
DOMAIN: Micronutrient biochemistry & metabolic physiology (fat-soluble vitamins A/D/K, mitochondrial energy metabolism, mineral status)
TYPE: expert commentary
CITES_PRIMARY: YES
USEFUL_TOPICS: Fat-soluble vitamin interactions, mitochondrial/energy nutrient pathways, biomarker interpretation, mineral balance, mechanistic deep-dives
LINKS: https://www.chrismasterjohn-phd.com/ | Newsletter: https://www.chrismasterjohn-phd.com/newsletter | Vitamins & Minerals 101: https://chrismasterjohnphd.com/blog/2019/03/06/vitamins-minerals-101/
RELIABILITY: PhD in Nutritional Sciences (UConn), former assistant professor; mechanistically rigorous and heavily references primary literature. Now independent (consulting + paid membership/courses), so commercial incentive exists around his info products — independent of supplement manufacturers, but verify his more speculative biochemical interpretations against consensus sources.
USE_FOR: Deep mechanistic explanations of fat-soluble vitamin and mineral interactions, biomarker reasoning, and energy-metabolism nutrient context
CANNOT_USE_FOR: Sole basis for a protocol (single-expert interpretation); some positions run ahead of consensus and should be cross-checked against LPI/ODS/Cochrane
---
SOURCE: Stephan J. Guyenet, PhD — including Red Pen Reviews
DOMAIN: Neuroscience of body-weight regulation, obesity, eating behavior, and nutrition-evidence quality appraisal
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Energy-balance vs carbohydrate-insulin models, leptin/brain regulation of fat mass, critical appraisal of nutrition claims, reference-accuracy auditing of popular nutrition books
LINKS: https://www.stephanguyenet.com/ | Red Pen Reviews: https://www.redpenreviews.org/ | RPR methodology/team: https://www.redpenreviews.org/about-us/
RELIABILITY: High — PhD in neuroscience (Univ. of Washington), ~4,400+ scholarly citations. Red Pen Reviews is explicitly independent, expert-led, peer-reviewed, free to public, and scores books on scientific accuracy, reference accuracy, and healthfulness (reviewers hold master's+ in relevant science). Strong uncertainty/conflict discipline. No supplement sales.
USE_FOR: Adjudicating competing diet/metabolic-health claims, checking whether a popular nutrition book/claim is faithful to its cited evidence, and a balanced read on obesity mechanisms
CANNOT_USE_FOR: Micronutrient dosing specifics or clinical supplementation protocols (scope is weight regulation + evidence critique, not a nutrient reference)
---
SOURCE: Michael Greger, MD — NutritionFacts.org
DOMAIN: Whole-diet and nutrition research synthesis (chronic disease prevention, dietary patterns, some micronutrient topics)
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Dietary-pattern evidence, food-vs-disease associations, aging/longevity nutrition, exhaustively hyperlinked study citations
LINKS: https://nutritionfacts.org/ | About: https://nutritionfacts.org/about/ | Example citation set (How Not to Age): https://nutritionfacts.org/book/how-not-to-age/citations/
RELIABILITY: Science-based nonprofit, free, no ads on products; every video carries transcript + citation list, and books carry thousands of hyperlinked references. Caveat: a known plant-based/whole-food advocacy lens means study selection can be directional — verify that cited studies support the strength of the claim. Author is non-commercial (proceeds donated) but viewpoint-driven.
USE_FOR: Finding primary studies on diet–disease relationships fast via dense citation trails; whole-food dietary-pattern context
CANNOT_USE_FOR: Neutral arbitration of contested questions (advocacy framing), supplement/micronutrient dosing, or metabolic protocols that conflict with its dietary stance
---
SOURCE: Cochrane Library (Cochrane Database of Systematic Reviews)
DOMAIN: Systematic reviews & meta-analyses of supplementation and clinical interventions
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Vitamin D/supplement efficacy and harms, GRADE-rated certainty of evidence, prevention vs treatment outcomes, where evidence is strong vs absent
LINKS: https://www.cochranelibrary.com/ | Representative review (vitamin D umbrella analysis): https://pmc.ncbi.nlm.nih.gov/articles/PMC10027242/
RELIABILITY: Gold-standard independence and methodological rigor; explicit, structured uncertainty reporting (GRADE certainty ratings), conflict-of-interest policies, and pre-registered protocols. No vendor ties. The highest-confidence tier for "does this actually work."
USE_FOR: The most rigorous answer on whether a supplement/intervention has proven benefit or harm for a specific outcome, and how certain that evidence is
CANNOT_USE_FOR: Mechanism explanations, individualized dosing, or topics with too few trials to review (absence of a Cochrane review ≠ absence of effect); reviews can lag the newest primary studies
---
SOURCE: Benjamin Bikman, PhD — Laboratory of Obesity and Metabolism (BYU)
DOMAIN: Insulin resistance, bioenergetics, and metabolic disease mechanisms
TYPE: academic lab
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: Molecular mechanisms of insulin resistance, ceramides/lipid signaling, obesity–diabetes–dementia links, ketones/metabolic substrate physiology
LINKS: https://benbikman.com/ | BYU faculty/speaker profile: https://speeches.byu.edu/speakers/benjamin-bikman/ | Coaching platform (commercial): https://insuliniq.com/about-us/benjamin-bikman/
RELIABILITY: Mixed. Genuine academic credentials (PhD in bioenergetics, BYU professor, 30+ peer-reviewed publications, runs a university lab) — his published research is rigorous and citable. BUT his public-facing personal site and Insulin IQ are commercial (paid newsletter, coaching) and light on inline citations — VENDOR-ADJACENT for the consumer-facing content. Some positions (e.g., strong insulin-centric framing) are debated vs the energy-balance model.
USE_FOR: Mechanistic grounding on insulin resistance and metabolic dysfunction, via his peer-reviewed publications and academic profile
CANNOT_USE_FOR: Treating his commercial site/Insulin IQ claims as independent evidence; sole authority on contested metabolic models — cross-check against Cochrane/Guyenet/primary literature
---

==========

### CATEGORY: international

I have everything I need to build 6 well-verified source blocks spanning Russian primary labs, Chinese clinical literature, independent synthesis, and commentators — all with disclosed uncertainty and vendor ties flagged. Compiling the final output.

SOURCE: Prof. Vladimir Khavinson — St. Petersburg Institute of Bioregulation & Gerontology (khavinson.info)
DOMAIN: Russian short-peptide bioregulators; biogerontology; geroprotectors (Epitalon/Epithalamin, Thymalin, Cortexin, Vilon, Pinealon)
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: tetrapeptide AEDG (Epitalon) mechanism and telomerase; thymus/pineal organ-peptide bioregulation; geroprotective lifespan/mortality data; gene-expression/epigenetic effects; clinical gerontology endpoints
LINKS: https://khavinson.info/publications | https://khavinson.info/assets/files/2013-Khavinson_Kuznik.pdf | representative primary RCT: https://pubmed.ncbi.nlm.nih.gov/22451889/ (15-yr follow-up, Bull Exp Biol Med) | mouse lifespan/tumor: https://link.springer.com/article/10.1023/A:1025114230714
RELIABILITY: This is the originating lab itself, so NOT independent of the compounds it promotes — institutional conflict is structural. Rigor is real (decades of in vitro/in vivo/clinical work, hundreds of indexed papers) but much is published in Russian-language or low-impact journals (Bull Exp Biol Med), small samples, limited blinding detail, sparse Western replication. The English bibliography links to PDFs/DOIs, not always PubMed. Author is the inventor and patent holder — treat efficacy claims as advocacy.
USE_FOR: Locating the actual primary papers and DOIs behind any Khavinson-peptide claim; canonical sequences (e.g., Epitalon = Ala-Glu-Asp-Gly); the lab's stated mechanism and study designs; reaching the primary source in English
CANNOT_USE_FOR: Independent verification of efficacy/safety; treating mortality/lifespan claims as settled; dosing protocols for humans; assuming Western regulatory acceptance
---
SOURCE: "Overview of Epitalon—Highly Bioactive Pineal Tetrapeptide" — Araj, Brzezik, Mądra-Gackowska & Szeleszczuk (Medical Univ. of Warsaw / Nicolaus Copernicus Univ.), Int. J. Molecular Sciences 2025
DOMAIN: Independent academic review/synthesis of the Epitalon (AEDG) literature
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: consolidated in vitro / in vivo / in silico evidence for Epitalon; antioxidant, neuroprotective, antimutagenic, telomerase/geroprotective mechanisms; structure-activity; gaps in the evidence base
LINKS: https://pubmed.ncbi.nlm.nih.gov/40141333/ | https://www.mdpi.com/1422-0067/26/6/2691 | https://pmc.ncbi.nlm.nih.gov/articles/PMC11943447/
RELIABILITY: Peer-reviewed, open-access, authored by an academic group with no apparent commercial stake in the compound — a genuinely independent secondary source that aggregates and weighs the (largely Russian) primary literature. MDPI/IJMS is mid-tier with fast review, so weight conclusions accordingly, but it is the cleanest English-language entry point that traces every claim back to primary papers and flags weaknesses.
USE_FOR: A balanced, citation-dense map of what is actually shown for Epitalon vs. asserted; finding the underlying primary studies; mechanism summaries to brief a client honestly
CANNOT_USE_FOR: Clinical/dosing guidance; proof of human efficacy (review is largely preclinical); endorsing the compound for therapeutic use
---
SOURCE: Thymosin alpha-1 (thymalfasin / Zadaxin) clinical literature — Chinese cohort & CNKI-indexed studies and reviews on PubMed/PMC
DOMAIN: Chinese-led clinical/academic peptide immunology (Tα1 in sepsis, severe pancreatitis, oncology adjuvant, COVID-19, hepatitis)
TYPE: evidence synthesis
CITES_PRIMARY: YES
USEFUL_TOPICS: Tα1 immune-regulatory mechanism (T-cell maturation); multicenter Chinese cohort data; meta-analyses searching CNKI + Western databases; immuno-oncology and critical-care use widely practiced in China
LINKS: meta-analysis (severe acute pancreatitis, searches CNKI): https://pmc.ncbi.nlm.nih.gov/articles/PMC12208829/ | China multicenter COVID cohort (Hubei): https://pubmed.ncbi.nlm.nih.gov/34408744/ | immuno-oncology review: https://pubmed.ncbi.nlm.nih.gov/36871535/ | human-trials safety/efficacy review: https://pubmed.ncbi.nlm.nih.gov/38308608/
RELIABILITY: Peer-reviewed and PubMed/PMC-indexed; the meta-analyses are the bridge to Chinese-language primary work (they explicitly search China National Knowledge Infrastructure). Mixed quality — some Chinese cohort/observational designs carry bias, and at least one indexed study found NO benefit (PMC8209490), which is useful for honest framing. Tα1 is an approved drug in many countries (real regulatory footprint), reducing fringe risk versus the Russian bioregulators.
USE_FOR: Reaching Chinese clinical/academic Tα1 evidence via English meta-analyses; mechanism and approved-indication context; showing both positive and null results
CANNOT_USE_FOR: Generalizing Tα1 data to other "thymic peptides"; off-label longevity claims; assuming Chinese cohort findings equal Western RCT-grade proof
---
SOURCE: Institute of Molecular Genetics, Russian Academy of Sciences (Myasoedov / Ashmarin school) — Semax & Selank primary literature
DOMAIN: Russian regulatory-peptide neuroscience (nootropic/anxiolytic heptapeptides Semax [ACTH(4-10) analog] and Selank [Tuftsin analog])
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: ACTH-fragment and Tuftsin-derived peptide design; BDNF/neurotrophic and gene-expression effects; focal-ischemia transcriptomics; Parkinson's-model behavior; Russian clinical registration as medicines
LINKS: genome-wide ischemia study (PMC): https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3987924/ | Parkinsonism model: https://pubmed.ncbi.nlm.nih.gov/28702721/ | mechanism/radiolabel methodology (Wiley): https://analyticalsciencejournals.onlinelibrary.wiley.com/doi/10.1002/jlcr.3785
RELIABILITY: Originating-institution science, so not independent of the compounds, but published in indexed journals (some Western, e.g., PMC/Wiley) with mechanistic depth. Bulk of evidence is animal-model and Russian-registered clinical use rather than international phase-3 RCTs; small samples and limited blinding are common. Semax/Selank are registered drugs in Russia, lending real-world grounding, but Western evidence is thin.
USE_FOR: Tracing Semax/Selank claims to primary mechanistic papers; understanding the Soviet/Russian peptide-design lineage and the institutes behind it
CANNOT_USE_FOR: Western efficacy/safety assurance; human dosing protocols; treating Russian drug registration as equivalent to FDA approval
---
SOURCE: peptides.fyi (Editorial) — "Selank and Semax: Nootropic Peptides From Russian Research Programs"
DOMAIN: English-language explainer that traces Russian peptide programs back to primary literature and names the originating researchers/institutes
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: plain-English history of IMG RAS programs; named researchers (Dolotov, Gusev, Skvortsova, Zozulya, Seredenin, Voronina); honest framing of evidence gaps (Russian-language journals, small N, no phase-3)
LINKS: https://www.peptides.fyi/selank-semax-nootropic-peptides-russian-research/
RELIABILITY: Anonymous editorial ("peptide researcher and science writer") with NO disclosed credentials — independence unverifiable. Carries affiliate revenue (Amazon associate + a "recommended supplier" for research peptides), so it is vendor-adjacent and must be treated as such. Notable strength: it explicitly discloses uncertainty — limited blinding, small samples, Russian-only publication, no FDA phase-3 — which is rare for this niche. Cites named researchers and journals but not always with direct links.
USE_FOR: Fast orientation and a list of names/institutes/journals to then verify against PubMed; example of correctly-caveated framing to model client comms on
CANNOT_USE_FOR: A primary or authoritative citation; any efficacy/safety claim; supplier or product recommendations (affiliate conflict)
---
SOURCE: Aging Matters Magazine / IAS (Phil Micans, MSc) — peptide-bioregulator commentary and Khavinson interviews
DOMAIN: Longevity-community commentary on Russian peptide bioregulators (pineal/thymus geroprotectors)
TYPE: expert commentary
CITES_PRIMARY: SOMETIMES
USEFUL_TOPICS: accessible explanation of bioregulator concept and history (since 1973); Khavinson interviews; references to the 12–15-yr mortality follow-up studies; which organ-peptides map to which systems
LINKS: https://aging-matters.com/peptide-bioregulators-promote-active-and-functional-longevity/ | https://aging-matters.com/reversing-biological-aging-with-peptide-bioregulators/ | https://podofinquiry.com/2025/03/khavinson-bioregulators-longevity-science/
RELIABILITY: Strong vendor conflict — Phil Micans is VP of the IAS Group, which retails these peptides, and he co-authored a book with Khavinson; this is promotional/advocacy content, not independent analysis. It does point at real underlying studies (the mortality follow-ups) but selectively and without consistent disclosure of limitations. Useful as a signpost to the primary Khavinson/Anisimov papers, not as an evidence source.
USE_FOR: Quickly identifying which primary studies/compounds the longevity community cites, so you can pull and vet the actual papers; lay-audience framing
CANNOT_USE_FOR: Independent or rigorous evidence; efficacy/safety claims; any sourcing where vendor neutrality matters (treat as vendor-adjacent advocacy)
---

==========

### CATEGORY: academic-labs

I now have verified PIs, institutions, conflict-of-interest disclosures, and representative primary papers for 6 academic labs. I have enough verified, real sources with attached URLs to produce 6 source blocks. Let me compile the output.

SOURCE: Predrag Sikirić Laboratory — University of Zagreb School of Medicine (Department of Pharmacology)
DOMAIN: BPC-157 pentadecapeptide — cytoprotection, GI ulcer healing, angiogenesis, tendon/nerve/vascular repair
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: BPC-157 mechanism (nitric oxide system, VEGFR2-Akt-eNOS angiogenic pathway), stable-in-gastric-juice pharmacology, vascular/ischemia-reperfusion models (Pringle maneuver, Budd-Chiari), gut-brain axis, dopaminergic/serotonergic interactions
LINKS: https://pubmed.ncbi.nlm.nih.gov/35125818/ (Sikirić et al., World J Gastroenterol 2022 — "Cytoprotective gastric pentadecapeptide BPC 157 resolves major vessel occlusion disturbances..."); review https://pubmed.ncbi.nlm.nih.gov/38675421/ (BPC 157 pleiotropic activity & neurotransmitters, 2024); full text https://pmc.ncbi.nlm.nih.gov/articles/PMC8793015/
RELIABILITY: Originating/primary lab for nearly all BPC-157 mechanism work — this is the source other reviews cite. Heavy rigor on animal models with explicit mechanism. CAVEAT: the field is dominated by this single group, much is rodent-only, very little independent human RCT replication exists, and the concentration of authorship in one lab is itself a limitation to weigh. No vendor ties, but near-monopoly on the evidence base.
USE_FOR: Understanding the actual proposed mechanism of BPC-157 and the preclinical evidence boundary; sourcing primary citations instead of vendor blog claims
CANNOT_USE_FOR: Establishing human clinical efficacy/safety, dosing in humans, or treating single-lab rodent findings as settled clinical fact
---
SOURCE: Pinchas Cohen Laboratory — USC Leonard Davis School of Gerontology / USC Mann School of Pharmacy
DOMAIN: Mitochondrial-derived peptides (MDPs) — MOTS-c, humanin, SHLP1–6
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: MOTS-c as exercise-mimetic / AMPK activation / metabolic homeostasis, humanin cytoprotection & insulin sensitization, mitochondrial-to-nuclear retrograde signaling ("mitokines"), MDP biology in aging/healthspan, mitochondrial microproteins from small ORFs
LINKS: https://pubmed.ncbi.nlm.nih.gov/25738459/ (Lee et al./Cohen lab, Cell Metab 2015 — original MOTS-c discovery paper); review https://www.jci.org/articles/view/158449 (Mitochondria-derived peptides in aging and healthspan, JCI); faculty/lab page https://gero.usc.edu/faculty/cohen/
RELIABILITY: Discovering lab for MOTS-c and humanin; foundational primary literature published in top journals (Cell Metabolism, JCI). Strong mechanistic rigor. DISCLOSED CONFLICT: Cohen is co-founder of CohBar, a biotech developing mitochondrial peptides for metabolic disease — weigh commercial interest when reading therapeutic-potential framing.
USE_FOR: Authoritative mechanism and discovery context for MOTS-c/humanin; distinguishing endogenous-signaling biology from supplement marketing
CANNOT_USE_FOR: Validating injectable "MOTS-c" performance/anti-aging products in humans, or dosing protocols — the lab studies endogenous biology and early translation, not consumer use
---
SOURCE: Hazel Szeto Laboratory (Szeto–Schiller peptides; formerly Weill Cornell Medicine)
DOMAIN: Mitochondria-targeted cell-penetrating tetrapeptides — SS-31 / elamipretide, cardiolipin biology
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: SS-31 selective cardiolipin binding on the inner mitochondrial membrane, electron-transport-chain stabilization, ROS reduction, ATP restoration, mechanism via membrane surface electrostatics, ischemia-reperfusion and heart-failure models
LINKS: https://pmc.ncbi.nlm.nih.gov/articles/PMC7247319/ (Mitchell/Szeto et al. — "The mitochondria-targeted peptide SS-31 binds lipid bilayers and modulates surface electrostatics...", 2020); biorxiv preprint https://www.biorxiv.org/content/10.1101/735001.full.pdf
RELIABILITY: Origin lab for the entire SS/Szeto-Schiller peptide class (the "SS" is Szeto-Schiller); primary mechanistic literature. DISCLOSED CONFLICT: Szeto founded Stealth BioTherapeutics, which licensed the technology and develops elamipretide commercially; she may benefit as licensee — substantial commercial tie, disclosed in primary papers. Independent biorxiv mechanism work (Mitchell et al.) helps triangulate.
USE_FOR: Real cardiolipin-targeting mechanism of SS-31; understanding why it concentrates in mitochondria; sourcing primary vs. vendor claims
CANNOT_USE_FOR: Treating efficacy framing as conflict-free; generalizing the FDA Barth-syndrome (elamipretide) approval to off-label anti-aging/performance use
---
SOURCE: Daniel J. Drucker Laboratory — Lunenfeld-Tanenbaum Research Institute, Mount Sinai Hospital / University of Toronto
DOMAIN: Incretin and proglucagon-derived peptide biology — GLP-1, GLP-2, glucagon, gut-brain-immune signaling
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: GLP-1 glucose-dependent insulin secretion, appetite/food-intake regulation, cardioprotection, anti-inflammatory action, GLP-2 and intestinal growth, mechanism-to-therapeutic translation (basis for GLP-1 receptor agonist drug class)
LINKS: https://www.lunenfeld.ca/?page=drucker-daniel (lab page); https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10786682/ ("The GLP-1 journey: from discovery science to therapeutic impact"); https://www.jci.org/articles/view/154150 (JCI conversation with Drucker)
RELIABILITY: One of the foundational labs of incretin biology; extensive top-tier primary literature and authoritative reviews. CONFLICT TO NOTE: Drucker holds a Novo Nordisk-endowed incretin chair and has extensive disclosed consulting relationships with GLP-1 drug developers (standard in the field; check the disclosure block of each paper rather than the lab page, which does not list them).
USE_FOR: Gold-standard mechanism of GLP-1/GLP-2 and the science underpinning GLP-1 agonist therapeutics; separating established endocrinology from peptide-marketing extrapolation
CANNOT_USE_FOR: Endorsing unapproved/compounded GLP-1 "research peptide" sourcing or non-clinical dosing; reading him as conflict-free re: the drug class
---
SOURCE: Joel Habener Laboratory of Molecular Endocrinology — Massachusetts General Hospital / Harvard Medical School (with Svetlana Mojsov)
DOMAIN: Discovery of GLP-1 — proglucagon gene structure and the bioactive GLP-1(7-37) insulinotropic hormone
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: Proglucagon cDNA cloning, identification of the truncated bioactive GLP-1 sequence, insulinotropic action establishing GLP-1 as an incretin, historical foundation of the entire GLP-1 therapeutic field
LINKS: https://www.jci.org/articles/view/186225 (JCI — Habener, Mojsov & Knudsen 2024 Lasker Award, summarizing the discovery); https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11446598/ (same, PMC); https://www.sciencedirect.com/science/article/abs/pii/S0167011504003490 ("The discovery of glucagon-like peptide 1", Regul Pept review)
RELIABILITY: Primary discovery lab (recognized by the 2024 Lasker~DeBakey Clinical Medical Research Award). Authoritative historical/mechanistic origin. Largely historical record now; for current mechanism pair with Drucker lab. Low vendor conflict in the foundational work itself.
USE_FOR: Authoritative origin and identity of GLP-1(7-37); grounding incretin claims in the actual discovery literature
CANNOT_USE_FOR: Current clinical dosing/therapeutic guidance (foundational discovery, not a treatment protocol source)
---
SOURCE: Allan L. Goldstein Laboratory — George Washington University (Department of Biochemistry & Molecular Medicine)
DOMAIN: Thymic peptides — thymosin α1 (immunomodulation) and thymosin β4 (actin regulation, tissue repair)
TYPE: academic lab
CITES_PRIMARY: YES
USEFUL_TOPICS: Isolation of thymosins from thymosin fraction 5, thymosin α1 immune modulation via TLR9/dendritic cells, thymosin β4 actin sequestration and roles in angiogenesis/wound healing/regeneration, basic properties and structure-function
LINKS: https://hsrc.himmelfarb.gwu.edu/smhs_biochem_facpubs/7/ (Goldstein, Hannappel et al. — "Thymosin β4: a multi-functional regenerative peptide. Basic properties"); academic profile https://research.com/u/allan-l-goldstein
RELIABILITY: Originating lab that first isolated and characterized the thymosins; primary peer-reviewed literature spanning decades. Strong on basic biology/mechanism. CAVEAT: Goldstein has historic commercial/patent involvement in thymosin development (e.g. SciClone/thymalfasin lineage); much regenerative-claim literature is preclinical — weigh translation gap and check individual-paper disclosures.
USE_FOR: Real biochemistry and mechanism of thymosin α1 / β4 and their discovery context; primary citations behind "TB-500"/thymosin marketing claims
CANNOT_USE_FOR: Validating TB-500/thymosin β4 injectable products, human performance/healing dosing, or treating preclinical regenerative claims as proven clinical outcomes
---