// ticketmaster.js — v0.1.0
//
// Client-side live lookup against Ticketmaster's public Discovery API,
// used as a typeahead fallback when an artist search comes up empty in
// our own `artists` table — so adding a new artist pulls its canonical
// name + attraction ID + image directly from Ticketmaster instead of a
// freeform text row that has to wait for the next scheduled ingest run.
//
// Deliberately uses a VITE_-exposed key: Discovery API keys are meant
// for client-side/public use (rate-limited per key, not a secret
// credential) — unlike Jambase's metered trial key, which stays
// server-only and is only used by the batch ingestion script.

const API_KEY = import.meta.env.VITE_TICKETMASTER_API_KEY

function pickImage(images) {
  if (!images || images.length === 0) return null
  return [...images].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null
}

export async function searchTicketmasterArtists(query) {
  if (!API_KEY) return []
  const trimmed = query.trim()
  if (!trimmed) return []

  // No classificationName filter — Ticketmaster misclassifies some real
  // touring musicians outside "music" (e.g. "Weird Al Yankovic" isn't
  // tagged music), and that filter silently dropped them from results
  // entirely rather than just ranking them lower.
  const url = new URL('https://app.ticketmaster.com/discovery/v2/attractions.json')
  url.searchParams.set('apikey', API_KEY)
  url.searchParams.set('keyword', trimmed)
  url.searchParams.set('size', '5')

  const res = await fetch(url)
  if (!res.ok) return []
  const body = await res.json()

  return (body._embedded?.attractions ?? []).map((attraction) => ({
    ticketmasterId: attraction.id,
    name: attraction.name,
    imageUrl: pickImage(attraction.images),
  }))
}

function toShowRow(event, artistId) {
  const venue = event._embedded?.venues?.[0]

  return {
    artist_id: artistId,
    venue_name: venue?.name ?? null,
    venue_url: venue?.url ?? null,
    city: venue?.city?.name ?? null,
    state: venue?.state?.stateCode ?? null,
    country: venue?.country?.countryCode ?? null,
    latitude: venue?.location?.latitude ? Number(venue.location.latitude) : null,
    longitude: venue?.location?.longitude ? Number(venue.location.longitude) : null,
    event_date: event.dates?.start?.dateTime ?? event.dates?.start?.localDate,
    ticket_url: event.url ?? null,
    source: 'ticketmaster',
    source_event_id: event.id,
    updated_at: new Date().toISOString(),
  }
}

// Client-side counterpart to scripts/ingest-ticketmaster.mjs, for one
// artist at a time — used by the "Check for shows" CTA so a newly
// wishlisted artist doesn't have to wait for the next scheduled/manual
// ingest run. Only talks to Ticketmaster (see file header for why);
// doesn't write to the database itself — see ingestArtistFromTicketmaster
// in supabase.js for that.
export async function fetchTicketmasterShows(artist) {
  let ticketmasterId = artist.ticketmaster_id
  let imageUrl = null

  if (!ticketmasterId) {
    const matches = await searchTicketmasterArtists(artist.name)
    // Prefer an exact name match, but fall back to the top (most
    // relevant) keyword result — a freeform-typed name (e.g. "Weird Al")
    // will rarely exactly equal Ticketmaster's canonical name ("Weird Al
    // Yankovic"), and the user already committed to this artist by
    // clicking "Check for shows" for it.
    const match =
      matches.find((m) => m.name.toLowerCase() === artist.name.toLowerCase()) ?? matches[0]
    if (!match) return { ticketmasterId: null, imageUrl: null, rows: [] }
    ticketmasterId = match.ticketmasterId
    imageUrl = match.imageUrl
  }

  const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json')
  url.searchParams.set('apikey', API_KEY)
  url.searchParams.set('attractionId', ticketmasterId)
  url.searchParams.set('sort', 'date,asc')
  url.searchParams.set('size', '50')

  const res = await fetch(url)
  const events = res.ok ? (await res.json())._embedded?.events ?? [] : []

  return {
    ticketmasterId,
    imageUrl,
    rows: events.map((event) => toShowRow(event, artist.id)),
  }
}
