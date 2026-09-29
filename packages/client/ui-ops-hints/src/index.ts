/**
 * Ops hint chips plugin, node half. Pure UI plugin: the empty apply exists so
 * the plugin appears in the host cordis.yml / Loader; the browser half ships
 * via exports["./client"], discovered through the package.json dsh.client
 * declaration. Hint chips are presentation-only — clicking one fills the
 * composer draft through the session standard kit's `inputActions`.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply(): void {}
