# Audit af Market Research Blueprint

> **Status:** Beslutningsgrundlag for Blueprint v2.0.0. Auditens forslag er ikke en parallel
> produktkontrakt. Hvor konkrete navne, antal tools eller scopevalg afviger, er `BLUEPRINT.md` og
> `ROADMAP.md` gældende. Den vedtagne v1 er én competitor/positioning-ability, tre source paths og
> fire initiale MCP-tools; Brand Lift, kampagnestyring og monitoring er udskudt.

Dato: 2026-10-17  
Auditgrundlag: `BLUEPRINT.md` v1.1.0, `ROADMAP.md`, produktdokumentation, applikationskode,
datamodel, tests, migrations og packaging i repositoryet.  
Formål: Vurdere om produktdefinitionen og den nuværende løsning er den rigtige, mindst mulige vej til
et premium audience/market-research-modul, der kan bruges direkte fra kundens valgte AI-værktøj.

## 1. Konklusion

Blueprintet er stærkt som governance- og risikodokument. Det har usædvanligt gode grænser for
persondata, evidens, usikkerhed, læring og kausale påstande. Det er den del, der mest sandsynligt kan
blive et varigt konkurrencemæssigt aktiv.

Blueprintet er derimod ikke endnu et præcist blueprint for det produkt, der nu ønskes solgt. Det
beskriver i praksis en stor, selvstændig researchplatform med egen webapp, worker, database,
identitetsintegration, kampagnestyring, Brand Lift, monitoring og administration. Det ønskede produkt
er beskrevet som et let modul, der installeres i ChatGPT, Claude, Copilot eller et andet virksomheds-
AI-miljø. Den forskel er den vigtigste uløste beslutning i hele projektet.

Den nuværende implementering viser høj teknisk disciplin, men også tydelig overbygning i forhold til
den første validerede brugscase. Repositoryet indeholder cirka 21.950 TypeScript/TSX-linjer i app,
core, scripts og integrationstest, 43 Drizzle-tabeller, 38 testfiler, en komplet Next.js-overflade og
omfattende kampagne-, målings-, monitoring-, budget- og driftsfunktionalitet. Samtidig er der ingen
færdig remote MCP-server, ingen host-kontrakt til ChatGPT/Claude/Copilot, ingen aktiv live
source-adapter, ingen godkendt D4WN-kildeliste og ingen human benchmark på reelle outputs.

Den rigtige næste handling er derfor ikke at bygge flere researchfunktioner. Den er at ændre
Blueprintet fra et platform-blueprint til et produkt- og distributions-blueprint, beslutte den
smalle v1-brugscase og etablere én portabel agentgrænse. Først derefter bør den eksisterende kode
trimmes og genbruges selektivt.

## 2. Samlet vurdering

| Område | Vurdering | Kommentar |
| --- | --- | --- |
| Evidensdisciplin | Stærk | Sporbarhed, kildegrundlag, usikkerhed og modstridende evidens er godt tænkt |
| Privacy-grænse | Stærk | Trend-first og people-blind er klart differentierende og bør bevares |
| Kausal disciplin | Stærk | Brand Lift og kausalitet behandles ansvarligt |
| Produktfokus | Svag | For mange produktkategorier er samlet i én v1 |
| Distributionsmodel | Kritisk uklar | “Egen app” og “modul i kundens AI-tool” er to forskellige produkter |
| Portabilitet mellem AI-hosts | Ikke implementeret | Ingen remote MCP-/agent-facing kontrakt findes endnu |
| Reelle datakilder | Ikke valideret | Produktionsregistry er bevidst tom, og source rights er åbne |
| Researchkvalitet | Ikke valideret | Deterministiske tests kan ikke bevise ekspertkvalitet på reelle briefs |
| Kommerciel paketering | Ufuldstændig | Licens, support, opgraderinger, SLA og enhedsøkonomi mangler |
| Driftsmodel | Delvist defineret | Mange kontroller findes, men kundeansvar og deployment burden er ikke løst |
| Legacy-oprydning | Ufuldstændig | `last30days` er deaktiveret, men fortsat bundlet og repræsenteret i kode og schema |

## 3. Hvad Blueprintet gør særligt godt

### 3.1 En ærlig evidensmodel

Skellet mellem observation, signal, fact, hypothesis, insight, recommendation og learning er
værdifuldt. Det gør det muligt at forklare ikke kun konklusionen, men også dens epistemiske status.
Det bør være en del af produktets offentlige løfte og outputkontrakt, ikke kun intern arkitektur.

### 3.2 En stærk dataetisk produktgrænse

“Trend-first, people-blind” er både ansvarligt og kommercielt anvendeligt. Det afgrænser produktet
fra overvågning, mikroprofilering og tvivlsomme social-data-produkter. Grænsen skal dog suppleres med
operationelle og juridiske standarder; den kan ikke alene hvile på heuristisk tekstredaktion.

### 3.3 Fail-closed-adfærd

Systemet foretrækker `needs_context` frem for opfundet sikkerhed. Det er rigtigt for et premium
researchprodukt. Det skal være synligt som en kvalitetsfunktion, ikke opleves som en teknisk fejl.

### 3.4 Versioneret klientkontekst

Adskillelsen mellem virksomhedens egen strategi, ekstern evidens og godkendt markedsintelligens er
solid. Frysning af anvendt kontekst/version gør historiske anbefalinger reviderbare.

### 3.5 Provider-neutrale domænegrænser

Connector-, evidence-, metric- og delivery-kontrakterne er et godt fundament. Retningen er rigtig,
selv om den nuværende runtime endnu ikke er reelt provider-neutral i alle lag.

## 4. Kritiske konflikter og udfordringer

### P0-1: Produktet har to modstridende former

Blueprintet låser hver kunde til egen app, worker, PostgreSQL-database, identity provider, secret
store og providerkonti. Produktoplevelsen er samtidig defineret som en fuld webapplikation med
Projects, Market Pulse, Market Twin, Campaign Studies og Sources & Setup.

Det ønskede produkt er et modul, som medarbejderen bruger direkte i ChatGPT, Claude eller Copilot.
Det kræver en agent-facing produktgrænse: typisk en remote MCP-server med OAuth, små stabile tools og
eventuelt standardiserede UI-resources. Denne grænse findes ikke i Blueprintets logiske arkitektur og
er heller ikke implementeret.

Konsekvens: Der kan bygges et velfungerende produkt, som kunden alligevel oplever som “endnu et
system”, og ikke som en evne i det værktøj, de allerede arbejder i.

Beslutning: Vælg eksplicit én primær produktoplevelse:

1. AI-native modul med en smal adminflade; eller
2. selvstændig researchplatform med AI-integration som sekundær kanal.

Anbefaling: Vælg mulighed 1. Lad hosten eje samtalen, og lad Market Research eje evidens,
policy, researchmetode, sporbarhed og vedvarende tilstand.

### P0-2: “Let modul” og nuværende driftsmodel hænger ikke sammen

En installation med webapp, worker, PostgreSQL, OIDC, secret store, observability, backups og separate
providerkonti er ikke let at købe, installere, opdatere eller supportere. Det kan være den rigtige
sikkerhedsmodel for store, regulerede kunder, men bør ikke beskrives som et let modul uden en
standardiseret deploymentpakke og klart ansvarsdiagram.

Anbefaling: Definér to adskilte begreber:

- **Brugerinstallation:** kunden aktiverer et plugin/connector i sit AI-værktøj.
- **Data-plane deployment:** den bagvedliggende single-tenant service kører enten i kundens cloud
  eller som en managed, logisk isoleret installation.

Hvis “kunden ejer og driver alt” fortsat er et absolut krav, skal produktet omfatte IaC,
opgraderingskanal, backup/restore, secret rotation, runbooks og supportkontrakt som førsteborgere.
Ellers bliver hver kunde et konsulentprojekt.

### P0-3: Blueprintet mangler den portabilitetskontrakt, der skal bære produktet

“Replaceable surfaces” er et princip, men ikke en specificeret kontrakt. Der mangler:

- remote MCP transport og versionspolitik;
- OAuth 2.0/OIDC service authorization og per-user/role mapping;
- toolnavne, toolbeskrivelser, input/output-schemaer og annotations;
- hvilke tools der er read-only, write, review-gated eller administrative;
- regler for data, som AI-hosten må modtage;
- host capability matrix for ChatGPT, Claude og Copilot;
- fallback for hosts uden den krævede MCP-funktionalitet;
- conformance-tests, der køres mod hver understøttet host;
- prompt-/tool-selection-evals og beskyttelse mod tool confusion.

Aktuel officiel dokumentation understøtter remote MCP som fællesnævner, men hostene er ikke identiske:

- ChatGPT bruger plugins/custom MCP servers og kan vise valgfri MCP Apps UI.
- Claude forbinder til remote MCP fra Anthropics cloud; private endpoints kræver netværksmæssig
  tilgængelighed/allowlisting, og organisationens administrator styrer installation.
- Copilot Studio understøtter Streamable HTTP og lægger yderligere Power Platform-data policies,
  connector packaging og eventuel certificering ovenpå.

Konsekvens: “Byg én gang, kør ens overalt” er ikke en realistisk garanti. Det realistiske løfte er
“én canonical MCP-tool-kontrakt med tynde, testede hostpakker og dokumenterede forskelle”.

### P0-4: V1 er ikke et MVP; det er en produktportefølje

Blueprintets minimum proof kræver dokumentingestion, Market Twin, market pulse, competitor brief,
audience synthesis, campaign pre-flight, campaign readback, Brand Lift-plan, learning review og
privacy-bevis. Det spænder over mindst fem selvstændige produktkategorier:

1. market/competitor intelligence;
2. audience research;
3. social listening/monitoring;
4. campaign planning og performance learning;
5. research/study design og Brand Lift.

Det matcher ikke den valgte første pilot, som er D4WN-positionering og konkurrentforståelse i Danmark.
Kampagnelivscyklus, live monitoring og Brand Lift er ikke nødvendige for at validere denne
betalingsvillighed eller kerneværdi.

Anbefaling: Flyt kampagne-, Brand Lift- og løbende monitoringfunktioner ud af v1. Bevar kontrakterne
som parkerede designnoter, men fjern dem fra MVP-gaten og fra alt, der skal vedligeholdes i første
produktrelease.

### P0-5: “Premium” er endnu ikke målbart

Blueprintet har de rigtige evalueringsdimensioner, men næsten ingen konkrete accepttærskler. Der er
ingen aftale om, hvor præcis en citation skal være, hvor ofte systemet må overse en modstridende
kilde, hvilken fejlrate der accepteres, hvor hurtigt en brief skal leveres, eller hvad der udgør
tilstrækkelig senior-marketing-værdi.

Anbefalet første quality contract:

- mindst 98 % korrekte og åbnebare citationer på evalueringssættet;
- 100 % sporbarhed for materielle claims;
- 0 accepterede personprofiler eller cross-client leaks;
- mindst 95 % korrekt klassifikation af fact/hypothesis/insight/recommendation;
- mindst 95 % recall på plantede modstridende evidenspunkter;
- højst 1 % unsupported material claims;
- median reviewer-score mindst 4/5 på relevans, klarhed og decision usefulness;
- dokumenteret maksimum for pris og svartid pr. brief;
- en aftalt abstention-rate, så `needs_context` hverken bliver for sjælden eller produktødelæggende.

Tallene er startforslag og skal kalibreres med rigtige pilotcases. De må ikke erklæres opfyldt af
syntetiske tests.

### P0-6: Ingen produktionskilde producerer endnu evidens

Den produktionsmæssige adapterregistry er bevidst tom. De fire adapters i kodebasen er deterministiske
fixture-/normaliseringsveje, ikke live, godkendte datakilder. D4WN har ingen godkendt source inventory,
og external validation-registeret har alle centrale gates åbne.

Konsekvens: Produktets stærkeste løfte — løbende, aktuel, trusted research — er endnu uprøvet. Flere
core-features forbedrer ikke dette.

Anbefaling: Vælg præcis tre v1-source paths:

1. kundens godkendte dokumenter/researchfiler;
2. kurateret public web/official sources via én dokumenteret acquisition-metode;
3. én lovlig social/listening-kilde, helst aggregerede exports eller en licenseret API.

Ingen fjerde source class bør implementeres, før disse tre har source-rights review, live receipts,
failure tests og reviewer-validerede briefs.

### P0-7: `last30days` er både “fjernet” og stadig en produktbyrde

Den gamle engine er permanent deaktiveret, men:

- submodulet er fortsat påkrævet i local setup;
- Docker-image installerer Python og kopierer submodulet;
- worker abonnerer stadig på legacy-køen;
- `/runs` og legacy trigger/cancel-ruter findes stadig;
- parser, smoke script, feature flag, worker wrapper og tests vedligeholdes fortsat;
- den gamle evidence-tabel indeholder fortsat `author_handle`;
- projektinstruktionerne kræver, at submodulet bevares.

Det er direkte i konflikt med ønsket om at fjerne alt irrelevant fra `last30days`. “Deaktiveret” er
ikke det samme som “fjernet”; kode, dependencies, schema og mental overhead er fortsat til stede.

Anbefalet oprydningsrækkefølge:

1. dokumentér om nogen reel installation har legacy-data;
2. eksportér eller tombstone nødvendige historiske records;
3. lav en fremadgående migration, der fjerner identity-bearing legacyfelter og ubrugte tabeller;
4. fjern `/runs`, legacy queue, worker wrapper, parser, smoke script og feature flag;
5. fjern Python og `vendor/last30days` fra Docker-image;
6. fjern submodul og `.gitmodules`-krav;
7. arkivér de historiske ADR'er som historie, ikke aktive instruktioner;
8. opdatér `AGENTS.md`, README, source-of-truth-check og testlisten.

Gamle, allerede anvendte migrationer skal ikke omskrives. De skal efterfølges af en eksplicit
cleanup-migration.

### P1-1: Provider-neutraliteten er kun delvis reel

Domænekontrakterne er provider-neutrale, men runtime er bundet til:

- OneLogin-navngivne miljøvariabler og login-flow;
- én OpenAI Responses synthesis-adapter;
- en synthesis binding-union, der aktuelt kun accepterer `openai-responses`;
- en Next.js-websurface som primær outputkanal.

Det er acceptabelt for en første referenceimplementation, men Blueprintet bør skelne mellem:

- **provider-neutral core contract**;
- **reference adapters, som v1 faktisk understøtter**;
- **certificeret kompatibilitet**, som er testet i produktion.

Ellers risikerer “provider-neutral” at blive læst som en kapabilitet, der endnu ikke findes.

### P1-2: Authentication og authorization er designet til webappen, ikke AI-hosts

Den nuværende brugeradgang er cookie- og sessionbaseret. Dokumentationen siger selv, at
company-context API'et ikke er service-account/MCP authentication. For et AI-native modul mangler en
sikker identitetskæde fra host-bruger til kunde, rolle, market scope og tool permission.

Der skal vælges mellem:

- delegated per-user OAuth med kundens IdP;
- en admin-managed shared connection med meget begrænset scope;
- workload identity til automationer;
- eventuelt kombinationer, men uden implicit privilege escalation.

Hver tool call skal auditere host, subject, tenant, role, purpose, input digest, selected evidence og
resultatstatus. En menneskelig browser-session må ikke genbruges som agentcredential.

### P1-3: Market Twin risikerer at blive en universal knowledge graph

Listen over core entities er næsten ubegrænset. Det kan føre til ontology work, graph abstractions og
administrationsflader, før de giver værdi. Den nuværende datamodel bruger generiske intelligence
records og JSONB, hvilket begrænser noget af risikoen, men Blueprintet lægger stadig op til meget bred
modellering.

Anbefaling: I v1 er Market Twin en versioneret samling af højst fem recordtyper:

- company intent;
- accepted market fact;
- accepted audience/competitor insight;
- hypothesis;
- knowledge gap.

Tilføj først flere typer, når en konkret, evalueret ability kræver dem. Undgå separat graph-database,
vector store eller generisk ontology engine, indtil målte retrieval-fejl dokumenterer behovet.

### P1-4: Ability-kataloget overvurderer reel funktionalitet

Alle ti abilities har manifests, men seks decision-brief abilities bruger samme generelle outputform
og en fælles rubric på fire linjer. At et manifest findes, er ikke det samme som domæneekspertise.
“Audience intelligence”, “competitor intelligence” og “research planning” kræver forskellige
metoder, kildekritik, fejlmoder og reviewerkompetencer.

Anbefaling: Kald en ability “available” først når den har:

- en use-case-specifik metode og claim taxonomy;
- positive, negative og adversarial eval cases;
- source-class-specific failure modes;
- en navngiven reviewer og score threshold;
- mindst én reel pilotoutput med remediation/retest;
- host-facing tool behavior og klare abstention cases.

Indtil da bør status være `designed`, `implemented`, `validated` eller `production`, ikke blot enabled.

### P1-5: Evidensscore og confidence mangler semantik

Grades A-D og confidence-felter findes, men Blueprintet definerer ikke:

- hvem der sætter dem;
- om confidence er sandsynlighed, reviewer-vurdering eller modelscore;
- hvordan to kilder kombineres;
- hvordan source independence påvirker corroboration;
- hvordan sponsored/self-reported evidence vægtes;
- hvordan score calibration testes;
- om scores kan sammenlignes på tværs af ability og source class.

Uden disse regler får tallet falsk autoritet. Brug hellere forklarlige deldimensioner i v1:
source authority, directness, recency, methodological fit, independence og applicability. En samlet
confidence-score bør først vises, når den er kalibreret.

### P1-6: Rights og privacy er felter, men ikke en fuld policy model

`commercialUse`, `quotationAllowed`, retention og restrictions er et godt udgangspunkt, men premium
enterprise readiness kræver bl.a.:

- data-controller/processor-roller og DPA;
- legal basis og formål pr. source class;
- data residency og subprocessors;
- DPIA-trigger og regler for særlige kategorier/children;
- copyright-, database-rights- og robots/ToS-vurdering;
- deletion/DSR SLA og verificerbar propagation;
- policy-version, approver og expiry;
- geografiske variationer i tilladelse;
- dokumenteret handling ved ændrede platformvilkår.

Free-text policyfelter er ikke tilstrækkelige som enforcement. Introducér et lille, versioneret policy
decision object med enums og eksplicit deny-by-default.

### P1-7: Prompt injection behandles for snævert

Heuristisk tekstscreening og simple mønstre er gode forsvarslag, men kan ikke etablere sikkerhed mod
indirekte prompt injection. Den fremtidige MCP-flade øger risikoen, fordi tool output flyder tilbage
til en host-model, der også kan have andre apps og write-tools.

Der mangler:

- data/instruction-separation i alle prompts og tool-responses;
- provenance-tagging på hver tekstblok;
- content-size og nesting limits;
- URL- og redirect-policy;
- egress allowlist for acquisition;
- tool annotations og write confirmations;
- protection mod cross-tool exfiltration;
- adversarial evals med malicious source documents;
- incident kill switch og source quarantine;
- host-specifikke tests, hvor konkurrerende tools er installeret.

### P1-8: Oprindelige og derived data er ikke fuldt operationaliseret

Blueprintet siger, at raw provider payloads bliver i adaptergrænsen, men der mangler en eksplicit
dataflow for:

- hvor ephemeral data fysisk findes;
- kryptering og access logs;
- crash leftovers og temp files;
- backup inclusion/exclusion;
- hvad der sendes til synthesis-provider;
- hvad hosten ser i tool output;
- hvad observability-systemer må logge;
- hvad der slettes ved source revocation;
- hvordan afledte aggregates testes for re-identification.

Et dataflow-diagram med trust boundaries og en felt-for-felt data inventory bør være releasekrav.

### P1-9: Drifts- og supportproduktet er ikke defineret

Et premium B2B-tool kræver mindst:

- supportniveauer og incident ownership;
- SLO/SLA for research runs og connector freshness;
- RPO/RTO og dokumenteret restore;
- compatible version window og migrationspolitik;
- security patch cadence;
- observability uden kundeindhold;
- cost caps og usage visibility;
- offboarding/export/destruction certificate;
- breaking-change notification;
- ansvar ved upstream source/model changes.

Blueprintet nævner mange kontroller, men ikke det kommercielle serviceløfte eller hvem der bærer
omkostningen ved separate kundeinstallationer.

### P1-10: Kommerciel packaging og IP-grænser mangler

“Koden og packages er reusable” er ikke en salgsmodel. Der skal besluttes:

- abonnement, implementation fee og usage-baserede omkostninger;
- hvem betaler social/listening- og modelprovider;
- om kunden får kildekode, containerlicens eller hosted service;
- hvordan skills/prompts/evals og industry packs licenseres;
- hvilke dele kunden kan ændre uden at miste support;
- hvordan updates signeres, leveres og rulles tilbage;
- hvordan kundekonfiguration adskilles fra D4WN-IP;
- om anonymiserede produkttelemetrier må bruges til forbedring;
- hvordan “no cross-client learning” påvirker produktforbedring og benchmark.

### P2-1: Dokumenternes versionslogik er uklar

Blueprintet er v1.1.0, mens legacy-inventory refererer til “Blueprint v2.0”. Roadmap-evalueringen
refererer til v1.0.0, selv om roadmapet er bundet til 1.1.0. Disse forskelle er små nu, men svækker
source-of-truth, når kundedeployments skal pinne en bestemt kontrakt.

Anbefaling: Indfør et kort changelog og en maskinlæsbar manifestfil med:

- blueprint version;
- core contract version;
- database schema version;
- ability versions;
- MCP toolset version;
- minimum/maximum kompatible host-adapterversioner;
- migrationsstatus.

### P2-2: Dokumentation blander “implemented”, “usable” og “validated”

README og roadmap indeholder meget detaljerede implementation claims. De er ofte korrekt nuancerede,
men volumen gør det svært at se, hvad kunden reelt kan købe i dag. Et enkelt capability register med
fire states vil være klarere:

`designed → implemented → externally validated → production-supported`.

Status skal knyttes til durable evidence og expiry, ikke til prosa i flere dokumenter.

### P2-3: Testbeviset er stærkt, men ufuldstændigt

Ved denne audit passer 233 deterministiske tests, lint, typecheck, source-of-truth-check og production
build. Det er positivt. PostgreSQL-integrationstesten er ikke kørt, fordi auditmiljøet ikke har en
dedikeret `TEST_DATABASE_URL`. Ekstern OIDC, browserpiloten, live provider calls, source rights,
backup/restore og human research quality er fortsat åbne.

Det bør fremgå i enhver releaseattestation som separate kategorier, så “all tests passed” ikke bliver
forvekslet med “produktet er production-ready”.

## 5. Anbefalet målarkitektur

```text
CHATGPT / CLAUDE / COPILOT / ANDEN MCP-HOST
                    |
          tynd hostpakke + OAuth
                    |
            REMOTE MCP GATEWAY
  4-6 stabile tools, host-neutral schemas, audit context
                    |
      MARKET RESEARCH APPLICATION CORE
  evidence policy · retrieval · methods · synthesis gates
                    |
       CLIENT-ISOLERET DATA OG JOBS
 PostgreSQL · worker · source adapters · secret references
                    |
         GODKENDTE KILDER/PROVIDERS
client docs · trusted web · licensed listening · aggregates

SMAL ADMINFLADE (sekundær)
sources · rights · company context · review · quality · drift
```

### 5.1 Foreslået v1-toolset

Hold toolset lille nok til, at host-modellen vælger rigtigt:

1. `research_market_question` — starter/besvarer en afgrænset researchopgave og returnerer et brief
   eller `needs_context`.
2. `get_research_brief` — henter et eksisterende brief med claims, evidence refs og limitations.
3. `get_market_context` — læser godkendt company intent og relevante, accepterede Market Twin-records.
4. `list_research_gaps` — viser manglende, stale eller modstridende evidens.
5. `review_candidate` — eksplicit review-action for en autoriseret reviewer; write-gated.
6. `get_source_status` — viser freshness, rights og coverage uden credentials eller rå payloads.

Undgå at eksponere generiske CRUD-tools eller alle interne entiteter. Hvert ekstra tool øger
selection-fejl, sikkerhedsoverflade, dokumentationsbyrde og host-specifik testmatrix.

### 5.2 Hvad hosten må og ikke må eje

Hosten må eje:

- samtalen og præsentationen;
- valg af, hvornår et klart beskrevet tool bør kaldes;
- midlertidig sammenfatning af det strukturerede resultat.

Market Research skal eje:

- tenant/role/purpose authorization;
- source selection og rights policy;
- evidens- og metodekrav;
- claim classification og causal guardrails;
- citations, provenance og durable audit;
- Market Twin-state og review transitions;
- abstention og `needs_context`.

Forretningslogik må ikke kopieres ind i en ChatGPT-skill, Claude-prompt eller Copilot-topic. De skal
kun lære hosten, hvornår og hvordan den canonical MCP-kontrakt bruges.

### 5.3 Deploymentvalg, der skal træffes nu

| Model | Fordel | Ulempe | Anbefaling |
| --- | --- | --- | --- |
| Kundehostet single-tenant | Maksimal data- og konto-ejerskab | Tung installation, support og upgrades | Enterprise-option |
| Managed single-tenant | Let brugerinstallation, stærk isolation | D4WN får driftsansvar | Bedste v1-default |
| Shared multitenant SaaS | Laveste marginalomkostning | Konflikt med locked decision og højere isolation risk | Ikke nu |
| Lokal desktop-only | Kan nå private netværk | Ikke ens på web/mobile/enterprise hosts | Kun specialcase |

Hvis managed single-tenant vælges, skal locked decision 11 i Blueprintet ændres bevidst; den må ikke
omgås gennem en implementation detail.

## 6. En v1, der ikke overbygges

### 6.1 Én betalbar job-to-be-done

> “Giv en dansk marketingbeslutningstager et kildebelagt, kritisk competitor/positioning brief for
> deres virksomhed, direkte i deres foretrukne AI-værktøj, og vis tydeligt hvad vi ved, ikke ved og
> bør validere næste gang.”

### 6.2 V1 inkluderer

- remote MCP med OAuth og højst seks tools;
- versioneret company context;
- klientdokumenter, trusted public web og én listening/social-kilde;
- competitor/positioning ability;
- decision brief med claim types, contradictions, citations og research gaps;
- reviewer-flow for material recommendations og Market Twin updates;
- en smal adminflade til sources, rights, review og quality status;
- D4WN-pilot i Danmark samt én separat portability-fixture;
- human evals, live source receipts og dokumenteret deployment/restore.

### 6.3 V1 inkluderer ikke

- fuld campaign lifecycle;
- Brand Lift-analyse;
- live campaign optimization;
- generiske survey/panel workflows;
- alle social platforms;
- real-time alerts;
- custom dashboards eller BI;
- autonom publicering eller spend;
- graph database;
- generisk workflow engine;
- bred industry-pack marketplace;
- automatisk cross-client learning.

### 6.4 Overbuild-budget

Ingen ny feature må accepteres i v1 uden at opfylde alle følgende:

1. Den er nødvendig for den valgte job-to-be-done.
2. Den bruges i mindst én navngiven pilotcase.
3. Den har en eval, der kan fejle før implementationen bygges.
4. Den genbruger eksisterende kontrakter uden provider- eller client-branching.
5. Den tilføjer ikke en ny vedvarende entitet, hvis samme behov kan løses i en eksisterende record.
6. Den har en ejer, en removal condition og et målbart succeskriterium.

Praktiske loftsværdier for v1:

- højst 6 MCP-tools;
- 1 primær ability;
- 3 source paths;
- 1 primær geografi;
- 1 primary output contract;
- 1 reference synthesis-provider;
- 1 IdP/OAuth referenceflow plus en provider-neutral interface;
- 0 nye platformfeatures før den første human-evaluerede live brief.

## 7. Mekanismer mod modstridende funktioner og regressioner

### 7.1 Ét capability register

Opret én maskinlæsbar fil, fx `product-capabilities.yaml`, som for hver capability angiver:

- formål og ikke-formål;
- owner;
- status;
- input/output contract versions;
- data classes og sources;
- human gates;
- dependencies;
- eval suite;
- supported hosts;
- removal/deprecation status.

CI skal afvise duplicate capability IDs, cykliske dependencies, ukendte contract versions og
“production”-status uden de krævede evidence references.

### 7.2 Arkitekturgrænser håndhævet i kode

- `core` må ikke importere provider- eller UI-moduler.
- host adapters må kun kalde application services, aldrig databasequeries direkte.
- source adapters må ikke producere insight/recommendation/learning.
- model providers må aldrig beslutte authorization, rights eller review state.
- UI og MCP må kun vise redacted application DTOs.
- migrations må ikke aktivere sources, budgets eller abilities.

Håndhæv reglerne med dependency linting/import boundaries, ikke kun dokumentation.

### 7.3 Kontrakt- og kompatibilitetstest

For hver release:

- JSON Schema eller tilsvarende for MCP input/output;
- golden contract fixtures for alle tools;
- backward compatibility mod mindst én tidligere minor-version;
- migration up-test på tom database og repræsentativ gammel database;
- rollback-/forward-fix plan;
- host conformance på ChatGPT, Claude og Copilot;
- security/adversarial tool-selection tests;
- snapshot af data exposure pr. host.

### 7.4 Ændringsregel

Enhver ny capability skal ledsages af:

1. problem/evidence;
2. beslutning og alternativer;
3. dataflow og trust boundary;
4. kontraktændring;
5. evals og failure modes;
6. migration/deprecation impact;
7. support/operational impact;
8. dokumenteret rollback.

Det forhindrer “feature accretion”, hvor nye funktioner kopierer ansvar fra eksisterende lag.

## 8. Beslutninger, der mangler

### Skal afklares før mere produktkode

1. Er primær UX AI-hosten eller Market Research-webappen?
2. Er default deployment managed single-tenant eller kundehostet single-tenant?
3. Hvem er køber, admin, daglig bruger og reviewer?
4. Hvad er den ene betalbare v1-opgave?
5. Hvilke præcise outputs må markedsføres som “premium”?
6. Hvilke tre source paths er godkendt til pilot?
7. Hvilken listening/social-provider og licensmodel er realistisk?
8. Hvem ejer rights review, research review og security approval?
9. Hvad er data residency, retention og deletion SLA?
10. Skal `last30days` og hele legacy run-pathen slettes nu?
11. Hvilken host lanceres først, og hvilken er nummer to til portability proof?
12. Hvilke quality thresholds blokerer release?

### Skal afklares før en betalende pilot

13. Prisstruktur, provider pass-through costs og usage caps.
14. Supportmodel, SLA, RPO/RTO og incidentansvar.
15. DPA, subprocessors, privacy notice og source-rights register.
16. OAuth/IdP-model og rolle-/tenantmapping.
17. Upgrade-, migration- og rollbackmekanisme.
18. Export/offboarding og destruction certificate.
19. Hvilken telemetri D4WN må modtage fra kundeinstallationen.
20. Hvilke claims salg og marketing må bruge om kvalitet, aktualitet og coverage.

### Skal afklares før bred skalering

21. Marketplace/distribution for hver AI-host.
22. Microsoft certification og Power Platform data policy-position.
23. Industry pack governance og IP.
24. Partner-/reseller-model for research- og listening providers.
25. Hvordan produktet forbedres uden automatisk cross-client data learning.
26. Regional policyvariation og support for flere sprog/markeder.

## 9. Foreslået ny Blueprint-struktur

1. **Product contract** — buyer, user, job-to-be-done, promise, non-goals.
2. **Packaging and deployment** — hvad kunden installerer, hvad der drives hvor, ansvar og upgrade.
3. **AI-host contract** — MCP tools, auth, data exposure, host capability matrix.
4. **Core invariants** — evidence states, people-blind boundary, causality, review.
5. **V1 capability slice** — præcis én ability, sources, output og evals.
6. **Evidence and policy model** — rights, methodology, retention, confidence semantics.
7. **Security and privacy** — trust boundaries, threat model, incident controls.
8. **Quality contract** — benchmark cases, thresholds, reviewers og release gates.
9. **Operations and commercial service** — SLA, costs, upgrades, support og offboarding.
10. **Deferred capabilities** — campaigns, Brand Lift, monitoring og industry expansion.
11. **Decision register** — locked/open/deprecated med owner, date og evidence.
12. **Compatibility manifest and changelog** — blueprint, core, database, tools og abilities.

ROADMAP bør derefter organiseres som vertikale, betalbare produktbeviser:

- Slice A: remote MCP + identity + én read-only context tool.
- Slice B: live competitor/positioning research med tre approved source paths.
- Slice C: reviewer-godkendt brief og Market Twin candidate.
- Slice D: installér og kør samme contract i host nummer to.
- Slice E: deployment/restore/support proof og betalende pilot.

Først efter Slice E bør næste ability vælges ud fra pilotdata.

## 10. Hvad der kan genbruges

Bevar og løft frem:

- core evidence- og intelligence-kontrakter;
- people-blind policy og source-rights checks;
- tenant- og role-authorization;
- versioneret company context;
- deterministic evidence selection;
- claim/causality gates;
- citation lineage og retention/tombstoning;
- budget admission og redacted audit;
- provider-neutral source adapter interface;
- eval scorecards og external validation gates.

Trim eller parkér:

- legacy `last30days` path;
- brands/instructions/runs legacy surface;
- fuld campaign lifecycle i v1;
- Brand Lift i v1;
- monitoring scheduler/briefing UX i v1;
- delivery adapter indtil en konkret destination kræver det;
- broad Market Twin ontology;
- v2/v3 portable package compatibility, hvis ingen reel kunde anvender v2;
- webapp-navigation, som AI-hosten erstatter.

## 11. Verifikationsresultat fra auditten

Følgende passer i auditmiljøet:

- 233 deterministiske tests;
- ESLint;
- Next.js type generation og TypeScript typecheck;
- source-of-truth-check for Blueprint v1.1.0;
- production build med alle nuværende web- og API-ruter.

Følgende blev ikke bevist af auditten:

- PostgreSQL integration suite mod en dedikeret testdatabase;
- migration/restore på kundens valgte hostingmiljø;
- ekstern OIDC end-to-end;
- remote MCP i nogen AI-host;
- live source adapters og source rights;
- live synthesis-provider acceptance;
- human-evalueret researchkvalitet;
- social/listening coverage;
- production observability, backup, restore, incident og SLA.

## 12. Endelig anbefaling

Stop featureudvidelse midlertidigt. Bevar governance-kernen, men omskriv produktets topniveau omkring
følgende beslutning:

> Market Research er en client-isolated evidence intelligence service, som installeres i kundens
> valgte AI-værktøj via en versioneret remote MCP-kontrakt. V1 løser competitor/positioning research
> for én geografi med tre godkendte source paths og én reviewer-gated decision brief. Webfladen er en
> smal administrations- og reviewflade, ikke den primære brugeroplevelse.

Når denne sætning er godkendt, bør næste arbejde være:

1. lås v1-scope og deploymentmodel;
2. tilføj AI-host/MCP-kontrakten til Blueprintet;
3. definér quality thresholds og den første reelle evalpakke;
4. godkend tre source paths og en navngiven reviewer;
5. fjern `last30days` og anden sikker legacy-debt;
6. implementér den mindste MCP vertical slice;
7. kør en rigtig D4WN-brief i host nummer ét;
8. bevis portabilitet i host nummer to;
9. afgør først derefter, om næste capability skal være audience synthesis, monitoring eller campaign
   learning.

Verdensklasse kommer her ikke fra flere features. Det kommer fra, at et lille antal researchjobs
leverer bedre, mere ærlige og mere handlingsbare svar end generiske AI-værktøjer — med dokumenteret
kildekvalitet, klare begrænsninger, lav installationsfriktion og en governance-model, som en
virksomhed faktisk tør aktivere.

## 13. Aktuelle officielle integrationsreferencer

- OpenAI, MCP server and UI quickstart:
  https://developers.openai.com/plugins/build/app-quickstart
- OpenAI, custom MCP server:
  https://developers.openai.com/api/docs/guides/custom-mcp-server
- OpenAI, workspace plugin controls:
  https://learn.chatgpt.com/docs/enterprise/apps-and-connectors
- Anthropic, custom connectors using remote MCP:
  https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- Microsoft, connect Copilot Studio to an MCP server:
  https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-add-existing-server-to-agent
- Microsoft, MCP server certification:
  https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-server-certification
