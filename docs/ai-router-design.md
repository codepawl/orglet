# CodePawl AI router: design

**Status: agreed in outline, 2026-10-10. Nothing is deployed. Step 1 of issue 532. The owner agreed the free budget, chose Polar and US dollars first, and set what is sold: the API paid by use, and a subscription, starting with one small plan to test. The written answers from third parties under [Before it is sold](#before-it-is-sold) are still open.**

The owner's calls (2026-10-10): the router is a product of its own, not only the engine behind Orglet; it routes whatever model fits, free or paid; and the system is built to earn the most it honestly can.

Sources were read on 2026-10-10. The resale clauses of Anthropic, OpenAI and OpenRouter were read word for word at the owner's page. Prices, fees and the other terms came through a page-summarising tool and are marked *to re-read* where a decision rests on them.

## What it is

One OpenAI-compatible endpoint. A person or an app signs in with a CodePawl account, gets a key, and calls models from several sources through it. It has its own site, its own keys and its own billing. Orglet connects to it as one more connection, with no key to paste.

A router is not a runner: orglets still run on the person's computer and only the model call goes through CodePawl. `docs/product.md` keeps "a cloud runner" under Not now and gains one line saying so when step 2 starts.

## Three facts that shape everything

### 1. The big labs do not let a customer resell their API

- **Anthropic** (Commercial Terms, effective June 17, 2025): "Customer may not and must not attempt to (a) access the Services to build a competing product or service, including to train competing AI models or resell the Services except as expressly approved by Anthropic". The same terms allow use "to power products and services Customer makes available to its own customers and end users".
- **OpenAI** (Services Agreement, effective January 1, 2026): "Customer may not resell or lease access to its Account or any End User Account", and a customer may not "buy, sell, or transfer API keys from, to, or with a third party". It may "make Customer Applications available to End Users".
- **OpenRouter** (Terms, last updated August 31, 2026): a user may not "access the Site or Service for purposes of reselling API access to Models or otherwise developing a competing service".
- **Google** (Gemini API Additional Terms, effective March 23, 2026): no general resale clause was found; the text about "API Clients" was cut off in the copy read. *To re-read.*

A router that hands raw model access to its own customers is resale in the plain sense of those clauses. The line between "a product powered by the API" and "the API, resold" is the lab's to draw, and each draws it by approving or not. So:

> A first-party model from Anthropic or OpenAI goes on the router's paid list only after that lab says yes in writing. OpenRouter is never an upstream.

### 2. Upstream free tiers cannot be passed on

- Gemini's unpaid tier uses what is sent "to improve our products", people may read it, and its terms say not to send confidential or personal information. That cannot sit behind a router whose promise is that prompts are not stored.
- OpenRouter's free models carry the resale ban above. Cerebras' terms ban resale and sublicensing. Groq's service agreement could not be read.

So a "free model" on the router is a model CodePawl pays for and gives away under a cap. Free is a marketing cost with a budget, not a source of margin.

### 3. Taking money from Vietnam is the hard part, and it is also the opening

- Stripe does not list Vietnam.
- The merchant-of-record services that pay out to Vietnam restrict exactly this product. Polar's acceptable use forbids "Selling others' products or services using Polar against an upfront payment". Creem lists "API resellers" as restricted and wants a track record. Dodo forbids "anything involving stored value" and reselling AI APIs without clear rights. Paddle forbids "Virtual currency or stored value". Whether Paddle or Lemon Squeezy onboard a Vietnam seller at all was not found.
- Where one does accept it, the fee is about 4% to 5% plus $0.40 to $0.50 a payment, plus 1.5% on international cards.

Two consequences. Prepaid credits are the form most likely to be refused, so the paid plan is a **monthly subscription with included usage**, which no one reads as stored value. And the payment fee alone is larger than the whole fee the incumbents charge (see the table), so a router that only copies their model loses money on small payments.

The opening (inferred, not yet checked): a developer in Vietnam has the same problem from the other side. Many cannot pay a US lab or OpenRouter in dollars by card. A router that takes a domestic bank transfer in VND, through a Vietnamese payment gateway the household business can legally use, sells something the incumbents do not, at a payment cost far below a merchant of record's. This is the wedge worth testing first.

## How the others earn

| Router | Models priced at | Its fee |
|---|---|---|
| OpenRouter | the provider's list price | 5.5% when credits are bought ($0.80 minimum); bring-your-own-key free up to $25,000 a month, then 5% |
| OpenCode Zen | cost | card fees passed on, 4.4% + $0.30 a payment |
| Requesty | what the app spends | plus 5% |
| Vercel AI Gateway | list price | none on tokens |
| Cloudflare AI Gateway | list price | 5% on credits bought through unified billing; caching, rate limits and analytics free |

Nobody marks up the token price. The market's price for routing is about 5%, and two large platforms give it away. A margin above that has to be earned by doing something for the customer, not by a higher fee.

What a payment costs through a merchant of record at 4% + $0.40 + 1.5% international:

| Payment | Fee | Share |
|---|---|---|
| $10 | $0.95 | 9.5% |
| $20 | $1.50 | 7.5% |
| $50 | $3.15 | 6.3% |
| $100 | $5.90 | 5.9% |

A 5.5% fee does not cover a card payment of any of these sizes.

## Where the margin comes from

In the order they can be built. Each is something the customer can see and would agree is fair.

1. **The spread on open-weight models.** An open-weight model is served by several inference providers at different prices, and its licence, not a lab's API terms, governs who may serve it. The router publishes one price per model and buys from whichever provider is cheapest and healthy at that moment. The customer gets a stable price and failover; the router keeps the difference. This is the core of v0 and has no resale problem, provided each inference provider's terms allow serving end users (*to read per provider before it is added*).
2. **Caching the router manages.** The labs sell a cached prompt read at about a tenth of the input price (Anthropic 0.1x read with a 1.25x write; OpenAI 90% off; Google similar, plus storage by the hour). Most callers never set cache points. The router sets them for stable prefixes (system prompt, tools, long documents), shows the saving on the usage page, and keeps a published share of it, proposed at half. The customer still pays less than list.
3. **Batch for work that can wait.** The three labs sell batch at half price. A caller that marks a request as "within 24 hours" gets it at 25% to 30% off list; the router keeps the rest.
4. **An `auto` model.** One model name, one published blended price. The router sends each request to the cheapest model that passes its quality bar for that kind of request and escalates when the first answer fails a check. This is the largest margin and the hardest to do honestly: it needs an evaluation set, a published rule for what `auto` may pick, and the model that answered named in every response. It comes after v0 has traffic to learn from.
5. **Subscription headroom.** A plan includes an amount of usage each month. Unused usage does not roll over. Priced so that a typical subscriber uses 60% to 70% of it.
6. **Volume terms.** Anthropic says volume discounts "may be available... negotiated on a case-by-case basis"; none of the three publishes a reseller programme. Once the router has volume it asks. Until then this is zero.
7. **Hosting open models itself.** Only when one model's steady volume makes a rented GPU cheaper than the cheapest provider. Its own design note, later (step 5 of the issue).

What the router does **not** do to earn: mark a token price above the provider's list price without saying so, serve a cheaper or smaller model under another model's name, store or sell prompts, or keep a cache saving it does not show.

## What it serves, in stages

- **v0, free only.** A short list of small open-weight models bought from inference providers whose terms allow it. Sign in, get a key, call the endpoint, see usage. No payment anywhere. This proves the endpoint, metering, limits and the Orglet connection.
- **v1, paid.** The subscription, more and larger open-weight models, managed caching, batch. First-party lab models appear only for a lab that has approved in writing.
- **Bring your own key, from v0.** A customer adds their own Anthropic or OpenAI key and the router calls the lab with it. The customer is the lab's customer; the router sells routing, failover, caching and one usage page, not the model. This is the way to offer those labs' models before, or without, an approval. Whether a lab reads even this as "transferring" a key is *to ask in the same letter*.
- **Later.** `auto`, volume terms, own hosting.

## Shape

- **Where it runs.** A Cloudflare Worker, like `services/sync` and `services/market`, in its own repository because it is its own product. Workers Paid is $5 a month with 10 million requests and 30 million CPU-milliseconds included; time spent waiting on the upstream is not billed as CPU. Whether relaying a long stream counts as CPU time is not stated: *measure with a test Worker before anything else*.
- **Cloudflare AI Gateway underneath** for caching, rate limiting and analytics, which it gives free, instead of rebuilding them. Its unified billing (5% on credits) is not used; the router holds its own upstream accounts.
- **Authentication.** A router key per account, created on the router's site after signing in with the CodePawl account, shown once, stored hashed. Orglet gets a key through the existing account sign-in and keeps it in main with `safeStorage`, like every other key. A per-device key so one computer can be cut off.
- **Metering.** One Durable Object per account holds its counters and its limit, so a request is checked and counted in one place with no race. Cost is integer micros of a US dollar, as in the app. Usage unknown from an upstream is recorded as unknown, never as zero.
- **Privacy.** Prompts and answers are not stored and not logged. Kept per request: account, key id, model, upstream, token counts, cost, time, status. The site lists exactly these.
- **Limits and abuse.** Per-account rate limits, a daily cap on free models, a hard stop at the cap with a message that says when it resets. New accounts start lower. A global monthly budget for free usage that switches free models off when it is reached.
- **Orglet.** A `codepawl` provider in `core/adapters` and the catalog, model list fetched from the router (`docs/model-list-fetch.md`), limits shown where plan usage is shown. The app works fully without an account and without this connection.

## What free costs, and its cap

Planning price for a small model: $0.10 per million input tokens and $0.40 per million output tokens. This matches the cheapest first-party list prices read today (Gemini 2.5 Flash-Lite $0.10 / $0.40, Claude Haiku 5.5 $0.10 / $0.50, gpt-5-nano $0.05 / $0.40); open-weight provider prices are *to read* and are expected to be at or below it.

| Free allowance a day | Split assumed | Cost if used in full, a day | A month |
|---|---|---|---|
| 50,000 tokens | 40k in, 10k out | $0.008 | $0.24 |
| 200,000 tokens | 150k in, 50k out | $0.035 | $1.05 |

With 1,000 free accounts using a fifth of a 200,000-token allowance on average: about $210 a month. With the 50,000-token allowance: about $48.

**Agreed for v0 (owner, 2026-10-10):** 50,000 tokens a day per account, and a global free budget of **$50 a month** that turns free models off for the rest of the month when reached. Fixed costs beside it: Workers Paid $5 a month.

## What is sold

The owner's call (2026-10-10): two things, through Polar, in US dollars.

1. **The API, paid by use.** A customer with a card on file is billed each month for what they used, at the published price per model. In Polar this is a product with a metered price: the router sends usage events and Polar invoices them. Nothing is prepaid, so nothing is stored value.
2. **A subscription.** One small plan first, to test the whole path: **Starter, $5 a month, with $3.50 of usage at the published prices**, no rollover. Polar's fee on a $5 payment is about $0.68 (4% + $0.40, plus 1.5% on an international card), which leaves about $4.32; the included usage is priced so a subscriber who uses all of it still leaves the router above cost through the spread. Larger plans come after this one has run.

Free stays: 50,000 tokens a day per account on the free models, inside the global budget below.

Polar's acceptable use forbids "Selling others' products or services using Polar against an upfront payment or with an agreed upon revenue share". The router sells its own service, routing with failover, caching and one bill, but the line is Polar's to draw, so the product description sent to Polar at onboarding says plainly what it is, and nothing is charged to a real customer before Polar has accepted it.

## Before it is sold

1. **Agreed (owner, 2026-10-10):** the free budget, $50 a month in all and 50,000 tokens a day per account; Polar and US dollars first. A domestic VND gateway stays the next route to look at.
2. **Third parties, in writing:** Polar on this product, at onboarding; each inference provider's terms on serving end users, before it is added; Anthropic and OpenAI on whether a router, and bring-your-own-key routing, is approved, before either lab's models are listed.
3. **One measurement:** a test Worker relaying a long stream, to learn what it costs in CPU time.

Code for v0 can be written and tested locally before these answers; deploying, and charging anyone, cannot.

## Risks

- **A lab says no.** Then its models are bring-your-own-key only, or absent. v0 and the spread do not depend on any lab.
- **No payment provider says yes.** Then the paid plan is Vietnam-only through a domestic gateway until one does.
- **Thin margin.** The market fee is 5% and two platforms charge nothing. If the spread, caching and the Vietnam wedge do not carry it, the router stays what the issue first called it: the free connection that makes Orglet work with no key.
- **Free abuse.** Sign-up farms. The cap per account, the lower start for new accounts and the global budget bound the loss at the budget.
- **An upstream changes its price or terms.** Published router prices are per model, not per upstream, and can change with notice; the spread absorbs small moves.

## Not checked

Open-weight inference providers' prices and terms; Groq's service agreement; the full Gemini clause on API Clients; whether Paddle, Lemon Squeezy or Dodo onboard a seller in Vietnam; Vietnamese payment gateways and the tax treatment of this revenue for a household business; how streaming is billed on Workers.

## Sources

Read 2026-10-10.

- Anthropic Commercial Terms: https://www.anthropic.com/legal/commercial-terms
- OpenAI Services Agreement: https://openai.com/policies/services-agreement/
- OpenRouter Terms: https://openrouter.ai/terms and pricing: https://openrouter.ai/pricing
- Gemini API Additional Terms: https://ai.google.dev/gemini-api/terms and pricing: https://ai.google.dev/gemini-api/docs/pricing
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenCode Zen: https://opencode.ai/docs/zen/
- Vercel AI Gateway pricing: https://vercel.com/docs/ai-gateway/pricing
- Requesty pricing: https://requesty.ai/pricing
- Cloudflare AI Gateway pricing: https://developers.cloudflare.com/ai-gateway/reference/pricing/
- Cloudflare Workers pricing and limits: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/
- Stripe countries: https://stripe.com/global
- Polar, Creem, Dodo Payments, Paddle and Lemon Squeezy: each service's fees page and acceptable-use page
