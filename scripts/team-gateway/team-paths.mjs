/**
 * Team state paths — secrets and per-operator runtime state live OUTSIDE the
 * repository checkout (defense-in-depth: even a mounted file-read tool cannot
 * reach them from a workspace-scoped agent).
 *
 * Default location: a `.dsh-team` directory sibling to the repo checkout
 * (D:/AI-Dev-WorkSpace/.dsh-team here). Set DSH_TEAM_HOME to relocate.
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Root of the team state directory (env override wins). */
export const TEAM_HOME = process.env.DSH_TEAM_HOME
  ?? resolve(here, '..', '..', '..', '.dsh-team')

/** team.json: gateway secret, password hashes, per-user ports. */
export const teamJsonPath = join(TEAM_HOME, 'team.json')

/** Shared runtime state directory (credentials template, per-operator dirs). */
export const usersDir = join(TEAM_HOME, 'users')

/** One operator's state dir (home/, data/, cordis.overlay.yml). */
export const operatorDir = (name) => join(usersDir, name)
