// supabase.js — v0.1.0
// Data layer — matches schema.sql v1.0.1

import { createClient } from '@supabase/supabase-js'

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

export async function getWishlist(userId) {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('artist_id, artists (id, name)')
    .eq('user_id', userId)
    .order('created_at')

  if (error) throw error
  return data.map((row) => row.artists)
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

    group.venue_name ??= row.venue_name
    group.city ??= row.city
    group.state ??= row.state
    group.country ??= row.country
    group.latitude ??= row.latitude
    group.longitude ??= row.longitude
    if (rowTime < new Date(group.event_date).getTime()) group.event_date = row.event_date
    if (row.ticket_url) group.links.push({ source: row.source, url: row.ticket_url })
  }

  return groups.sort((a, b) => a.event_date.localeCompare(b.event_date))
}
