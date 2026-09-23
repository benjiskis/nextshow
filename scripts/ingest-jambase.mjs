// ingest-jambase.mjs — v0.1.0
//
// Pulls upcoming tour dates from Jambase's v1 API for every artist
// currently on someone's wishlist, and upserts them into `shows`.
// Reuses each artist's ticketmaster_id (if known) to look them up on
// Jambase directly via cross-platform ID lookup, avoiding a second
// fuzzy name match.
//
// Run with: npm run ingest:jambase
// (loads .env.local via Node's --env-file flag, see package.json)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY
const JAMBASE_API_KEY = process.env.JAMBASE_API_KEY

for (const [name, value] of Object.entries({
  VITE_SUPABASE_URL: SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  JAMBASE_API_KEY,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
// api.data.jambase.com/v3, Bearer auth — verified directly against the API;
// the public docs at data.jambase.com are a JS-rendered SPA that don't
// expose this, and a third-party mirror of the older v1 docs (apikey query
// param, www.jambase.com/jb-api/v1) turned out to be a different, now
// rejected-by-this-key API generation.
const API_BASE = 'https://api.data.jambase.com/v3'
const USER_AGENT = 'nextshow-ingest/0.1 (+https://github.com/)'

const REQUEST_DELAY_MS = 300
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function jambaseFetch(path, params) {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${JAMBASE_API_KEY}`, 'User-Agent': USER_AGENT },
  })
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${await res.text()}`)
  return res.json()
}

async function getWishlistedArtists() {
  const { data, error } = await supabase
    .from('wishlist_items')
    .select('artists (id, name, ticketmaster_id, jambase_id, logo_url)')

  if (error) throw error

  const byId = new Map()
  for (const row of data) {
    if (row.artists) byId.set(row.artists.id, row.artists)
  }
  return [...byId.values()]
}

// Strips the "jambase:" source prefix Jambase puts on its own identifiers,
// so what we store in `jambase_id` matches the bare-ID style already used
// for ticketmaster_id/bandsintown_id.
function stripPrefix(identifier) {
  return identifier?.includes(':') ? identifier.split(':').slice(1).join(':') : identifier
}

// Resolves an artist to a Jambase identifier (+ image), preferring a
// direct cross-platform lookup via ticketmaster_id when we have one —
// avoids fuzzy name matching entirely for artists Ticketmaster already
// resolved. Persists jambase_id (and logo_url, if missing) either way.
async function resolveArtist(artist) {
  if (artist.jambase_id) {
    return { jambaseId: artist.jambase_id, imageUrl: artist.logo_url }
  }

  let match = null

  if (artist.ticketmaster_id) {
    try {
      const body = await jambaseFetch(`/artists/id/ticketmaster:${artist.ticketmaster_id}`)
      match = body.artist ?? body
    } catch {
      match = null // fall through to name search
    }
  }

  if (!match) {
    const body = await jambaseFetch('/artists', { artistName: artist.name, perPage: 5 })
    const candidates = body.artists ?? []
    match = candidates.find((a) => a.name.toLowerCase() === artist.name.toLowerCase()) ?? null
  }

  if (!match) return { jambaseId: null, imageUrl: null }

  const jambaseId = stripPrefix(match.identifier)
  const imageUrl = match.image ?? artist.logo_url ?? null

  const update = { jambase_id: jambaseId }
  if (!artist.logo_url && imageUrl) update.logo_url = imageUrl

  const { error } = await supabase.from('artists').update(update).eq('id', artist.id)
  if (error) throw error

  return { jambaseId, imageUrl }
}

async function fetchEvents(jambaseId) {
  const body = await jambaseFetch('/events', {
    artistId: `jambase:${jambaseId}`,
    perPage: 50,
  })
  return body.events ?? []
}

// Jambase's startDate has no UTC offset — it's the venue's naive local
// wall-clock time. Ticketmaster's event_date is a real UTC instant, so
// left as-is these two sources disagree by the venue's UTC offset (and
// can even land on different calendar days), which breaks same-show
// matching in the UI. Jambase does include the venue's IANA timezone
// (address['x-timezone']), so convert using that instead of guessing.
function getUtcOffsetMinutes(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date)
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0))
}

function zonedNaiveToUtcIso(naiveDateTime, timeZone) {
  if (!naiveDateTime) return null
  if (!timeZone) return naiveDateTime // best effort — let Postgres interpret as-is

  const asIfUtc = new Date(`${naiveDateTime}Z`)
  if (Number.isNaN(asIfUtc.getTime())) return naiveDateTime

  const offsetMinutes = getUtcOffsetMinutes(asIfUtc, timeZone)
  return new Date(asIfUtc.getTime() - offsetMinutes * 60000).toISOString()
}

function toShowRow(event, artistId) {
  const address = event.location?.address

  return {
    artist_id: artistId,
    venue_name: event.location?.name ?? null,
    venue_url: null,
    city: address?.addressLocality ?? null,
    state: address?.addressRegion?.alternateName ?? null,
    country: address?.addressCountry?.identifier ?? null,
    latitude: event.location?.geo?.latitude ?? null,
    longitude: event.location?.geo?.longitude ?? null,
    event_date: zonedNaiveToUtcIso(event.startDate, address?.['x-timezone']),
    ticket_url: event.offers?.[0]?.url ?? event.url ?? null,
    source: 'jambase',
    source_event_id: stripPrefix(event.identifier),
    updated_at: new Date().toISOString(),
  }
}

async function ingestArtist(artist) {
  const { jambaseId } = await resolveArtist(artist)
  if (!jambaseId) {
    console.log(`  ${artist.name}: no Jambase match, skipping`)
    return { upserted: 0 }
  }

  const events = await fetchEvents(jambaseId)
  if (events.length === 0) {
    console.log(`  ${artist.name}: 0 upcoming events`)
    return { upserted: 0 }
  }

  const rows = events
    .filter((event) => event.startDate)
    .map((event) => toShowRow(event, artist.id))

  const { error } = await supabase
    .from('shows')
    .upsert(rows, { onConflict: 'source,source_event_id' })

  if (error) throw error

  console.log(`  ${artist.name}: upserted ${rows.length} shows`)
  return { upserted: rows.length }
}

async function main() {
  const artists = await getWishlistedArtists()
  console.log(`Ingesting Jambase shows for ${artists.length} wishlisted artist(s)...`)

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
