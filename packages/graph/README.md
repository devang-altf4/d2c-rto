# @rto/graph — the identity layer

FalkorDB. Two features that the order table cannot produce, and nothing else.

```bash
pnpm graph:up      # FalkorDB on :6380 (6379 is usually a plain Redis)
pnpm graph:load    # load the corpus, build components and the style graph
pnpm graph:eval    # score the corpus with and without it
pnpm graph:down
```

## Why a graph, specifically

Every feature in `scoreFitRisk` is a property of **one order in isolation** —
its payment mode, its tier, whether the buyer is new, how the style has behaved.
None of them can see that two orders came from the same doorstep.

Refusal rings live in exactly that blind spot. They open several accounts, each
of which reads as an ordinary repeat customer, and share identifiers only in
pairs: account A shares a phone with B, B shares an address with C, C shares a
device with D. Measured on the generated corpus:

| Query | Recovers |
|---|---|
| `GROUP BY phone` | 42% of an average ring |
| `GROUP BY addressHash` | 41% |
| `GROUP BY deviceId` | 41% |
| **transitive closure over all three** | **100%** |

That gap is the entire argument. It is not a speed argument — at 45k orders
Postgres beats this on every aggregate the diagnosis screen computes, and those
should stay where they are.

## Structure alone does not work

There are 567 multi-customer components in the corpus. Only 40 are rings; 527
are families sharing a roof. Households are deliberately generated at 2–5
members so they overlap the ring sizes, which means component size cannot
separate them:

```
clusterSize >= 3, no behaviour:   1,793 accounts, 13% precision
```

What separates them is what the component **does**. A family's refusal rate
looks like everyone else's; a ring's does not. `clusterScore` multiplies the
two, so a large well-behaved household and a tiny pair with one bad month both
score near zero.

```
minScore   clusters   accounts   precision   recall
0.30          85        405        57%        95%
0.40          64        325        67%        88%
0.50          46        261        81%        85%
0.60          37        218        91%        80%
0.70          28        184        95%        65%
```

The detector never reads `ringId` or `householdId`. They are loaded onto the
nodes so precision and recall can be measured afterwards. If you add a query to
`cluster.ts` that reads them, those numbers stop meaning anything.

## What it is worth, honestly

```
                        fit only    + identity graph
  AUC                     0.596        0.612
  precision at 0.45       23.3%        23.4%
  recall at 0.45          89.4%        89.9%
```

**The aggregate barely moves.** That is not the graph underperforming — it is
that `scoreFitRisk` already flags 36,780 of 45,000 orders at threshold 0.45,
because historical orders all carry `usedL1: false` and that alone contributes
0.25. A model that flags 82% of orders has no headroom for anything to improve.
Worth fixing on its own.

The value shows up per segment, not in the average:

| Action | Orders | RTO rate |
|---|---|---|
| `VERIFY_IDENTITY` | 468 | **71.4%** |
| `REMOVE_COD` | 69 | **65.2%** |
| `CONFIRM_SIZE` | 36,313 | 22.7% |
| `NONE` | 8,150 | 11.9% |

537 orders at ~71% RTO against a 21% baseline, and **99.5% of the RTOs it
blames on identity really were `INTENT`** in the generator's ground truth.

That last number is the point. This repo exists because RTO gets misattributed
— a size failure arrives as `REFUSED_COD` and nobody can see it. Blending a
refusal ring into "fit risk" would commit the same error in the other
direction, and waste the intervention: a shopper unsure about a size needs a
message asking her to confirm it; an account that refuses COD on principle
needs taking off COD. `scoreRtoRisk` keeps the two scores separate and returns
an action, not just a number.

## Cost

Real numbers from `pnpm graph:load` on this corpus:

```
load 26,132 customers + 45,000 orders      3.2s   (UNWIND batches of 2000)
algo.WCC + component summaries             0.55s
FITS_LIKE graph                            2,256 edges
```

Two performance traps, both already hit and fixed, both documented in the code:

- **`algo.WCC()` unscoped returns one component** covering the whole graph,
  because `Customer -> Order -> Style <- Order <- Customer` links every shopper
  who ever bought the same style. Pass `nodeLabels` and `relationshipTypes` to
  restrict the walk to the identity subgraph.
- **Aggregating per component then re-`MATCH`ing to write back** re-scans every
  customer once per component: 24,622 scans of 26,132 rows, about two minutes.
  Collecting members during the aggregation and `UNWIND`ing them to write does
  the same work in 320ms.

One client trap: rows come back as **objects keyed by the RETURN alias**, not
tuples. Destructuring a row as an array yields `undefined` silently rather than
throwing. Always alias, and read by name — `RtoGraph.count()` exists for the
common single-scalar case.

## FITS_LIKE — built, not yet paying for itself

`(:Style)-[:FITS_LIKE {support, observed, deltaCm}]->(:Style)`, from customers
who bought both garments.

The intent is cold start: `learnedOffsetFromExchanges` returns 0 below 30
delivered orders, so a new style ships blind, and a brand adds styles weekly.
Graph neighbours let it borrow an offset instead.

**Edge existence and edge weight are separate questions**, and conflating them
was worth 3 edges instead of 2,256. Whether two garments are comparable is
answered by co-purchase, which is common. How they differ in grading is
answered by size corrections, which are rare — 3% of orders. So the edge is
built on co-purchase and `observed` records how much correction evidence sits
behind the delta.

Be sceptical of `deltaCm` on this corpus. Customers average 1.72 orders across
180 styles, so most edges carry `observed` of 0 or 1 — the neighbourhood
aggregate in `borrowedOffset` is where any signal accumulates, and it has not
been validated against the injected `runsSmall` cohort yet. **Treat the
identity half as measured and this half as scaffolding.**

## Schema

```
(:Customer {customerId, pincode, tier, clusterId, clusterSize, clusterOrders, clusterRto, clusterCod})
(:Order    {orderId, size, cod, rto, ndrCode, amountPaise, sizeCorrection})
(:Style    {styleId, learnedOffsetCm})
(:Phone|:Address|:Device {value})

(:Customer)-[:PLACED]->(:Order)-[:OF_STYLE]->(:Style)
(:Customer)-[:USES]->(:Phone|:Address|:Device)
(:Style)-[:FITS_LIKE {support, observed, deltaCm}]->(:Style)
```

Identifiers are **nodes, not properties**. That is the whole trick: a phone
number is not a column on `Customer`, it is a thing two customers can both
point at, which turns "same phone" into a traversable edge rather than a join
predicate.
