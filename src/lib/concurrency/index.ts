import { db } from '../db'

/**
 * A fixed-size semaphore gating access to the shared GLM_API_KEY.
 *
 * WHY THIS EXISTS:
 * Every student's generation/edit request uses the SAME platform API key
 * (that's the whole point of hiding it from students). Zhipu enforces
 * concurrency limits per key, not per student — so without this, several
 * students hitting "Generate" at the same moment means some of them just
 * get rate-limit errors from Zhipu with no retry or queue. This makes that
 * queue explicit: only GLM_MAX_CONCURRENT requests are actively calling GLM
 * at once; everyone else waits their turn instead of failing outright.
 *
 * Implementation: N rows in GlmSlot act as tokens. Acquiring means claiming
 * a free (or abandoned/stale) row; releasing clears it. This uses the
 * existing Turso database — no new queue/cache vendor required.
 *
 * SCOPE: this gates the expensive, multi-call flows (project generation,
 * chat-driven editing) — the ones that hold GLM for a long time. It does
 * NOT currently wrap the short, single-call routes (vision, image, web
 * search, page reader) — those are quick enough that adding a queue there
 * isn't worth the complexity yet.
 *
 * TUNING: set GLM_MAX_CONCURRENT to match your actual Zhipu/BigModel plan's
 * concurrency limit (check the bigmodel.cn console) — this number is a
 * guess (3) until you confirm your real limit and set the env var.
 */

const MAX_CONCURRENT = parseInt(process.env.GLM_MAX_CONCURRENT || '3', 10)
const STALE_MS = 5 * 60 * 1000 // a slot held longer than this is assumed abandoned (crashed/timed-out request) and reclaimable
const POLL_MS = 1500
const MAX_WAIT_MS = 90 * 1000 // how long a request will queue before giving up

async function ensureSlots(): Promise<void> {
  for (let i = 1; i <= MAX_CONCURRENT; i++) {
    await db.glmSlot.upsert({ where: { id: i }, create: { id: i }, update: {} })
  }
}

/**
 * Waits for a free slot (up to MAX_WAIT_MS), then returns a release
 * function. ALWAYS call the release function in a `finally` block, or the
 * slot stays held until STALE_MS passes and another request reclaims it.
 */
export async function acquireGlmSlot(holder: string): Promise<() => Promise<void>> {
  await ensureSlots()
  const deadline = Date.now() + MAX_WAIT_MS

  while (Date.now() < deadline) {
    const staleCutoff = new Date(Date.now() - STALE_MS)
    const candidate = await db.glmSlot.findFirst({
      where: { OR: [{ heldBy: null }, { heldAt: { lt: staleCutoff } }] },
      orderBy: { id: 'asc' },
    })

    if (candidate) {
      // Optimistic claim — updateMany's WHERE re-checks the same freshness
      // condition, so this only succeeds if nobody else claimed it first.
      const claim = await db.glmSlot.updateMany({
        where: { id: candidate.id, OR: [{ heldBy: null }, { heldAt: { lt: staleCutoff } }] },
        data: { heldBy: holder, heldAt: new Date() },
      })
      if (claim.count === 1) {
        const slotId = candidate.id
        return async () => {
          await db.glmSlot.updateMany({ where: { id: slotId, heldBy: holder }, data: { heldBy: null, heldAt: null } })
        }
      }
      // Someone else claimed it between findFirst and updateMany — retry.
    }

    await new Promise(resolve => setTimeout(resolve, POLL_MS))
  }

  throw new Error('Pullarao 1 is at capacity right now — please try again in a moment.')
}
