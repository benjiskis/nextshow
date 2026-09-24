// supabase.js — v0.1.0
// Data layer — matches schema.sql v1.0.1

import { createClient } from '@supabase/supabase-js'
import { fetchTicketmasterShows } from './ticketmaster'
import { vendorFromUrl } from './vendor'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Ensures a `users` row exists for this Firebase-authenticated person.
// Called once on login; safe to call every login (upsert on firebase_uid).
export async function ensureUserRow(firebaseUser) {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        firebase_uid: firebaseUser.uid,
        email: firebaseUser.email,
        display_name: firebaseUser.displayName,
      },
      { onConflict: 'firebase_uid' }
    )
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateUserLocation(userId, { latitude, longitude }) {
  const { data, error } = await supabase
    .from('users')
    .update({ latitude, longitude })
    .eq('id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

// Name-matches only, up to 10 results — good enough until a proper
// ingestion job (jambase/ticketmaster/bandsintown) backfills `artists`.
export async function searchArtists(query) {
  const trimmed = query.trim()
  if (!trimmed) return []

  const { data, error } = await supabase
    .from('artists')
    .select('*')
    .ilike('name', `%${trimmed}%`)
    .order('name')
    .limit(10)

  if (error) throw error
  return data
}

// Case-insensitive exact match first, to avoid duplicate artist rows
// (schema has no unique constraint on `name`, only on the source IDs).
export async function findOrCreateArtist(name) {
  const trimmed = name.trim()

  const { data: existing, error: findError } = await supabase
    .from('artists')
    .select('*')
    .ilike('name', trimmed)
    .limit(1)

  if (findError) throw findError
  if (existing.length > 0) return existing[0]

  const { data, error } = await supabase
    .from('artists')
    .insert({ name: trimmed })
    .select()
    .single()

  if (error) throw error
  return data
}

// Same case-insensitive-exact-match-first dedup as findOrCreateArtist,
// but also checks ticketmaster_id — a Ticketmaster typeahead pick should
// resolve to an existing row even if its stored name differs slightly
// (e.g. punctuation) from what Ticketmaster returns today. Inserts with
// ticketmaster_id + logo_url pre-populated so the next ingestion run
// skips straight to fetching events, no name-matching required.
export async function findOrCreateArtistFromTicketmaster({ name, ticketmasterId, imageUrl }) {
  const trimmed = name.trim()

  const { data: existing, error: findError } = await supabase
    .from('artists')
    .select('*')
    .or(`ticketmaster_id.eq.${ticketmasterId},name.ilike.${trimmed}`)
    .limit(1)

  if (findError) throw findError
  if (existing.length > 0) return existing[0]

  const { data, error } = await supabase
    .from('artists')
    .insert({ name: trimmed, ticketmaster_id: ticketmasterId, logo_url: imageUrl })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function getWishlist(userId) {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('artist_id, artists (id, name, ticketmaster_id, ticketmaster_checked_at)')
    .eq('user_id', userId)
    .order('created_at')

  if (error) throw error
  return data.map((row) => row.artists)
}

// Client-side, single-artist version of scripts/ingest-ticketmaster.mjs —
// backs the temporary "Check for shows" CTA that runs when an artist's
// shows have never actually been fetched from Ticketmaster yet (no
// ticketmaster_checked_at — NOT the same as having no ticketmaster_id:
// adding an artist via the live typeahead resolves its ID immediately
// but doesn't fetch its shows). Ticketmaster only; Jambase's key stays
// server-only. Remove this CTA (and this function, if unused elsewhere)
// once scheduled ingestion is reliable enough in production that a
// manual per-artist check isn't needed.
export async function ingestArtistFromTicketmaster(artist) {
  const { ticketmasterId, imageUrl, rows } = await fetchTicketmasterShows(artist)

  const update = { ticketmaster_checked_at: new Date().toISOString() }
  if (ticketmasterId && ticketmasterId !== artist.ticketmaster_id) {
    update.ticketmaster_id = ticketmasterId
    if (imageUrl) update.logo_url = imageUrl
  }
  const { error: updateError } = await supabase.from('artists').update(update).eq('id', artist.id)
  if (updateError) throw updateError

  if (rows.length > 0) {
    const { error } = await supabase
      .from('shows')
      .upsert(rows, { onConflict: 'source,source_event_id' })
    if (error) throw error
  }

  return { resolved: ticketmasterId != null, upserted: rows.length }
}

export async function addToWishlist(userId, artistId) {
  const { error } = await supabase
    .from('wishlist_items')
    .insert({ user_id: userId, artist_id: artistId })

  if (error) throw error
}

export async function removeFromWishlist(userId, artistId) {
  const { error } = await supabase
    .from('wishlist_items')
    .delete()
    .eq('user_id', userId)
    .eq('artist_id', artistId)

  if (error) throw error
}

// Upcoming (future) shows for every artist on this user's wishlist.
// Populated by scripts/ingest-ticketmaster.mjs and scripts/ingest-jambase.mjs
// — empty until at least one of those has run for a given artist.
export async function getUpcomingShows(userId) {
  const { data: wishlistRows, error: wishlistError } = await supabase
    .from('wishlist_items')
    .select('artist_id')
    .eq('user_id', userId)

  if (wishlistError) throw wishlistError
  const artistIds = wishlistRows.map((row) => row.artist_id)
  if (artistIds.length === 0) return []

  const { data, error } = await supabase
    .from('shows')
    .select('*, artists (name, logo_url)')
    .in('artist_id', artistIds)
    .gte('event_date', new Date().toISOString())
    .order('event_date')

  if (error) throw error
  return groupShowsBySameEvent(data)
}

// Which of the given shows.id values this user has already saved
// ("yes" interest). Returns a Set for cheap membership checks against a
// group's showIds — a group counts as saved if any of its member rows
// (any source) are in the set.
export async function getSavedShowIds(userId, showIds) {
  if (showIds.length === 0) return new Set()

  const { data, error } = await supabase
    .from('show_interest')
    .select('show_id')
    .eq('user_id', userId)
    .eq('vote', 'yes')
    .in('show_id', showIds)

  if (error) throw error
  return new Set(data.map((row) => row.show_id))
}

// Saves/un-saves a grouped show — writes (or clears) show_interest for
// every underlying shows.id in the group, not just one, so the saved
// state stays consistent regardless of which source's row a future
// query happens to associate with the group.
export async function setShowSaved(userId, showIds, saved) {
  if (saved) {
    const rows = showIds.map((showId) => ({ show_id: showId, user_id: userId, vote: 'yes' }))
    const { error } = await supabase
      .from('show_interest')
      .upsert(rows, { onConflict: 'show_id,user_id' })
    if (error) throw error
  } else {
    const { error } = await supabase
      .from('show_interest')
      .delete()
      .eq('user_id', userId)
      .in('show_id', showIds)
    if (error) throw error
  }
}

// A user's saved ("yes") upcoming shows — used by the shareable read-only
// link (?saved=<userId>), so it's not scoped to any particular wishlist:
// someone's saved list can include shows from artists they never even
// added, if e.g. a friend's shared link led them to save one. Future-only,
// same as getUpcomingShows — otherwise a show that's already started
// would keep showing here (no date filter) after it had already dropped
// off the normal dashboard (which does filter), which looked like the
// vote had silently vanished.
export async function getSavedShows(userId) {
  const { data, error } = await supabase
    .from('show_interest')
    .select('shows (*, artists (name, logo_url))')
    .eq('user_id', userId)
    .eq('vote', 'yes')

  if (error) throw error
  const now = new Date().toISOString()
  const rows = data.map((row) => row.shows).filter((show) => show && show.event_date >= now)
  return groupShowsBySameEvent(rows)
}

// Everyone who's said "I'm in" (vote='yes') for any of the given
// shows.id values, keyed by show_id — the friend-opt-in / "who's going"
// layer. A group's interested-users list is every showId's entries
// merged and deduped by user id (see withInterestedUsers).
export async function getInterestedUsersByShow(showIds) {
  if (showIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('show_interest')
    .select('show_id, users (id, display_name)')
    .eq('vote', 'yes')
    .in('show_id', showIds)

  if (error) throw error

  const map = new Map()
  for (const row of data) {
    if (!row.users) continue
    if (!map.has(row.show_id)) map.set(row.show_id, [])
    map.get(row.show_id).push(row.users)
  }
  return map
}

// Annotates each grouped show with its deduped interestedUsers list —
// a single vote gets written to every showId in a group (setShowSaved),
// so the same person can appear under multiple showIds within one group.
export function withInterestedUsers(groups, interestedByShow) {
  return groups.map((group) => {
    const seen = new Map()
    for (const showId of group.showIds) {
      for (const user of interestedByShow.get(showId) ?? []) {
        seen.set(user.id, user)
      }
    }
    return { ...group, interestedUsers: [...seen.values()] }
  })
}

export async function getUserDisplayName(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', userId)
    .single()

  if (error) throw error
  return data.display_name
}

// ─── Groups ──────────────────────────────────────────────

// Inserts the group row and adds the creator as its first member in one
// call — callers never need a separate joinGroupById for the creator.
export async function createGroup(name, creatorUserId) {
  const { data, error } = await supabase
    .from('groups')
    .insert({ name: name.trim(), created_by: creatorUserId })
    .select()
    .single()

  if (error) throw error

  const { error: memberError } = await supabase
    .from('group_members')
    .insert({ group_id: data.id, user_id: creatorUserId })
  if (memberError) throw memberError

  return data
}

export async function getGroup(groupId) {
  const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).single()
  if (error) throw error
  return data
}

export async function getMyGroups(userId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('groups (id, name, created_at)')
    .eq('user_id', userId)

  if (error) throw error
  return data.map((row) => row.groups).filter(Boolean)
}

export async function getGroupMembers(groupId) {
  const { data, error } = await supabase
    .from('group_members')
    .select('users (id, display_name)')
    .eq('group_id', groupId)

  if (error) throw error
  return data.map((row) => row.users).filter(Boolean)
}

export async function joinGroupById(groupId, userId) {
  const { error } = await supabase
    .from('group_members')
    .upsert({ group_id: groupId, user_id: userId }, { onConflict: 'group_id,user_id' })
  if (error) throw error
}

// Backs the "Add as Crew" CTA on the shared saved-shows link. If the
// two users already share any group, reuses it rather than proliferating
// a new 2-person group every time someone clicks it again.
export async function findOrCreateFriendGroup(ownerUserId, viewerUserId) {
  const { data: ownerGroups, error: e1 } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', ownerUserId)
  if (e1) throw e1
  const ownerGroupIds = ownerGroups.map((row) => row.group_id)

  if (ownerGroupIds.length > 0) {
    const { data: shared, error: e2 } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', viewerUserId)
      .in('group_id', ownerGroupIds)
      .limit(1)
    if (e2) throw e2
    if (shared.length > 0) return { groupId: shared[0].group_id, created: false }
  }

  const [ownerName, viewerName] = await Promise.all([
    getUserDisplayName(ownerUserId),
    getUserDisplayName(viewerUserId),
  ])
  const group = await createGroup(`${ownerName} & ${viewerName}`, viewerUserId)
  await joinGroupById(group.id, ownerUserId)
  return { groupId: group.id, created: true }
}

// Upcoming shows where 2+ of the given member ids have said "I'm in" —
// the at-a-glance payoff of Groups: overlap between members' saved
// shows, instead of clicking into each person's list individually.
// Returns groups annotated with interestedUserIds (not names — the
// caller already has each member's display_name from getGroupMembers).
export async function getMutuallyStarredShows(memberIds) {
  if (memberIds.length < 2) return []

  const { data, error } = await supabase
    .from('show_interest')
    .select('user_id, shows (*, artists (name, logo_url))')
    .eq('vote', 'yes')
    .in('user_id', memberIds)

  if (error) throw error

  const now = new Date().toISOString()
  const byShowId = new Map()
  for (const row of data) {
    if (!row.shows || row.shows.event_date < now) continue
    if (!byShowId.has(row.shows.id)) {
      byShowId.set(row.shows.id, { show: row.shows, userIds: new Set() })
    }
    byShowId.get(row.shows.id).userIds.add(row.user_id)
  }

  const groups = groupShowsBySameEvent([...byShowId.values()].map((entry) => entry.show))

  return groups
    .map((group) => {
      const userIds = new Set()
      for (const showId of group.showIds) {
        for (const userId of byShowId.get(showId)?.userIds ?? []) userIds.add(userId)
      }
      return { ...group, interestedUserIds: [...userIds] }
    })
    .filter((group) => group.interestedUserIds.length >= 2)
}

// The same real-world concert is ingested once per source (Ticketmaster,
// Jambase, ...) with no shared ID between them, so we match on artist +
// a tight time window instead. 6h comfortably covers door-time-vs-setlist
// discrepancies between sources while staying well clear of legitimate
// back-to-back tour nights (~24h apart) at the same venue.
const SAME_SHOW_WINDOW_MS = 6 * 60 * 60 * 1000

function groupShowsBySameEvent(rows) {
  const groups = []

  for (const row of rows) {
    const rowTime = new Date(row.event_date).getTime()
    const match = groups.find(
      (group) =>
        group.artist_id === row.artist_id &&
        Math.abs(new Date(group.event_date).getTime() - rowTime) <= SAME_SHOW_WINDOW_MS
    )

    const group =
      match ??
      (() => {
        const created = {
          id: row.id,
          // Every underlying shows.id merged into this group — a vote on
          // the group has to apply to all of them, since show_interest
          // references a single shows.id and we don't know in advance
          // which source's row a future query will pick as `id`.
          showIds: [],
          artist_id: row.artist_id,
          artist: row.artists,
          event_date: row.event_date,
          venue_name: null,
          city: null,
          state: null,
          country: null,
          latitude: null,
          longitude: null,
          links: [],
        }
        groups.push(created)
        return created
      })()

    group.showIds.push(row.id)
    group.venue_name ??= row.venue_name
    group.city ??= row.city
    group.state ??= row.state
    group.country ??= row.country
    group.latitude ??= row.latitude
    group.longitude ??= row.longitude
    if (rowTime < new Date(group.event_date).getTime()) group.event_date = row.event_date

    // Dedupe by actual selling vendor (domain), not our internal
    // `source` field — Ticketmaster's own API sometimes returns two
    // events for the same real show when the venue sells through a
    // different vendor (e.g. Red Rocks via AXS), and both would
    // otherwise show up labeled "Tickets (Ticketmaster)".
    if (row.ticket_url) {
      const vendor = vendorFromUrl(row.ticket_url)
      if (!group.links.some((link) => link.key === vendor.key)) {
        group.links.push({ key: vendor.key, label: vendor.label, url: row.ticket_url })
      }
    }
  }

  return groups.sort((a, b) => a.event_date.localeCompare(b.event_date))
}
