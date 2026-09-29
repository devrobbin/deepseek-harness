/**
 * Ops hint chips plugin, browser half: occupies the composer's
 * `conversation.input.dock` seat (a full-width row stacked above the composer
 * card) with one-click prompt chips for the Amazon operations loop. Clicking
 * a chip writes the prompt into the draft and submits through the standard
 * session kit's `inputActions` — no local state, no subscription machinery.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.dock seat).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { OpsHints } from './OpsHints.tsx'

/** Required services: the seat's slot registry plus the runtime kit. */
export const inject = ['slots', 'sessions']

/**
 * Client plugin body: register the hint chips over the composer dock seat.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'ops-hints',
  }, OpsHints))
}
