/**
 * Structural mirrors of the DSH Client contracts this bundle consumes.
 *
 * Queried from the live runtime on 2026-09-30 (DSH `0.2.0-rc.2`):
 * `Slots.listSubTree` for `conversation.composer.dock` and `settings.section`,
 * the Client `Service` catalog for `slots` and `locale`, and
 * `Builtin.listBuiltins` for the restricted `ctx` face.
 *
 * Mirrored rather than imported so this package does not pull the whole client
 * package graph into its own build. Re-query the live contracts before widening
 * this surface, and treat a mismatch as a compatibility finding rather than a
 * reason to loosen the mirror.
 */

/** One teardown callback returned by every registration. */
export type Disposer = () => void

/** Component type the slot registry mounts; React supplies the props. */
export type SlotComponent = () => unknown

/** Registration options shared by the `id`/`order`/`label` list slots used here. */
export interface SlotRegisterOptions {
  /** Target slot name, e.g. `conversation.composer.dock`. */
  readonly name: string
  /** Cell key; a fresh id is added beside the shipped entries. */
  readonly id: string
  /** Ascending position among the entries. */
  readonly order?: number
  /** Display text where the owner projects one; a thunk follows the locale. */
  readonly label?: string | (() => string)
}

/** The slot registry face a Client plugin uses. */
export interface SlotsLike {
  /** Wait for a slot declaration, then run the registration callback. */
  inject(slot: string, callback: () => Disposer | readonly Disposer[]): Disposer
  /** Register one contribution; returns its disposer. */
  register(options: SlotRegisterOptions, component: SlotComponent): Disposer
}

/** One selectable locale declared by the Client locale service. */
export interface ClientLocaleDefinition {
  /** Stable locale id, e.g. `en` or `zh`. */
  readonly id: string
  /** Human-readable name shown in the language picker. */
  readonly label: string
  /** Locale consulted when this one has no entry for a key. */
  readonly fallback?: string
}

/** Current locale snapshot, as `locale.getLocale()` returns it. */
export interface ClientLocaleSnapshot {
  /** Active locale id. */
  readonly active: string
  /** Every locale currently declared. */
  readonly locales: readonly ClientLocaleDefinition[]
  /** Bumped on every locale switch or dictionary registration. */
  readonly revision: number
}

/** The Client locale service face this bundle uses. */
export interface ClientLocaleLike {
  /** Read the current locale snapshot. */
  getLocale(): ClientLocaleSnapshot
  /** Observe locale switches and dictionary registrations. */
  subscribe(listener: () => void): Disposer
  /** Register one dictionary for one locale; throws on a malformed tag. */
  register(namespace: string, locale: string, dict: Record<string, string>): Disposer
  /** Bind a namespace to a translate function reading the active locale. */
  bind(namespace: string): (key: string) => string
}

/** The restricted Client context handed to a module's `apply`. */
export interface ClientContext {
  /** The slot registry service, a hard dependency of this module. */
  readonly slots: SlotsLike
  /** The locale service, a hard dependency of this module. */
  readonly locale: ClientLocaleLike
  /** Register a resource owned by this plugin's Fiber; returns its disposer. */
  effect(callback: () => Disposer | void, label?: string): Disposer
}
