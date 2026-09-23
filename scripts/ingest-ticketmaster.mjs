// ingest-ticketmaster.mjs — v0.1.0
//
// Pulls upcoming tour dates from Ticketmaster's Discovery API for every
// artist currently on someone's wishlist, and upserts them into `shows`.
//
// Run with: npm run ingest
// (loads .env.local via Node's --env-file flag, see package.json)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY

for (const [name, value] of Object.entries({
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  TICKETMASTER_API_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const DISCOVERY_BASE = 'https://app.ticketmaster.com/discovery/v2'

// Ticketmaster's free tier is rate-limited (5 req/sec) — small delay
// between artists keeps a wishlist-sized run comfortably under that.
const REQUEST_DELAY_MS = 300
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getWishlistedArtists() {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('artists (id, name, ticketmaster_id, logo_url)')

  if (error) throw error

  const byId = new Map()
  for (const row of data) {
    if (row.artists) byId.set(row.artists.id, row.artists)
  }
  return [...byId.values()]
}

// Widest available image — Ticketmaster returns several aspect
// ratios/sizes per attraction, good enough as a stand-in "logo".
function pickImage(images) {
  if (!images || images.length === 0) return null
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null
}

// Resolves an artist to a Ticketmaster attraction ID (+ image), and
// persists both so future runs skip straight to event lookup. Re-checks
// logo_url even when ticketmaster_id is already known, since it was
// added to the schema after some artists were first resolved.
async function resolveAttraction(artist) {
  if (artist.ticketmaster_id) {
    if (artist.logo_url) return { attractionId: artist.ticketmaster_id, imageUrl: artist.logo_url }

    const url = new URL(`${DISCOVERY_BASE}/attractions/${artist.ticketmaster_id}.json`)
    url.searchParams.set('apikey', TICKETMASTER_API_KEY)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`attraction lookup failed (${res.status}): ${await res.text()}`)
    const attraction = await res.json()
    const imageUrl = pickImage(attraction.images)

    if (imageUrl) {
      const { error } = await supabase
        .from('artists')
        .update({ logo_url: imageUrl })
        .eq('id', artist.id)
      if (error) throw error
    }

    return { attractionId: artist.ticketmaster_id, imageUrl }
  }

  const url = new URL(`${DISCOVERY_BASE}/attractions.json`)
  url.searchParams.set('apikey', TICKETMASTER_API_KEY)
  url.searchParams.set('keyword', artist.name)
  url.searchParams.set('size', '5')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`attractions lookup failed (${res.status}): ${await res.text()}`)
  const body = await res.json()

  const attractions = body._embedded?.attractions ?? []
  // Prefer an exact name match, but fall back to the top keyword result —
  // a freeform-typed artist name (e.g. "Weird Al") will rarely exactly
  // equal Ticketmaster's canonical name ("Weird Al Yankovic").
  const match =
    attractions.find((a) => a.name.toLowerCase() === artist.name.toLowerCase()) ?? attractions[0]
  if (!match) return { attractionId: null, imageUrl: null }

  const imageUrl = pickImage(match.images)
  const { error } = await supabase
    .from('artists')
    .update({ ticketmaster_id: match.id, logo_url: imageUrl })
    .eq('id', artist.id)
  if (error) throw error

  return { attractionId: match.id, imageUrl }
}

async function fetchEvents(attractionId) {
  const url = new URL(`${DISCOVERY_BASE}/events.json`)
  url.searchParams.set('apikey', TICKETMASTER_API_KEY)
  url.searchParams.set('attractionId', attractionId)
  url.searchParams.set('sort', 'date,asc')
  url.searchParams.set('size', '50')

  const res = await fetch(url)
  if (!res.ok) throw new Error(`events lookup failed (${res.status}): ${await res.text()}`)
  const body = await res.json()
  return body._embedded?.events ?? []
}

function toShowRow(event, artistId) {
  const venue = event._embedded?.venues?.[0]
  const eventDate = event.dates?.start?.dateTime ?? event.dates?.start?.localDate

  return {
    artist_id: artistId,
    venue_name: venue?.name ?? null,
    venue_url: venue?.url ?? null,
    city: venue?.city?.name ?? null,
    state: venue?.state?.stateCode ?? null,
    country: venue?.country?.countryCode ?? null,
    latitude: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    longitude: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    event_date: eventDate,
    ticket_url: event.url ?? null,
    source: 'ticketmaster',
    source_event_id: event.id,
    updated_at: new Date().toISOString(),
  }
}

// Marks the artist as checked regardless of outcome — a genuine "no
// match" or "zero events" result is still a completed check, and should
// stop the "Check for shows" CTA from re-showing for it every reload.
async function markChecked(artistId) {
  const { error } = await supabase
    .from('artists')
    .update({ ticketmaster_checked_at: new Date().toISOString() })
    .eq('id', artistId)
  if (error) throw error
}

async function ingestArtist(artist) {
  const { attractionId } = await resolveAttraction(artist)
  if (!attractionId) {
    console.log(`  ${artist.name}: no Ticketmaster attraction match, skipping`)
    await markChecked(artist.id)
    return { fetched: 0, upserted: 0 }
  }

  const events = await fetchEvents(attractionId)
  if (events.length === 0) {
    console.log(`  ${artist.name}: 0 upcoming events`)
    await markChecked(artist.id)
    return { fetched: 0, upserted: 0 }
  }

  const rows = events.map((event) => toShowRow(event, artist.id))
  const { error } = await supabase
    .from('shows')
    .upsert(rows, { onConflict: 'source,source_event_id' })

  if (error) throw error
  await markChecked(artist.id)

  console.log(`  ${artist.name}: upserted ${rows.length} shows`)
  return { fetched: events.length, upserted: rows.length }
}

async function main() {
  const artists = await getWishlistedArtists()
  console.log(`Ingesting shows for ${artists.length} wishlisted artist(s)...`)

  let totalUpserted = 0
  for (const artist of artists) {
    try {
      const { upserted } = await ingestArtist(artist)
      totalUpserted += upserted
    } catch (err) {
      console.error(`  ${artist.name}: failed — ${err.message}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }

  console.log(`Done. ${totalUpserted} show row(s) upserted total.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
